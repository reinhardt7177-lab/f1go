/* ------------------------------------------------------------------
   CarModel — load a car once, then draw the whole field from it.

   A GLB arrives as a scene graph: several meshes, each with its own
   material and transform. Adding one clone of that per rival would
   cost a draw call per mesh per car — nine cars of four meshes is
   thirty-six calls, before anything else in the world is drawn.

   So the model is taken apart on load instead. Its meshes are baked
   into world space, split into the parts that need to move (wheels)
   and the parts that do not (everything else), and rebuilt as
   InstancedMeshes. The whole grid then costs the same handful of
   calls whether one car is on screen or ten.

   Wheels are found by name where the model provides one and by
   position where it does not — generated models rarely label anything,
   and a wheel is reliably a roundish lump near a corner of the
   bounding box.
   ------------------------------------------------------------------ */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** How long the car should be, in metres, whatever the model thinks. */
const TARGET_LENGTH = 5.2;

export class CarModel {
  constructor() {
    this.ready = false;
    this.bodyGeometry = null;
    this.wheelGeometry = null;
    this.wheelOffsets = [];     // wheel centres in car space
    this.wheelRadius = 0.36;
    this.material = null;

    /* Set these to a decoder directory to enable compressed models.
       Left null because nothing shipped needs them yet. */
    this.draco = null;
    this.ktx2 = null;
  }

  /**
   * @param url        path to the .glb
   * @param onDone     called with this once parsed
   * @param onError    called if it cannot be used
   * @param renderer   needed only to detect which compressed texture
   *                   formats the GPU supports
   */
  load(url, onDone, onError, renderer) {
    const loader = new GLTFLoader();

    /* Draco and KTX2 are wired up but loaded lazily: a model that uses
       neither should not pay for either, and the decoders are large.
       The GLB shipped today is uncompressed, so in practice neither
       import runs — this exists so a compressed model can be dropped
       in later without touching the loading path. */
    if (this.draco) {
      import('three/addons/loaders/DRACOLoader.js').then((m) => {
        const d = new m.DRACOLoader();
        d.setDecoderPath(this.draco);
        loader.setDRACOLoader(d);
      });
    }
    if (this.ktx2 && renderer) {
      import('three/addons/loaders/KTX2Loader.js').then((m) => {
        const k = new m.KTX2Loader();
        k.setTranscoderPath(this.ktx2);
        k.detectSupport(renderer);
        loader.setKTX2Loader(k);
      });
    }

    loader.load(url, (gltf) => {
      try {
        this._absorb(gltf.scene);
        this.ready = true;
        if (onDone) onDone(this);
      } catch (err) {
        if (onError) onError(err);
      }
    }, undefined, (err) => { if (onError) onError(err); });
  }

  /**
   * Returns +1 if the car's tall end (airbox, rear wing) sits toward
   * +Z after the yaw fix, -1 if it sits toward -Z.
   */
  _findRear(root, yawFix) {
    const v = new THREE.Vector3();
    let maxY = -Infinity;
    const samples = [];

    root.traverse((o) => {
      if (!o.isMesh || !o.geometry || !o.geometry.attributes.position) return;
      const pos = o.geometry.attributes.position;
      /* Every 7th vertex is plenty to find where the tall end is, and
         keeps this cheap on a dense model. */
      for (let i = 0; i < pos.count; i += 7) {
        v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
        if (yawFix) v.set(v.z, v.y, -v.x);     // same 90° turn as the bake
        samples.push(v.y, v.z);
        if (v.y > maxY) maxY = v.y;
      }
    });

    if (!samples.length) return 1;

    /* Average the Z of everything in the top fifth of the car's
       height — that is the airbox and the rear wing together. */
    let base = Infinity;
    for (let i = 0; i < samples.length; i += 2) base = Math.min(base, samples[i]);
    const threshold = base + (maxY - base) * 0.8;

    let sumZ = 0;
    let n = 0;
    for (let i = 0; i < samples.length; i += 2) {
      if (samples[i] >= threshold) { sumZ += samples[i + 1]; n++; }
    }
    if (!n) return 1;
    this.rearZ = sumZ / n;
    return this.rearZ >= 0 ? 1 : -1;
  }

  _absorb(root) {
    root.updateMatrixWorld(true);

    /* --- 1. normalise scale and orientation ---------------------- */
    const box = new THREE.Box3().setFromObject(root);
    const size = new THREE.Vector3();
    box.getSize(size);

    /* The longest horizontal axis is the car's length; if that is X
       rather than Z the model faces sideways and has to be turned. */
    let yawFix = size.x > size.z ? Math.PI / 2 : 0;
    const length = Math.max(size.x, size.z);
    const scale = TARGET_LENGTH / (length || 1);

    /* Which end is the nose?
     *
     * A model can be built facing either way and nothing in the file
     * says which. Getting it backwards is not subtle but it is easy to
     * misread: driving along looking at your own rear wing reads as
     * being *inside* the car, and two rounds were spent trying to fix
     * a camera that was in the right place all along.
     *
     * A racing car's tallest structure — airbox and rear wing — is at
     * the back, and its lowest, narrowest end is the nose. So the mean
     * position of the highest vertices points at the rear. */
    const rearSign = this._findRear(root, yawFix);
    if (rearSign < 0) yawFix += Math.PI;   // rear was at -Z; turn it round

    const centre = new THREE.Vector3();
    box.getCenter(centre);

    /* Bake: centre on the origin horizontally, sit on y=0, scale to
       size, and yaw so the nose points down -Z. */
    const bake = new THREE.Matrix4()
      .makeRotationY(yawFix)
      .multiply(new THREE.Matrix4().makeScale(scale, scale, scale))
      .multiply(new THREE.Matrix4().makeTranslation(
        -centre.x, -box.min.y, -centre.z));

    /* --- 2. collect meshes, split wheels from body --------------- */
    const bodyGeos = [];
    const wheelGeos = [];
    const meshes = [];
    root.traverse((o) => { if (o.isMesh && o.geometry) meshes.push(o); });
    if (!meshes.length) throw new Error('no meshes in model');

    /* Material: taken from the first textured mesh so the model's own
       map survives, but forced to a sane PBR setup — generated models
       often arrive fully rough or fully metal. */
    const src = meshes.find((m) => m.material && m.material.map) || meshes[0];
    const srcMat = Array.isArray(src.material) ? src.material[0] : src.material;
    this.material = new THREE.MeshStandardMaterial({
      map: srcMat && srcMat.map ? srcMat.map : null,
      color: 0xffffff,
      roughness: 0.42,
      metalness: 0.15
    });
    if (this.material.map) this.material.map.colorSpace = THREE.SRGBColorSpace;

    for (const mesh of meshes) {
      const g = mesh.geometry.clone();
      g.applyMatrix4(mesh.matrixWorld);
      g.applyMatrix4(bake);
      /* Instancing needs every geometry to carry the same attributes;
         anything extra (tangents, second UVs) breaks the merge. */
      for (const name of Object.keys(g.attributes)) {
        if (name !== 'position' && name !== 'normal' && name !== 'uv') {
          g.deleteAttribute(name);
        }
      }
      if (!g.attributes.uv) {
        g.setAttribute('uv', new THREE.BufferAttribute(
          new Float32Array(g.attributes.position.count * 2), 2));
      }
      if (!g.attributes.normal) g.computeVertexNormals();

      const named = (mesh.name || '').toLowerCase();
      if (named.includes('wheel') || named.includes('tyre') || named.includes('tire')) {
        wheelGeos.push(g);
      } else {
        bodyGeos.push(g);
      }
    }

    /* --- 3. no named wheels? keep the car whole ------------------ */
    /* Splitting an unlabelled model by guesswork usually takes half a
       sidepod with it. A car whose wheels do not spin is a smaller
       loss than a car with holes in it, so the body keeps everything
       and the renderer draws its own wheels over the top. */
    this.hasWheels = wheelGeos.length >= 4;

    const all = this.hasWheels ? bodyGeos : bodyGeos.concat(wheelGeos);
    this.bodyGeometry = all.length === 1 ? all[0] : mergeGeometries(all, false);
    if (!this.bodyGeometry) throw new Error('could not merge body geometry');
    this.bodyGeometry.computeBoundingSphere();

    if (this.hasWheels) {
      /* Each wheel is re-centred on its own hub so it can spin, and
         its offset remembered so it can be put back. */
      this.wheelOffsets = [];
      const centred = [];
      for (const g of wheelGeos) {
        const wb = new THREE.Box3().setFromBufferAttribute(g.attributes.position);
        const c = new THREE.Vector3();
        wb.getCenter(c);
        g.translate(-c.x, -c.y, -c.z);
        centred.push(g);
        this.wheelOffsets.push(c);
        const ws = new THREE.Vector3();
        wb.getSize(ws);
        this.wheelRadius = Math.max(ws.y, ws.z) / 2;
      }
      this.wheelGeometry = centred.length === 1
        ? centred[0] : mergeGeometries(centred, false);
    }

    const finalBox = new THREE.Box3().setFromBufferAttribute(
      this.bodyGeometry.attributes.position);
    const fs = new THREE.Vector3();
    finalBox.getSize(fs);
    this.size = fs;
    this.triangles = this.bodyGeometry.index
      ? this.bodyGeometry.index.count / 3
      : this.bodyGeometry.attributes.position.count / 3;
  }

  /**
   * Find where the driver sits, by reading the car's own roofline.
   *
   * Guessing this from fractions of the bounding box does not work —
   * three rounds were lost to a camera parked in the engine bay. The
   * shape says exactly where the seat is if you look at it: sample the
   * top surface near the centreline along the length, and a racing car
   * gives you a tall airbox, a dip in front of it where the cockpit
   * opening is, and a long fall away to the nose.
   *
   * The eye then goes at that dip, raised clear of whatever structure
   * stands between it and the road ahead — the cockpit surround, which
   * on a solid model would otherwise block the view the way a real
   * halo does not.
   */
  findSeat() {
    const pos = this.bodyGeometry.attributes.position;
    const bins = new Map();
    const step = 0.25;

    for (let i = 0; i < pos.count; i++) {
      if (Math.abs(pos.getX(i)) > 0.3) continue;      // centreline only
      const z = Math.round(pos.getZ(i) / step) * step;
      const y = pos.getY(i);
      if (!bins.has(z) || y > bins.get(z)) bins.set(z, y);
    }

    const zs = Array.from(bins.keys()).sort((a, b) => a - b);
    if (zs.length < 5) return { y: this.size.y * 0.6, z: 0 };

    /* The airbox is the tallest point. */
    let airboxZ = 0;
    let airboxY = -Infinity;
    for (const z of zs) {
      if (bins.get(z) > airboxY) { airboxY = bins.get(z); airboxZ = z; }
    }

    /* Walk forward from it to the first clear dip — the opening. */
    let dipZ = airboxZ;
    let dipY = airboxY;
    for (const z of zs) {
      if (z >= airboxZ) continue;
      if (z < airboxZ - 1.6) continue;               // do not run off down the nose
      if (bins.get(z) < dipY) { dipY = bins.get(z); dipZ = z; }
    }

    /* Then the hump in front of the opening — the cockpit surround.
       This is the piece that ruins a seated camera: on a solid model
       it is a wall of bodywork right at the lens, and no amount of
       raising or lowering the eye gets past it, because there is no
       hole in it to look through. */
    let humpZ = dipZ;
    let humpY = dipY;
    for (const z of zs) {
      if (z >= dipZ || z < dipZ - 1.2) continue;
      if (bins.get(z) > humpY) { humpY = bins.get(z); humpZ = z; }
    }

    /* So the camera goes AHEAD of that hump instead of behind it —
       the same place a broadcast nose camera sits. Everything from
       here forward is nose, falling away, and everything behind is
       out of the frustum for free. */
    const camZ = humpZ - 0.55;

    let ahead = 0;
    for (const z of zs) {
      if (z < camZ - 1.6 || z >= camZ) continue;
      ahead = Math.max(ahead, bins.get(z));
    }

    return {
      y: ahead + 0.18,
      z: camZ,
      airboxZ, dipZ, dipY, humpZ, humpY, aheadY: ahead
    };
  }

  dispose() {
    if (this.bodyGeometry) this.bodyGeometry.dispose();
    if (this.wheelGeometry) this.wheelGeometry.dispose();
    if (this.material) {
      if (this.material.map) this.material.map.dispose();
      this.material.dispose();
    }
  }
}
