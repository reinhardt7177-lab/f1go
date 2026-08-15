/* ------------------------------------------------------------------
   KerbInstancing — the raised red-and-white blocks at every corner.

   Kerbs are the single most repeated object on a circuit: a few
   hundred identical wedges per lap. Drawing them individually would
   spend the entire draw-call budget on scenery, so they are one
   InstancedMesh whose matrices are rewritten as the window rolls.

   They are placed by reading the curvature the game already stores —
   a kerb belongs wherever the road bends, on both sides, which is
   near enough to how real circuits are kerbed and needs no extra
   authoring in tracks.js.
   ------------------------------------------------------------------ */
import * as THREE from 'three';

const MAX_KERBS = 260;

/* A kerb is a wedge: flat on top, ramped on the side that faces the
   circuit so a car can ride it, and vertical on the outside. */
const makeKerbGeometry = () => {
  const w = 0.9;      // width across, metres
  const l = 1.6;      // length along the road
  const h = 0.11;     // height above the tarmac

  const g = new THREE.BufferGeometry();
  /* Local frame: x across (inner edge at -w/2), y up, z along. */
  const verts = new Float32Array([
    // top face
    -w / 2, h * 0.35, -l / 2,   w / 2, h, -l / 2,   w / 2, h, l / 2,
    -w / 2, h * 0.35, -l / 2,   w / 2, h, l / 2,   -w / 2, h * 0.35, l / 2,
    // ramp facing the road
    -w / 2, 0, -l / 2,   -w / 2, h * 0.35, -l / 2,  -w / 2, h * 0.35, l / 2,
    -w / 2, 0, -l / 2,   -w / 2, h * 0.35, l / 2,   -w / 2, 0, l / 2,
    // outer face
    w / 2, 0, -l / 2,    w / 2, h, l / 2,    w / 2, h, -l / 2,
    w / 2, 0, -l / 2,    w / 2, 0, l / 2,    w / 2, h, l / 2
  ]);
  g.setAttribute('position', new THREE.BufferAttribute(verts, 3));
  g.computeVertexNormals();
  return g;
};

export class KerbInstancing {
  constructor(scene) {
    this.geometry = makeKerbGeometry();
    this.material = new THREE.MeshStandardMaterial({
      roughness: 0.65,
      metalness: 0,
      vertexColors: false
    });

    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, MAX_KERBS);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;      // they are 11 cm tall; not worth it
    this.mesh.receiveShadow = true;
    this.mesh.count = 0;

    /* Alternating stripes are per-instance colour rather than geometry,
       so the whole run of kerbing is still one draw call. */
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(MAX_KERBS * 3), 3);
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);

    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._up = new THREE.Vector3(0, 1, 0);
    this._pos = new THREE.Vector3();
    this._scale = new THREE.Vector3(1, 1, 1);

    this.red = new THREE.Color(0xc4302b);
    this.white = new THREE.Color(0xe8ebee);
    this.blue = new THREE.Color(0x2451a8);

    scene.add(this.mesh);
  }

  /**
   * Lay kerbing along the current window.
   *
   * @param spline   the rolling window
   * @param theme    the circuit theme, for the kerb colours
   * @param density  0..1 from the quality tier; a slow device gets the
   *                 same kerbs, spaced further apart
   */
  update(spline, theme, density) {
    const n = spline.count;
    const hw = spline.halfWidth;
    /* One kerb block per this many stations. Stations are ~2.1 m, and
       a block is 1.6 m long, so a stride of 1 lays a continuous run. */
    const stride = Math.max(1, Math.round(1 / Math.max(0.25, density)));

    const accent = theme && theme.rumble && theme.rumble[0]
      ? new THREE.Color(theme.rumble[0])
      : this.red;

    let k = 0;
    for (let i = 0; i < n && k < MAX_KERBS - 1; i += stride) {
      const seg = spline.segments[spline.segIndex[i]];
      if (!seg) continue;

      /* Beyond a couple of hundred metres a kerb is a pixel; spending
         instances on it buys nothing. */
      if (spline.dist[i] > 240) break;
      if (spline.dist[i] < -6) continue;

      /* Kerb where the road bends. Below this the road is straight
         enough that a real circuit would leave it unkerbed. */
      const bend = Math.abs(seg.curve);
      if (bend < 1.2) continue;

      const px = spline.px[i];
      const pz = spline.pz[i];
      const nx = spline.nx[i];
      const nz = spline.nz[i];
      const heading = Math.atan2(spline.tx[i], -spline.tz[i]);

      /* The inside of the corner always; the outside as well once it
         is quick enough that cars run wide onto it. */
      const inner = Math.sign(seg.curve) || 1;
      const sides = bend > 3.5 ? [inner, -inner] : [inner];

      for (let s = 0; s < sides.length && k < MAX_KERBS; s++) {
        const side = sides[s];
        /* Sitting just outside the white line, with the ramp facing
           in — the wedge is modelled with its low edge at -x, so the
           block is flipped for the left-hand side. */
        const off = -side * (hw * 1.05);
        this._pos.set(px + nx * off, -0.01, pz + nz * off);
        this._q.setFromAxisAngle(this._up, heading + (side > 0 ? 0 : Math.PI));
        this._m.compose(this._pos, this._q, this._scale);
        this.mesh.setMatrixAt(k, this._m);

        /* Stripe by position along the circuit, not along the window,
           so the pattern stays painted on the road instead of crawling
           as the car moves. */
        const stripe = (spline.segIndex[i] >> 1) & 1;
        const c = stripe ? this.white : accent;
        this.mesh.instanceColor.setXYZ(k, c.r, c.g, c.b);
        k++;
      }
    }

    this.mesh.count = k;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor.needsUpdate = true;
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
    this.mesh.removeFromParent();
  }
}
