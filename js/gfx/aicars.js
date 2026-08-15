/* ------------------------------------------------------------------
   AICarRenderer — the nine rivals.

   The game already simulates them; this only places them. Each rival
   carries a distance along the ribbon and a normalised lateral offset,
   which is exactly what the rolling window converts into a local pose,
   so nothing here needs to know anything about circuits.

   A car is drawn as four instanced runs — body, wings, wheels, contact
   shadow — rather than as nine separate models. Nine cars would
   otherwise be thirty-odd draw calls; this way the whole field costs
   four, and stays four whether three cars are on screen or ten.
   ------------------------------------------------------------------ */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const MAX_CARS = 10;

/** The coloured part of the car: tub, engine cover, sidepods, nose. */
const makeBodyGeometry = () => {
  const parts = [];

  /* Tub and engine cover, tapering back to the airbox. */
  const tub = new THREE.BoxGeometry(0.72, 0.34, 2.5);
  tub.translate(0, 0.42, 0.15);
  parts.push(tub);

  const spine = new THREE.BoxGeometry(0.34, 0.40, 1.7);
  spine.translate(0, 0.68, 0.55);
  parts.push(spine);

  /* Sidepods, wide and low, where an F1 car carries its radiators. */
  for (const side of [-1, 1]) {
    const pod = new THREE.BoxGeometry(0.46, 0.30, 1.5);
    pod.translate(side * 0.62, 0.38, 0.35);
    parts.push(pod);
  }

  /* Nose reaching forward to the front wing. */
  const nose = new THREE.BoxGeometry(0.30, 0.20, 1.6);
  nose.translate(0, 0.34, -1.65);
  parts.push(nose);

  const g = mergeGeometries(parts, false);
  parts.forEach((p) => p.dispose());
  return g;
};

/** Wings, floor and halo — the parts that stay dark on every car. */
const makeTrimGeometry = () => {
  const parts = [];

  /* Rear wing on its endplates, held up behind the engine cover. */
  const rear = new THREE.BoxGeometry(1.45, 0.06, 0.34);
  rear.translate(0, 1.02, 1.55);
  parts.push(rear);
  const beam = new THREE.BoxGeometry(1.30, 0.05, 0.20);
  beam.translate(0, 0.72, 1.55);
  parts.push(beam);
  for (const side of [-1, 1]) {
    const ep = new THREE.BoxGeometry(0.05, 0.52, 0.42);
    ep.translate(side * 0.72, 0.82, 1.55);
    parts.push(ep);
  }

  /* Front wing. */
  const front = new THREE.BoxGeometry(1.75, 0.05, 0.44);
  front.translate(0, 0.14, -2.45);
  parts.push(front);
  for (const side of [-1, 1]) {
    const ep = new THREE.BoxGeometry(0.05, 0.26, 0.50);
    ep.translate(side * 0.87, 0.20, -2.44);
    parts.push(ep);
  }

  /* Floor and diffuser. */
  const floor = new THREE.BoxGeometry(1.30, 0.06, 2.9);
  floor.translate(0, 0.16, 0.35);
  parts.push(floor);

  /* Halo over the cockpit — visible from behind on the car ahead. */
  const halo = new THREE.TorusGeometry(0.36, 0.028, 5, 14, Math.PI);
  halo.rotateX(-0.18);
  halo.translate(0, 0.72, -0.55);
  parts.push(halo);

  const g = mergeGeometries(parts, false);
  parts.forEach((p) => p.dispose());
  return g;
};

/** A soft dark blob, for the shadow a car drops on the road. */
const makeShadowTexture = () => {
  const s = 64;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(0,0,0,0.55)');
  g.addColorStop(0.55, 'rgba(0,0,0,0.28)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  return new THREE.CanvasTexture(c);
};

export class AICarRenderer {
  constructor(parent) {
    this.group = new THREE.Group();
    parent.add(this.group);

    this.bodyMat = new THREE.MeshStandardMaterial({
      roughness: 0.34, metalness: 0.1
    });
    this.trimMat = new THREE.MeshStandardMaterial({
      color: 0x191c21, roughness: 0.5, metalness: 0.15
    });
    this.tyreMat = new THREE.MeshStandardMaterial({
      color: 0x121417, roughness: 0.95, metalness: 0
    });
    this.shadowMat = new THREE.MeshBasicMaterial({
      map: makeShadowTexture(),
      transparent: true,
      depthWrite: false,
      fog: true
    });

    this.body = new THREE.InstancedMesh(makeBodyGeometry(), this.bodyMat, MAX_CARS);
    this.body.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(MAX_CARS * 3), 3);
    this.body.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.body.castShadow = true;

    this.trim = new THREE.InstancedMesh(makeTrimGeometry(), this.trimMat, MAX_CARS);
    this.trim.castShadow = true;

    /* Four wheels each. Rears are fatter than fronts on a real car,
       but one instanced run means one size — the rears win, because
       they are what you actually look at from behind. */
    const wheel = new THREE.CylinderGeometry(0.36, 0.36, 0.42, 12);
    wheel.rotateZ(Math.PI / 2);
    this.wheels = new THREE.InstancedMesh(wheel, this.tyreMat, MAX_CARS * 4);
    this.wheels.castShadow = true;

    /* Compound band on the sidewall, so a rival's tyre choice reads
       from behind the way it does on television. */
    const band = new THREE.CylinderGeometry(0.362, 0.362, 0.07, 12);
    band.rotateZ(Math.PI / 2);
    this.bands = new THREE.InstancedMesh(
      band, new THREE.MeshStandardMaterial({ roughness: 0.8 }), MAX_CARS * 4);
    this.bands.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(MAX_CARS * 4 * 3), 3);
    this.bands.instanceColor.setUsage(THREE.DynamicDrawUsage);

    this.shadows = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(3.4, 4.6), this.shadowMat, MAX_CARS);
    this.shadows.renderOrder = 1;

    for (const m of [this.body, this.trim, this.wheels, this.bands, this.shadows]) {
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
      m.count = 0;
      this.group.add(m);
    }

    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._pos = new THREE.Vector3();
    this._scl = new THREE.Vector3(1, 1, 1);
    this._up = new THREE.Vector3(0, 1, 0);
    this._flat = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(1, 0, 0), -Math.PI / 2);
    this._pose = { x: 0, y: 0, z: 0, heading: 0 };
    this._col = new THREE.Color();
    this.spin = 0;
    this.modelled = false;
  }

  /**
   * Swap the blocked-out car for a real model.
   *
   * Only the body and trim runs are replaced: the model arrives as one
   * shape, so its wings and floor are already part of it, and the
   * procedural wheels stay on top because a generated model rarely
   * labels its wheels well enough to spin them separately.
   *
   * Called once, if and when the GLB finishes loading — the game is
   * already playable before it arrives, and stays playable if it never
   * does.
   */
  useModel(model) {
    if (!model || !model.ready || this.modelled) return;

    this.body.geometry.dispose();
    this.body.geometry = model.bodyGeometry;
    /* The model's own texture, tinted per instance. The bodywork was
       generated deliberately plain white so a team colour multiplies
       over it cleanly instead of fighting a painted-on livery. */
    this.body.material = model.material;
    this.body.material.vertexColors = false;

    /* Its wings and floor came with it, so the separate trim run has
       nothing left to draw. */
    this.trim.visible = false;

    if (model.hasWheels) {
      /* The model labelled its wheels, so they were split out and can
         be spun. Move the corners to its own track and wheelbase. */
      const halfWidth = model.size ? model.size.x * 0.46 : 0.85;
      const halfBase = model.size ? model.size.z * 0.32 : 1.4;
      this.wheelLayout = [
        [-halfWidth, -halfBase], [halfWidth, -halfBase],
        [-halfWidth, halfBase], [halfWidth, halfBase]
      ];
    } else {
      /* It did not, so its wheels are baked into the body — drawing
         ours on top would give every rival eight. They lose their
         spin, which at the distance a rival is ever seen costs
         nothing next to having the right wheels in the right places. */
      this.wheels.visible = false;
      this.bands.visible = false;
    }

    this.modelled = true;
  }

  /**
   * @param spline  the rolling window
   * @param cars    Game.cars
   * @param dt      seconds, for wheel spin
   * @param detail  quality tier's envDetail, for the LOD cut
   */
  update(spline, cars, dt, detail) {
    this.spin += dt * 22;

    let n = 0;      // cars drawn
    let t = 0;      // cars close enough for wings and floor
    let w = 0;      // wheels drawn

    /* Past this the wheels and wings are a couple of pixels; the body
       and its shadow carry the read on their own. */
    const detailRange = 130 * Math.max(0.5, detail);

    for (let i = 0; i < cars.length && n < MAX_CARS; i++) {
      const car = cars[i];
      if (car.finishedAt !== null) continue;

      const pose = spline.localPose(car.z, car.offset, this._pose);
      if (!pose) continue;                 // outside the window

      const dist = Math.hypot(pose.x, pose.z);
      this._q.setFromAxisAngle(this._up, pose.heading);

      /* Body, tinted to the rival's colour. */
      this._pos.set(pose.x, 0, pose.z);
      this._m.compose(this._pos, this._q, this._scl);
      this.body.setMatrixAt(n, this._m);
      this._col.set(car.color);
      this.body.instanceColor.setXYZ(n, this._col.r, this._col.g, this._col.b);

      /* Contact shadow, flat on the road just under the floor. */
      this._pos.set(pose.x, 0.03, pose.z + 0.2);
      const shadowQ = this._q.clone().multiply(this._flat);
      this._m.compose(this._pos, shadowQ, this._scl);
      this.shadows.setMatrixAt(n, this._m);

      if (dist < detailRange) {
        /* Written at its own running index, not the body's: the near
           cars have to be contiguous from zero or `count` would draw
           whichever far car happened to sit in the gap. */
        if (!this.modelled) {
          this._pos.set(pose.x, 0, pose.z);
          this._m.compose(this._pos, this._q, this._scl);
          this.trim.setMatrixAt(t++, this._m);
        }

        /* Four corners, in the car's own frame then rotated into the
           window's. Rears sit wider, as they do on the real thing. */
        const corners = this.wheelLayout || [
          [-0.82, -1.55], [0.82, -1.55],
          [-0.92, 1.15], [0.92, 1.15]
        ];
        const sin = Math.sin(pose.heading);
        const cos = Math.cos(pose.heading);
        for (let k = 0; k < 4 && w < MAX_CARS * 4; k++) {
          const lx = corners[k][0];
          const lz = corners[k][1];
          const wx = pose.x + lx * cos - lz * sin;
          const wz = pose.z + lx * sin + lz * cos;

          this._pos.set(wx, 0.36, wz);
          const spinQ = this._q.clone().multiply(
            new THREE.Quaternion().setFromAxisAngle(
              new THREE.Vector3(1, 0, 0), this.spin));
          this._m.compose(this._pos, spinQ, this._scl);
          this.wheels.setMatrixAt(w, this._m);
          this.bands.setMatrixAt(w, this._m);
          this._col.set(car.tyre || '#f0f0f0');
          this.bands.instanceColor.setXYZ(w, this._col.r, this._col.g, this._col.b);
          w++;
        }
      }

      n++;
    }

    this.body.count = n;
    this.shadows.count = n;
    this.trim.count = t;
    this.wheels.count = w;
    this.bands.count = w;

    this.body.instanceMatrix.needsUpdate = true;
    this.body.instanceColor.needsUpdate = true;
    this.trim.instanceMatrix.needsUpdate = true;
    this.wheels.instanceMatrix.needsUpdate = true;
    this.bands.instanceMatrix.needsUpdate = true;
    this.bands.instanceColor.needsUpdate = true;
    this.shadows.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    this.group.traverse((o) => {
      /* The model's geometry and material are shared and outlive any
         one circuit — disposing them here would leave the next track
         drawing from freed buffers. They belong to CarModel. */
      if (o === this.body && this.modelled) return;
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        if (o.material.map) o.material.map.dispose();
        o.material.dispose();
      }
    });
    this.group.removeFromParent();
  }
}
