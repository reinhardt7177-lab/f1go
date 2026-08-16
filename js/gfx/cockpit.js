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

/**
 * The wheel behind the tyre: brake disc, rim face and spokes.
 *
 * This exists for one reason — a plain black cylinder spinning is
 * indistinguishable from a plain black cylinder standing still. There
 * has to be something asymmetric on the wheel or the rotation the code
 * is applying is invisible, which is exactly how the first version
 * looked. Spokes and a bright wheel nut give the eye something to
 * track.
 */
const makeRimGeometry = (radius, width) => {
  const parts = [];

  /* Brake disc, inboard of the rim and slightly smaller. */
  const disc = new THREE.CylinderGeometry(radius * 0.62, radius * 0.62, width * 0.18, 14);
  disc.rotateZ(Math.PI / 2);
  parts.push(disc);

  /* Rim barrel. */
  const barrel = new THREE.CylinderGeometry(radius * 0.66, radius * 0.66, width * 0.9, 14);
  barrel.rotateZ(Math.PI / 2);
  parts.push(barrel);

  /* Five spokes across the outboard face. */
  for (let i = 0; i < 5; i++) {
    const spoke = new THREE.BoxGeometry(width * 0.14, radius * 1.15, radius * 0.16);
    spoke.rotateX(Math.PI / 2);
    spoke.rotateX(0);
    /* Rotate about the axle (X) to fan them out. */
    const m = new THREE.Matrix4().makeRotationX((i / 5) * Math.PI * 2);
    spoke.applyMatrix4(m);
    spoke.translate(width * 0.46, 0, 0);
    parts.push(spoke);
  }

  /* Centre nut — the single brightest thing on the wheel, and the
     easiest for the eye to follow round. */
  const nut = new THREE.CylinderGeometry(radius * 0.12, radius * 0.12, width * 0.24, 6);
  nut.rotateZ(Math.PI / 2);
  nut.translate(width * 0.52, 0, 0);
  parts.push(nut);

  const g = mergeGeometries(parts, false);
  parts.forEach((p) => p.dispose());
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
    this.modelled = false;
  }

  /**
   * A real car model has taken over the chassis.
   *
   * Everything blocked out from boxes goes away — nose, tub, wings,
   * mirrors, front wheels — because the model carries all of it and
   * carries it better. The steering wheel stays: the model has nothing
   * that turns with the input, and a wheel that does not move is worse
   * than no wheel at all.
   */
  useModel() {
    if (this.modelled) return;
    if (this.body) this.body.visible = false;
    if (this.shell) this.shell.visible = false;
    if (this.stripe) this.stripe.visible = false;
    for (const w of this.frontWheels) w.hub.visible = false;
    this.modelled = true;
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

    /* The tub, then the nose tapering away from it.

       These used to be separate slabs with air between them, which is
       what made the bonnet look unfinished: from the seat you see the
       gaps end-on and the car reads as parts rather than a shape. Each
       piece now starts inside the one behind it, so the silhouette is
       continuous however the light falls on it. */
    const tub = new THREE.BoxGeometry(0.94, 0.22, 1.00);
    tub.translate(0, ROAD + 0.50, -1.05);
    bodyParts.push(tub);

    const n1 = new THREE.BoxGeometry(0.66, 0.18, 1.10);
    n1.translate(0, ROAD + 0.46, -1.90);
    bodyParts.push(n1);

    const n2 = new THREE.BoxGeometry(0.44, 0.14, 1.10);
    n2.translate(0, ROAD + 0.41, -2.85);
    bodyParts.push(n2);

    const n3 = new THREE.BoxGeometry(0.26, 0.11, 0.95);
    n3.translate(0, ROAD + 0.36, -3.70);
    bodyParts.push(n3);

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

  /* --- halo -------------------------------------------------------
     Deliberately absent.

     Modelled at true scale from an eye-level seat, a halo is an arch
     across the whole upper half of the screen with a leg down each
     side. That is accurate and it ruins the view — real onboard
     cameras only get away with showing one because they sit above and
     behind the hoop, which a driver's eye does not. There is no
     framing that keeps both the halo and an open road, so the road
     wins.  */
  _buildHalo() {
    this.halo = null;
  }

  /* --- steering wheel --------------------------------------------- */
  _buildWheel() {
    this.wheel = new THREE.Group();
    /* Camera-relative, and deliberately just clipping the bottom edge
       of the frame: enough that the rim and the shift lights read,
       not so much that it becomes a dashboard across the picture. The
       previous size filled a third of the screen with grey. */
    this.wheel.position.set(0, -0.30, -0.44);
    this.wheel.rotation.x = -0.34;          // laid back toward the driver
    this.wheel.scale.setScalar(0.95);
    this.group.add(this.wheel);

    const parts = [];

    /* A modern F1 wheel is a squared-off yoke with a hole through the
       middle, not a slab. The first version was one solid box, which
       read as a dashboard rather than as something you hold — the gap
       is the whole silhouette. Built as a rim of four bars around an
       opening, with the display filling the opening. */
    const railTop = new THREE.BoxGeometry(0.34, 0.055, 0.04);
    railTop.translate(0, 0.088, 0);
    parts.push(railTop);

    const railBottom = new THREE.BoxGeometry(0.26, 0.05, 0.04);
    railBottom.translate(0, -0.095, 0);
    parts.push(railBottom);

    for (const side of [-1, 1]) {
      /* Uprights joining top and bottom, just inboard of the grips. */
      const upright = new THREE.BoxGeometry(0.045, 0.20, 0.04);
      upright.translate(side * 0.148, -0.004, 0);
      parts.push(upright);

      /* The grips themselves, thicker and canted out. */
      const grip = new THREE.BoxGeometry(0.075, 0.215, 0.075);
      grip.translate(side * 0.198, -0.012, 0.012);
      parts.push(grip);

      /* Shift paddle behind the wheel. */
      const paddle = new THREE.BoxGeometry(0.05, 0.085, 0.016);
      paddle.translate(side * 0.13, -0.02, -0.045);
      parts.push(paddle);
    }

    const merged = mergeGeometries(parts, false);
    parts.forEach((p) => p.dispose());

    const wheelMesh = new THREE.Mesh(merged, this.carbonMat);
    wheelMesh.frustumCulled = false;
    this.wheel.add(wheelMesh);

    /* The display, bright enough to read as a screen without a light
       of its own — emissive rather than lit, because it is one. */
    const screen = new THREE.Mesh(
      new THREE.PlaneGeometry(0.22, 0.105),
      new THREE.MeshBasicMaterial({ color: 0x0a1a14 })
    );
    screen.position.set(0, -0.004, 0.021);
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
    const rim = makeRimGeometry(0.36, 0.34);

    this.frontWheels = [];
    for (const side of [-1, 1]) {
      /* Two nested groups: the outer one steers, the inner one spins.
         Combining both on one object makes the steering axis tumble
         with road speed, which looks like a broken gimbal. */
      const hub = new THREE.Group();
      /* Axle height is the road plus the tyre's radius — anything else
         has the car either floating or buried. */
      hub.position.set(side * 0.92, -1.12 + 0.36, -2.30);
      this.group.add(hub);

      const spinner = new THREE.Group();
      /* The rim's detail sits on the outboard face, so it is mirrored
         for the left-hand wheel. */
      spinner.scale.x = side;
      hub.add(spinner);

      const t = new THREE.Mesh(tyre, this.rubberMat);
      t.frustumCulled = false;
      spinner.add(t);

      const r = new THREE.Mesh(rim, this.rimMat);
      r.frustumCulled = false;
      spinner.add(r);

      this.frontWheels.push({ hub, spinner });
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

    /* Road speed to wheel speed: at full pace the wheel turns fast
       enough that the spokes strobe, which is what it does in life. */
    this.spin += speed * dt * 34;
    for (let i = 0; i < this.frontWheels.length; i++) {
      const w = this.frontWheels[i];
      w.hub.rotation.y = -steer * 0.34;
      w.spinner.rotation.x = this.spin;
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
