/**
 * The first-person cockpit.
 *
 * Everything here is what a driver actually sees from the seat of a
 * 2026 car, and only that. The parts are positioned in the chassis
 * frame — the same frame the physics uses — so the group can simply be
 * parented to the car and never needs its own transform maths.
 *
 * Two things drive the layout, and they pull against each other.
 *
 * The eye is behind the halo, so the hoop cuts across the view. That is
 * not a defect to be designed around: it is the single most
 * recognisable thing about the modern cockpit, and a first-person view
 * without it reads as a generic racing game. Its centre pillar is a
 * different matter, and is gone — see `buildHalo`.
 *
 * The wheel is the other half. It is the only part that moves, and it
 * is what makes the car feel connected to your hands rather than to a
 * number somewhere. It carries its own rev lights and gear readout,
 * because in a real car that display is the primary instrument and the
 * screen HUD is the concession.
 */
import * as THREE from 'three';
import { gearLabel } from '../sim/drivetrain';
import { outlineMaterial, outlineMesh, toonMaterial } from './toon';

/**
 * Where the driver's eye sits, in chassis coordinates (metres).
 *
 * Higher than a real driver's head, and deliberately. At a true seated
 * height the sight line runs *along* the nose rather than over it: the
 * bodywork and the front tyres fill the lower half of the frame and the
 * road is reduced to a strip between them. Every racing game raises this
 * for the same reason, and the extra 10 cm buys back the view of the
 * corner without costing the sense of sitting inside the car.
 */
export const EYE = new THREE.Vector3(0, 0.62, -0.10);

/*
 * Carbon is nearly black in life, but a cockpit rendered at its true
 * value is a silhouette: the halo, the tub and the mirrors all collapse
 * into one dark mass and none of them reads as a separate object. These
 * are lifted, and separated from each other, so the shapes stay
 * legible.
 *
 * Drawn rather than lit, they have to go further still. Under a
 * lighting model the halo separated from the tub behind it because the
 * two caught the sun differently; under four flat bands they are one
 * value and one shape. So the ink line does the separating instead —
 * which means every part needs to be light enough to have a black line
 * drawn round it, and the values below are picked for that rather than
 * for what carbon fibre looks like.
 */
const CARBON = 0x39414b;
const CARBON_LIGHT = 0x4d5661;

/**
 * Flat-shaded, and unused arguments kept.
 *
 * The call sites pass a roughness and a metalness because that is what
 * the parts genuinely are, and those numbers are still the right note
 * to leave in the source even though nothing consumes them now. Taking
 * them out would mean editing thirty call sites to say less.
 */
const mat = (color: number, _roughness = 0.7, _metalness = 0.05): THREE.MeshToonMaterial =>
  toonMaterial(color);

/**
 * Draw a rounded-rectangle display face as a texture.
 *
 * A canvas texture rather than geometry because the wheel display is
 * text and coloured bars — building that from triangles would be a lot
 * of vertices for something the size of a postcard, and it has to be
 * redrawn every frame anyway.
 */
class WheelDisplay {
  readonly texture: THREE.CanvasTexture;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly w = 256;
  private readonly h = 128;

  constructor() {
    const canvas = document.createElement('canvas');
    canvas.width = this.w;
    canvas.height = this.h;
    this.ctx = canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
  }

  update(gear: number, speedKmh: number, revFraction: number, overtakeReady: boolean): void {
    const c = this.ctx;
    c.fillStyle = '#07090c';
    c.fillRect(0, 0, this.w, this.h);

    // Rev lights: green, then red, then blue for the shift point. The
    // blue segment is the one you actually shift on.
    const lights = 15;
    const lit = Math.round(revFraction * lights);
    const bw = this.w / lights;
    for (let i = 0; i < lights; i++) {
      const on = i < lit;
      c.fillStyle = !on ? '#1a1e24' : i < 7 ? '#12d16b' : i < 12 ? '#e2000f' : '#3b82f6';
      c.fillRect(i * bw + 2, 6, bw - 4, 16);
    }

    c.fillStyle = '#eef2f6';
    c.font = '700 62px "Segoe UI", system-ui, sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(gearLabel(gear), this.w * 0.28, this.h * 0.60);

    c.font = '700 34px "Segoe UI", system-ui, sans-serif';
    c.fillText(String(Math.round(speedKmh)), this.w * 0.68, this.h * 0.55);
    c.font = '600 15px "Segoe UI", system-ui, sans-serif';
    c.fillStyle = '#8d97a3';
    c.fillText('km/h', this.w * 0.68, this.h * 0.80);

    if (overtakeReady) {
      c.fillStyle = '#12d16b';
      c.fillRect(this.w * 0.08, this.h * 0.86, this.w * 0.22, 6);
    }

    this.texture.needsUpdate = true;
  }
}

export class Cockpit {
  readonly group = new THREE.Group();

  private readonly wheel = new THREE.Group();
  private readonly display = new WheelDisplay();
  private readonly revStrip: THREE.Mesh;
  private readonly outline = outlineMaterial();

  constructor() {
    this.buildTub();
    this.buildHalo();
    this.buildMirrors();
    this.buildNose();
    this.revStrip = this.buildWheel();
    this.group.add(this.wheel);
    this.drawOutlines();
  }

  /**
   * A line round every part of the cockpit.
   *
   * Done in one pass at the end rather than at each call site: the
   * cockpit is thirty small parts and threading a hull through every
   * one of them would bury what each part actually is under bookkeeping
   * about how it is drawn.
   *
   * Flat faces are skipped. An inverted hull works by pushing a closed
   * surface out along its normals, and a plane is not closed — every
   * normal points the same way, so the hull is the same plane shifted
   * forward, which lands it exactly on top of the thing it was meant to
   * outline. That is fine for a mirror and fatal for the display, which
   * is the one part of the cockpit you have to be able to read.
   */
  private drawOutlines(): void {
    const meshes: THREE.Mesh[] = [];
    this.group.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh || !mesh.geometry) return;
      if (mesh.userData.noOutline || mesh.userData.outline) return;
      meshes.push(mesh);
    });
    // Added after the walk, or the traverse would find the hulls it
    // just made and start outlining those.
    for (const mesh of meshes) mesh.add(outlineMesh(mesh.geometry, this.outline));
  }

  /** Line weight is in pixels, so it has to be told about the viewport. */
  setScreenHeight(height: number): void {
    this.outline.uniforms.screenHeight!.value = height;
  }

  /**
   * The tub around the driver.
   *
   * Built from separate panels rather than a box. A box with the eye
   * inside it puts its own front wall between the driver and the road —
   * whichever way the faces point, there is a surface 0.8 m ahead
   * spanning the whole view. Real tubs are open at the front and top
   * because that is where the driver looks, so this one is too: floor,
   * two side walls, a rear bulkhead, and nothing in front.
   */
  private buildTub(): void {
    const wall = mat(CARBON, 0.75);

    const floor = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.05, 1.9), wall);
    floor.position.set(0, 0.05, 0.15);
    this.group.add(floor);

    // Side walls, at the edge of vision — they give the peripheral sense
    // of sitting down inside the car rather than on it. They stop short
    // of the eye so they frame the view instead of narrowing it.
    for (const side of [-1, 1]) {
      const side_ = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.46, 1.9), wall);
      side_.position.set(side * 0.37, 0.26, 0.15);
      this.group.add(side_);

      const rim = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.05, 1.9), mat(CARBON_LIGHT, 0.6));
      rim.position.set(side * 0.37, 0.50, 0.15);
      this.group.add(rim);
    }

    const bulkhead = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.5, 0.05), wall);
    bulkhead.position.set(0, 0.26, 1.08);
    this.group.add(bulkhead);

    const headrest = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.30, 0.14), mat(0x2a3038, 0.95));
    headrest.position.set(0, 0.60, 0.62);
    this.group.add(headrest);
  }

  /**
   * Halo hoop and its centre pillar.
   *
   * The half-torus is rotated into the horizontal plane, where it draws
   * the front half of a ring centred `HALO_Z` behind its own front
   * point — so the hoop reaches its closest approach to the driver at
   * `HALO_Z - HALO_R`, and the pillar has to stand exactly there or the
   * two do not meet.
   */
  private buildHalo(): void {
    const halo = mat(CARBON, 0.55, 0.2);

    const HALO_R = 0.50;
    const HALO_Z = -0.55;
    // Above the eye, not level with it. At eye height the hoop lies
    // exactly along the horizon and reads as a bar drawn across the
    // middle of the world — which is the one place it must not be, since
    // the horizon is where the corner appears.
    const HALO_Y = 0.76;

    const ring = new THREE.Mesh(new THREE.TorusGeometry(HALO_R, 0.028, 10, 40, Math.PI), halo);
    ring.rotation.set(-Math.PI / 2, 0, 0);
    ring.position.set(0, HALO_Y, HALO_Z);
    this.group.add(ring);

    // Rear legs, from the hoop's ends back down into the tub sides.
    for (const side of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.036, 0.52, 8), halo);
      leg.position.set(side * HALO_R, HALO_Y - 0.25, HALO_Z + 0.02);
      leg.rotation.z = side * 0.20;
      this.group.add(leg);
    }

    /* There is no centre pillar, and there was.
     *
     * A real halo has one, it is the most recognisable thing about the
     * modern cockpit, and it was kept deliberately thin here on the
     * argument that a real one subtends about two degrees. All of that
     * is true and none of it survived contact with the screen: two
     * degrees of a windscreen is a detail you look past, and two
     * degrees of a 1280-pixel viewport is a bar standing exactly where
     * the apex appears, in the one part of the frame you steer with.
     *
     * Broadcast has the same problem and solves it the same way — the
     * onboard camera is mounted above the halo rather than behind it,
     * so the pillar is out of shot. This is that camera. */
  }

  /** Mirrors on stalks, out at the edge of the tub. */
  private buildMirrors(): void {
    const stalkMat = mat(CARBON, 0.7);
    // Unlit: a mirror drawn flat is a pale shape, and shading it would
    // only make it a slightly different pale shape.
    const glassMat = new THREE.MeshBasicMaterial({ color: 0x9dc0d8 });

    // Well forward of the eye, on the tub shoulder. Level with the head
    // they were effectively at arm's reach sideways, which made a 20 cm
    // housing swallow a quarter of the screen.
    const MIRROR_Z = -0.78;
    const MIRROR_X = 0.50;
    const MIRROR_Y = 0.47;

    for (const side of [-1, 1]) {
      const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.017, 0.22, 6), stalkMat);
      stalk.position.set(side * (MIRROR_X - 0.07), MIRROR_Y - 0.04, MIRROR_Z + 0.10);
      stalk.rotation.z = side * 0.75;
      this.group.add(stalk);

      const housing = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.068, 0.035), stalkMat);
      housing.position.set(side * MIRROR_X, MIRROR_Y, MIRROR_Z);
      housing.rotation.y = side * 0.30;
      this.group.add(housing);

      const glass = new THREE.Mesh(new THREE.PlaneGeometry(0.125, 0.048), glassMat);
      glass.position.set(side * MIRROR_X, MIRROR_Y, MIRROR_Z + 0.019);
      glass.rotation.y = Math.PI + side * 0.30;
      glass.userData.noOutline = true;
      this.group.add(glass);
    }
  }

  /** The nose and front suspension, seen stretching away ahead. */
  private buildNose(): void {
    const body = mat(0xd0d4d8, 0.45, 0.15);
    const accent = mat(0xe2000f, 0.4);

    // Starts just past the halo pillar's foot and runs away to the tip,
    // so the two read as one continuous piece of bodywork.
    const deck = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.10, 1.10), body);
    deck.position.set(0, 0.20, -1.55);
    this.group.add(deck);

    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.13, 0.9), body);
    tip.position.set(0, 0.15, -2.45);
    this.group.add(tip);

    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.02, 1.05), accent);
    stripe.position.set(0, 0.255, -1.55);
    this.group.add(stripe);

    // Front pushrods, angling out to where the wheels are. At speed
    // these are what shows the suspension working.
    for (const side of [-1, 1]) {
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.75, 6), mat(CARBON_LIGHT, 0.6));
      rod.position.set(side * 0.42, 0.10, -1.55);
      rod.rotation.z = side * 0.85;
      this.group.add(rod);
    }
  }

  /** The steering wheel. Returns the rev-light strip for per-frame updates. */
  private buildWheel(): THREE.Mesh {
    const rimMat = mat(0x191d23, 0.8);

    // A modern F1 wheel is a squared-off yoke, not a circle: two grips
    // and a flat top and bottom.
    const hub = new THREE.Mesh(new THREE.BoxGeometry(0.20, 0.13, 0.035), rimMat);
    this.wheel.add(hub);

    for (const side of [-1, 1]) {
      const grip = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.20, 0.05), rimMat);
      grip.position.set(side * 0.155, -0.01, 0);
      this.wheel.add(grip);

      const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.045, 0.03), rimMat);
      spoke.position.set(side * 0.085, 0, 0);
      this.wheel.add(spoke);

      // Shift paddle, behind the wheel.
      const paddle = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.09, 0.012), mat(0x3a4048, 0.5, 0.4));
      paddle.position.set(side * 0.13, -0.02, 0.055);
      this.wheel.add(paddle);
    }

    const face = new THREE.Mesh(
      new THREE.PlaneGeometry(0.185, 0.095),
      new THREE.MeshBasicMaterial({ map: this.display.texture })
    );
    face.position.set(0, 0.005, -0.019);
    face.rotation.y = Math.PI;
    face.userData.noOutline = true;
    this.wheel.add(face);

    // Below and ahead of the eye, tilted back towards the driver the way
    // a real column is. The distance is arm's length rather than the
    // 0.37 m of a first pass — too close and the wheel eats the road
    // where the apex appears.
    this.wheel.position.set(0, 0.30, -0.68);
    this.wheel.rotation.x = -0.42;

    return face;
  }

  /**
   * Per-frame update.
   *
   * `steer` is the −1..1 control value, not the road-wheel angle: the
   * wheel in your hands turns much further than the tyres do, and using
   * the tyre angle here makes the car look like it is barely steering.
   */
  update(
    steer: number,
    gear: number,
    speedKmh: number,
    revFraction: number,
    overtakeReady: boolean
  ): void {
    // A little over a quarter turn each way at full lock, which is what
    // the yoke of a car with this rack actually does.
    this.wheel.rotation.z = -steer * 2.1;
    this.display.update(gear, speedKmh, revFraction, overtakeReady);
    void this.revStrip;
  }

  setVisible(visible: boolean): void {
    this.group.visible = visible;
  }
}
