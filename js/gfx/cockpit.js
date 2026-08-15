/* ------------------------------------------------------------------
   PlayerCockpit — what the driver sees of their own car.

   Parented to the camera rather than to the world, which is what a
   cockpit view actually is: the car is fixed on screen and the world
   moves around it. That also makes it free to draw — no per-frame
   matrix work beyond the two parts that move, the steering wheel and
   the front wheels.

   Everything static is merged into a single geometry so the whole
   chassis costs one draw call. The parts that move cost one each.
   ------------------------------------------------------------------ */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Carbon fibre. A twill weave drawn once into a canvas: at cockpit
 * distance the weave is the difference between "carbon" and "dark
 * grey plastic", and it is a dozen lines rather than a download.
 */
const makeCarbonTexture = () => {
  const size = 128;
  const cell = 8;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');

  ctx.fillStyle = '#17191d';
  ctx.fillRect(0, 0, size, size);

  for (let y = 0; y < size; y += cell) {
    for (let x = 0; x < size; x += cell) {
      /* 2x2 twill: the diagonal is what reads as woven rather than
         checkered, and it is the diagonal people recognise. */
      const over = (((x / cell) + (y / cell)) % 2) === 0;
      const g = ctx.createLinearGradient(x, y, x + cell, y + cell);
      if (over) {
        g.addColorStop(0, '#2b2f36');
        g.addColorStop(0.5, '#3a3f47');
        g.addColorStop(1, '#22262c');
      } else {
        g.addColorStop(0, '#1b1e23');
        g.addColorStop(0.5, '#252931');
        g.addColorStop(1, '#15171b');
      }
      ctx.fillStyle = g;
      ctx.fillRect(x, y, cell, cell);
    }
  }

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(6, 6);
  tex.anisotropy = 4;
  return tex;
};

/** A tyre: fat, square-shouldered, axis along X. */
const makeTyreGeometry = (radius, width) => {
  const g = new THREE.CylinderGeometry(radius, radius, width, 16, 1, false);
  g.rotateZ(Math.PI / 2);          // stand it up, axle across the car
  return g;
};

export class PlayerCockpit {
  constructor(camera, accentColor) {
    this.group = new THREE.Group();
    /* Drawn after the world and never culled: it wraps the near plane,
       so its bounding sphere is a poor guide to whether it is on
       screen — and it always is. */
    this.group.renderOrder = 2;
    camera.add(this.group);

    const carbon = makeCarbonTexture();
    /* Carbon is nearly black in the flesh. Lit by a strong sun through
       filmic tone mapping it washes out to grey unless the albedo is
       pulled well down, so the weave is darkened rather than the
       lighting compromised for one material's sake. */
    this.carbonMat = new THREE.MeshStandardMaterial({
      map: carbon,
      color: 0x9aa1ab,
      roughness: 0.55,
      metalness: 0.15
    });
    /* The livery: a clear-coated paint rather than a flat colour.
       Clearcoat is what makes bodywork look wet-sprayed instead of
       matte plastic, and it is the cheapest step toward the finish a
       modern car has. */
    this.liveryMat = new THREE.MeshPhysicalMaterial({
      color: accentColor || 0xf0620f,
      roughness: 0.28,
      metalness: 0.05,
      clearcoat: 0.85,
      clearcoatRoughness: 0.12
    });
    this.accentMat = new THREE.MeshStandardMaterial({
      color: 0x16181c,
      roughness: 0.4,
      metalness: 0.1
    });
    this.rubberMat = new THREE.MeshStandardMaterial({
      color: 0x14161a,
      roughness: 0.95,
      metalness: 0
    });
    this.rimMat = new THREE.MeshStandardMaterial({
      color: 0x9a9ea6,
      roughness: 0.35,
      metalness: 0.85
    });

    this._buildShell();
    this._buildHalo();
    this._buildWheel();
    this._buildFrontTyres();

    this.steer = 0;
    this.spin = 0;
  }

  /* --- the tub the driver sits in --------------------------------
     All of this is in camera space: the eye is the origin, the road
     is 1.12 m below it, and -Z is where the car is going. Every
     number below is a real measurement off that datum, which is the
     only way the proportions come out right — eyeballed offsets put
     the nose through the windscreen and the halo under the floor.  */
  _buildShell() {
    const ROAD = -1.12;

    /* Two materials, two meshes: the bodywork the driver looks along
       is in the team's colour, and only the structure around the
       cockpit is bare carbon. An all-carbon car reads as a prototype
       rather than a livery, and the coloured nose running away to the
       wing is the single strongest cue that this is *your* car. */
    const bodyParts = [];
    const carbonParts = [];

    /* Nose, in three steps so it visibly tapers toward the wing. */
    const n1 = new THREE.BoxGeometry(0.44, 0.15, 0.95);
    n1.translate(0, ROAD + 0.44, -1.62);
    bodyParts.push(n1);

    const n2 = new THREE.BoxGeometry(0.32, 0.12, 1.1);
    n2.translate(0, ROAD + 0.40, -2.60);
    bodyParts.push(n2);

    const n3 = new THREE.BoxGeometry(0.22, 0.10, 0.8);
    n3.translate(0, ROAD + 0.35, -3.50);
    bodyParts.push(n3);

    /* The tub sides, sloping up to the cockpit opening — also livery. */
    for (const side of [-1, 1]) {
      const flank = new THREE.BoxGeometry(0.20, 0.20, 1.05);
      flank.translate(side * 0.42, ROAD + 0.50, -1.15);
      bodyParts.push(flank);
    }

    /* Front wing: main plane plus endplates, at the end of the nose. */
    const wing = new THREE.BoxGeometry(1.85, 0.04, 0.46);
    wing.translate(0, ROAD + 0.13, -3.92);
    bodyParts.push(wing);
    const flap = new THREE.BoxGeometry(1.80, 0.035, 0.26);
    flap.translate(0, ROAD + 0.21, -3.78);
    bodyParts.push(flap);
    for (const side of [-1, 1]) {
      const ep = new THREE.BoxGeometry(0.04, 0.30, 0.55);
      ep.translate(side * 0.94, ROAD + 0.20, -3.90);
      carbonParts.push(ep);
    }

    /* Cockpit rim in carbon, framing the opening. */
    for (const side of [-1, 1]) {
      const rim = new THREE.BoxGeometry(0.10, 0.07, 0.95);
      rim.translate(side * 0.44, ROAD + 0.61, -1.10);
      carbonParts.push(rim);

      /* Mirror on its stalk. */
      const stalk = new THREE.BoxGeometry(0.20, 0.03, 0.03);
      stalk.translate(side * 0.55, ROAD + 0.68, -1.20);
      carbonParts.push(stalk);
      const housing = new THREE.BoxGeometry(0.19, 0.11, 0.05);
      housing.translate(side * 0.66, ROAD + 0.68, -1.23);
      carbonParts.push(housing);
    }

    /* Suspension: the upper and lower wishbones running out to each
       front upright. These are what tie the wheels to the car — with
       them missing the tyres look like they are floating alongside,
       which is exactly how the first pass read. */
    for (const side of [-1, 1]) {
      for (const arm of [{ y: 0.30, z: -2.00, len: 0.62 }, { y: 0.52, z: -2.14, len: 0.58 }]) {
        const a = new THREE.BoxGeometry(arm.len, 0.035, 0.05);
        a.rotateY(side * 0.30);
        a.translate(side * (0.30 + arm.len / 2), ROAD + arm.y, arm.z);
        carbonParts.push(a);
      }
      /* Trackrod, further forward and thinner. */
      const rod = new THREE.BoxGeometry(0.58, 0.025, 0.03);
      rod.rotateY(side * 0.18);
      rod.translate(side * 0.60, ROAD + 0.36, -2.42);
      carbonParts.push(rod);
    }

    const bodyGeo = mergeGeometries(bodyParts, false);
    bodyParts.forEach((p) => p.dispose());
    this.body = new THREE.Mesh(bodyGeo, this.liveryMat);
    this.body.frustumCulled = false;
    this.group.add(this.body);

    const carbonGeo = mergeGeometries(carbonParts, false);
    carbonParts.forEach((p) => p.dispose());
    this.shell = new THREE.Mesh(carbonGeo, this.carbonMat);
    this.shell.frustumCulled = false;
    this.group.add(this.shell);

    /* A dark spine down the centre of the nose, which is what gives
       the bodywork its length in the view. */
    const stripe = new THREE.BoxGeometry(0.10, 0.02, 2.9);
    stripe.translate(0, ROAD + 0.51, -2.35);
    this.stripe = new THREE.Mesh(stripe, this.accentMat);
    this.stripe.frustumCulled = false;
    this.group.add(this.stripe);
  }

  /* --- halo ------------------------------------------------------- */
  _buildHalo() {
    const ROAD = -1.12;
    const parts = [];

    /* The hoop arcs OVER the driver: a half torus in the XY plane,
       upper half kept. Rotating it the other way — which is easy to
       do by accident — buries the arc under the bodywork, where it
       reads as a missing halo rather than an upside-down one. */
    /* The ring surrounds the driver's head rather than standing in
       front of it, so it is centred almost level with the eye. Placed
       further forward it becomes a triumphal arch across the whole
       screen instead of the thin band a driver actually sees. */
    /* Distance sets how much of the arc is on screen: too close and
       the apex leaves the frame entirely, so only the corners show
       and the halo reads as two mystery posts. Half a metre out puts
       the whole arc inside a 68° view. */
    const hoop = new THREE.TorusGeometry(0.46, 0.026, 6, 24, Math.PI);
    hoop.rotateX(-0.14);
    hoop.translate(0, ROAD + 0.88, -0.55);
    parts.push(hoop);

    /* The struts carrying the hoop down to the chassis. */
    for (const side of [-1, 1]) {
      const strut = new THREE.CylinderGeometry(0.024, 0.030, 0.30, 6);
      strut.translate(side * 0.46, ROAD + 0.74, -0.55);
      parts.push(strut);
    }

    /* The front pillar, dead ahead in the eyeline — the part of a
       halo everyone recognises. */
    const pillar = new THREE.CylinderGeometry(0.015, 0.019, 0.46, 6);
    pillar.rotateX(-0.12);
    pillar.translate(0, ROAD + 1.00, -0.70);
    parts.push(pillar);

    const merged = mergeGeometries(parts, false);
    parts.forEach((p) => p.dispose());

    this.halo = new THREE.Mesh(merged, this.carbonMat);
    this.halo.frustumCulled = false;
    this.group.add(this.halo);
  }

  /* --- steering wheel --------------------------------------------- */
  _buildWheel() {
    this.wheel = new THREE.Group();
    /* High enough to sit in the bottom of the frame rather than out of
       it: in an onboard shot the top of the wheel and its display are
       always visible under the nose, and losing them makes the view
       feel like a drone rather than a seat. */
    this.wheel.position.set(0, -1.12 + 0.70, -0.50);
    this.wheel.rotation.x = -0.52;          // laid back toward the driver
    this.wheel.scale.setScalar(1.25);
    this.group.add(this.wheel);

    const parts = [];

    /* Modern F1 wheels are a squared-off yoke, not a ring. */
    const body = new THREE.BoxGeometry(0.30, 0.14, 0.035);
    parts.push(body);
    for (const side of [-1, 1]) {
      const grip = new THREE.BoxGeometry(0.075, 0.20, 0.055);
      grip.translate(side * 0.155, -0.01, 0.01);
      parts.push(grip);
    }
    const merged = mergeGeometries(parts, false);
    parts.forEach((p) => p.dispose());

    const wheelMesh = new THREE.Mesh(merged, this.carbonMat);
    wheelMesh.frustumCulled = false;
    this.wheel.add(wheelMesh);

    /* The display, bright enough to read as a screen without a light
       of its own — emissive rather than lit, because it is one. */
    const screen = new THREE.Mesh(
      new THREE.PlaneGeometry(0.16, 0.07),
      new THREE.MeshBasicMaterial({ color: 0x0a1a14 })
    );
    screen.position.set(0, 0.005, 0.019);
    screen.frustumCulled = false;
    this.wheel.add(screen);

    /* Rev lights across the top. Individually toggled each frame, so
       they are one small InstancedMesh rather than twelve meshes. */
    const LIGHTS = 12;
    this.revLights = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(0.016, 0.012),
      new THREE.MeshBasicMaterial({ toneMapped: false }),
      LIGHTS
    );
    this.revLights.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(LIGHTS * 3), 3);
    this.revLights.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.revLights.frustumCulled = false;
    const m = new THREE.Matrix4();
    for (let i = 0; i < LIGHTS; i++) {
      m.makeTranslation(-0.11 + i * 0.02, 0.052, 0.02);
      this.revLights.setMatrixAt(i, m);
    }
    this.revLights.instanceMatrix.needsUpdate = true;
    this.wheel.add(this.revLights);
    this.lightCount = LIGHTS;
  }

  /* --- front tyres ------------------------------------------------ */
  _buildFrontTyres() {
    /* An F1 driver can see both front wheels working, and watching
       them turn is most of what sells a cockpit view as a car rather
       than a floating camera. */
    const tyre = makeTyreGeometry(0.36, 0.34);
    const rim = makeTyreGeometry(0.20, 0.36);

    this.frontWheels = [];
    for (const side of [-1, 1]) {
      const hub = new THREE.Group();
      /* Axle height is the road plus the tyre's radius — anything else
         has the car either floating or buried. */
      hub.position.set(side * 0.92, -1.12 + 0.36, -2.30);
      this.group.add(hub);

      const t = new THREE.Mesh(tyre, this.rubberMat);
      t.frustumCulled = false;
      hub.add(t);

      const r = new THREE.Mesh(rim, this.rimMat);
      r.frustumCulled = false;
      hub.add(r);

      this.frontWheels.push(hub);
    }
  }

  /**
   * @param steer  -1..1 steering input
   * @param rpm    0..1, for the rev lights
   * @param speed  0..1 of top speed, for wheel spin
   * @param dt     seconds
   * @param drs    whether DRS is open, for the display tint
   */
  update(steer, rpm, speed, dt, drs) {
    this.steer = steer;

    /* The steering wheel turns further than the road wheels do, which
       is true of the real thing and reads better besides. */
    this.wheel.rotation.z = -steer * 0.9;

    this.spin += speed * dt * 26;
    for (let i = 0; i < this.frontWheels.length; i++) {
      const hub = this.frontWheels[i];
      hub.rotation.y = -steer * 0.34;
      hub.children[0].rotation.x = this.spin;
      hub.children[1].rotation.x = this.spin;
    }

    /* Rev lights: green, red, then blue at the shift point. */
    const lit = Math.round(rpm * this.lightCount);
    for (let i = 0; i < this.lightCount; i++) {
      let r = 0.10, g = 0.11, b = 0.13;
      if (i < lit) {
        if (i < 5) { r = 0.07; g = 0.85; b = 0.40; }
        else if (i < 9) { r = 0.95; g = 0.05; b = 0.06; }
        else { r = 0.25; g = 0.45; b = 1.0; }
      }
      this.revLights.instanceColor.setXYZ(i, r, g, b);
    }
    this.revLights.instanceColor.needsUpdate = true;

    this.liveryMat.emissive.setScalar(drs ? 0.05 : 0);
  }

  dispose() {
    this.group.removeFromParent();
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
    });
    this.carbonMat.map.dispose();
    this.carbonMat.dispose();
    this.liveryMat.dispose();
    this.accentMat.dispose();
    this.rubberMat.dispose();
    this.rimMat.dispose();
  }
}
