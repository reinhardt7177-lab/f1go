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

  _absorb(root) {
    root.updateMatrixWorld(true);

    /* --- 1. normalise scale and orientation ---------------------- */
    const box = new THREE.Box3().setFromObject(root);
    const size = new THREE.Vector3();
    box.getSize(size);

    /* The longest horizontal axis is the car's length; if that is X
       rather than Z the model faces sideways and has to be turned. */
    const yawFix = size.x > size.z ? Math.PI / 2 : 0;
    const length = Math.max(size.x, size.z);
    const scale = TARGET_LENGTH / (length || 1);

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

  dispose() {
    if (this.bodyGeometry) this.bodyGeometry.dispose();
    if (this.wheelGeometry) this.wheelGeometry.dispose();
    if (this.material) {
      if (this.material.map) this.material.map.dispose();
      this.material.dispose();
    }
  }
}
