/**
 * Rendering. Reads `VehicleState` snapshots and draws them — it never
 * writes to the simulation, and the simulation never imports this file.
 */
import * as THREE from 'three';

import { quatSlerp, v3lerp, vec3 } from '../core/math';
import type { Quat, Vec3 } from '../core/math';
import type { Rival } from '../race/field';
import type { VehicleState } from '../sim/types';
import type { VehicleParams } from '../sim/vehicle';
import type { Circuit } from '../track/circuit';
import type { TrackGeometry } from '../track/mesh';
import { loadCarModel } from './carmodel';
import type { CarFit } from './carmodel';
import { buildCarGeometry, buildWheelGeometry } from './carbody';
import { Cockpit, EYE } from './cockpit';
import { buildBarriers } from './barrier';
import { RivalRenderer } from './rivals';
import { buildScenery } from './scenery';
import { TyreSmoke } from './smoke';
import { buildTrackInk, inkMaterial } from './trackink';
import { outlineMaterial, outlineMesh, toonMaterial, toonifyMaterials } from './toon';
import type { ScreenPoint } from '../ui/labels';

/**
 * Sky colours, zenith to horizon.
 *
 * The previous background was a single near-black value with a dark
 * green plane under it, which read as a void with a hard line across
 * the middle rather than as outdoors. A gradient plus a fog tinted to
 * the horizon value is most of what makes it a place.
 */
/*
 * Pushed up in saturation from the near-photographic values these
 * started as. Under toon shading a desaturated sky reads as overcast
 * rather than as restrained, and the cars — which are now flat colour
 * inside a black line — need a ground and a sky confident enough to sit
 * against without either looking like a mistake.
 */
const ZENITH = 0x2c7ac9;
const SKY_MID = 0x74b6ef;
const HORIZON = 0xdcecf7;

export type CameraMode = 'cockpit' | 'chase' | 'trackside';

export const CAMERA_MODES: CameraMode[] = ['cockpit', 'chase', 'trackside'];

/** Korean labels for the on-screen camera button. */
export const CAMERA_LABELS: Record<CameraMode, string> = {
  cockpit: '1인칭',
  chase: '3인칭',
  trackside: '중계'
};

export class SceneRenderer {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly carGroup = new THREE.Group();
  /** The blocked-out exterior. Hidden from the driver's seat. */
  private readonly bodyGroup = new THREE.Group();
  private readonly cockpit = new Cockpit();
  private readonly wheelMeshes: THREE.Object3D[] = [];

  /** Raw −1..1 steering request, for turning the cockpit wheel. */
  private controlSteer = 0;

  cameraMode: CameraMode = 'cockpit';

  /** Previous and current sim snapshots, blended by `alpha` when drawing. */
  private prev: VehicleState | null = null;
  private curr: VehicleState | null = null;
  private prevWheels: Vec3[] = [];
  private currWheels: Vec3[] = [];

  private smoothedCamPos = new THREE.Vector3(0, 5, 12);
  private sky: THREE.Mesh | null = null;

  /** The ink line, shared by the player's car so resize reaches it. */
  private readonly outline = outlineMaterial();

  /** Drawn from `field.rivals` once the field exists. */
  private rivalRenderer: RivalRenderer | null = null;
  private rivals: readonly Rival[] = [];

  private readonly smoke: TyreSmoke;

  /** Scratch for projecting world points, so labels allocate nothing. */
  private readonly projected = new THREE.Vector3();

  /**
   * True while the title card is up.
   *
   * The card used to be an opaque sheet, which meant the first thing
   * anyone saw of a racing game was a black rectangle — while behind
   * it the circuit, the grid and nine rivals were being drawn every
   * frame for nobody. This turns the camera into a slow orbit of the
   * car on its grid box instead, and the card becomes a caption over
   * it.
   */
  showcase = false;

  /** Seconds the showcase orbit has been running, for its angle. */
  private showcaseTime = 0;
  /** What `showcase` was last frame, so visibility is written once. */
  private showcaseApplied = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    track: TrackGeometry,
    private readonly params: VehicleParams,
    circuit?: Circuit
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    /* Hard shadows, and a smaller map than the soft ones needed. A drawn
       car does not cast a soft shadow — the blur was the most expensive
       thing in the frame and the least consistent with everything else
       on screen. The budget it frees is what pays for nine rivals. */
    this.renderer.shadowMap.type = THREE.BasicShadowMap;

    // Fog has to reach far enough that the road ahead reads as ground
    // rather than as a void — at 300 km/h the car covers 85 m a second,
    // so a 500 m draw distance is under six seconds of visibility.
    //
    // Its colour is the horizon's, not the sky's. That single choice is
    // what removes the seam: distant ground fades into exactly the value
    // the sky meets it with, so the two stop being separate surfaces
    // with a hard line between them and start being a landscape.
    /* Pushed back from 400 m. Fog is a photographic effect — it works by
       taking colour out of distance — and it was fighting everything
       else here: flat paint and a drawn line are the whole point, and
       both were being dissolved into pale grey by the time a rival was
       far enough ahead to be worth looking at. Far enough away now that
       it only softens the horizon, which is the one job it still has. */
    this.scene.fog = new THREE.Fog(HORIZON, 900, 3200);

    this.camera = new THREE.PerspectiveCamera(68, 1, 0.1, 4000);

    this.buildSky();
    this.buildLighting();
    this.buildTrack(track);
    /* What stands beside the road. Optional because the renderer can be
       built from geometry alone, and the scatter needs the circuit it
       came from — but a circuit with nothing to pass has no speed in
       it, so in practice this is always supplied. */
    if (circuit) this.scene.add(buildScenery(circuit));
    this.buildCar();

    // Both hang off the car, so neither needs its own transform maths —
    // they inherit position and attitude from the chassis for free.
    this.carGroup.add(this.bodyGroup);
    this.carGroup.add(this.cockpit.group);
    this.scene.add(this.carGroup);
    this.smoke = new TyreSmoke(this.scene);
    this.applyCameraMode();
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  /**
   * Hand the renderer the field to draw.
   *
   * Separate from the constructor because the field is built from the
   * racing line, which is built from the circuit — all of which happens
   * after there is something to render into.
   */
  setField(rivals: readonly Rival[]): void {
    this.rivals = rivals;
    this.rivalRenderer = new RivalRenderer(this.scene, rivals, this.params);
    this.rivalRenderer.setScreenHeight(this.canvas.clientHeight || 1080);
  }

  /**
   * Where a world point lands on screen, or null when it is behind the
   * eye — which `Vector3.project` reports as a point in front, and is
   * how a car behind you gets a name tag over the horizon.
   */
  worldToScreen(point: Vec3): ScreenPoint | null {
    const v = this.projected.set(point.x, point.y, point.z);
    const distance = v.distanceTo(this.camera.position);
    v.project(this.camera);
    if (v.z > 1) return null;

    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    return {
      x: (v.x * 0.5 + 0.5) * w,
      y: (-v.y * 0.5 + 0.5) * h,
      distance
    };
  }

  /**
   * A graded sky dome.
   *
   * A sphere seen from inside rather than a background texture, because
   * a background is painted flat behind everything and cannot put the
   * horizon at eye level — the gradient would slide with the camera and
   * the join with the ground would move. Geometry keeps the horizon
   * where the ground actually ends.
   *
   * Fog is off for the dome: it is nominally at infinity, and fogging it
   * towards the horizon colour would flatten the gradient to nothing.
   */
  private buildSky(): void {
    const canvas = document.createElement('canvas');
    canvas.width = 4;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;

    // A sphere's equator is at v = 0.5, and a canvas texture is flipped,
    // so the top of this image is the zenith and the *middle* of it is
    // the horizon — not the bottom. Putting the pale band at the bottom
    // of the gradient hides it under the ground and leaves the sky one
    // flat blue meeting the grass at a hard line, which is what the
    // first attempt did.
    /* Banded rather than blended, to match the shading on everything
       under it. Each stop is repeated at the next band's boundary, which
       is what makes the step hard — a smooth ramp over a drawn car reads
       as two different pictures in one frame. */
    const grad = ctx.createLinearGradient(0, 0, 0, 256);
    const hex = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;
    const bands: [number, number][] = [
      [0, ZENITH],
      [0.26, ZENITH],
      [0.26, SKY_MID],
      [0.42, SKY_MID],
      [0.42, HORIZON],
      [1, HORIZON]
    ];
    for (const [at, colour] of bands) grad.addColorStop(at, hex(colour));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 4, 256);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;

    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(3600, 32, 24),
      new THREE.MeshBasicMaterial({ map: texture, side: THREE.BackSide, fog: false })
    );
    // Rides with the camera so its edge is never reachable.
    dome.frustumCulled = false;
    this.sky = dome;
    this.scene.add(dome);
  }

  private buildLighting(): void {
    // Sky and ground bounce, taken from the two ends of the dome so the
    // lighting agrees with what is actually overhead.
    this.scene.add(new THREE.HemisphereLight(SKY_MID, 0x44502f, 1.5));

    const sun = new THREE.DirectionalLight(0xfff3dd, 2.2);
    sun.position.set(60, 90, 40);
    sun.castShadow = true;
    // Half the resolution the soft shadows needed: a hard edge at 1024
    // is crisper than a blurred one at 2048, and it is a quarter of the
    // memory and fill.
    sun.shadow.mapSize.set(1024, 1024);
    const d = 30;
    sun.shadow.camera.left = -d;
    sun.shadow.camera.right = d;
    sun.shadow.camera.top = d;
    sun.shadow.camera.bottom = -d;
    sun.shadow.camera.far = 250;
    this.scene.add(sun);
    this.scene.add(sun.target);
  }

  /**
   * The circuit, as one mesh.
   *
   * The geometry comes from `track/mesh.ts` — the same arrays that
   * became the physics collider, so what you drive on and what you see
   * cannot drift apart. Surfaces are distinguished by vertex colour, so
   * road, kerbs, run-off and grass all render in a single draw call.
   */
  private buildTrack(track: TrackGeometry): void {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(track.positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(track.normals, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(track.colors, 3));
    geometry.setIndex(new THREE.BufferAttribute(track.indices, 1));
    geometry.computeVertexNormals();

    /* Toon shading over the same vertex colours. The circuit is nearly
       flat-lit either way — it faces the sky — so what the change
       actually buys is consistency: tarmac shaded on a different model
       from the cars on it makes the cars look pasted on. */
    const surface = new THREE.Mesh(
      geometry,
      toonMaterial(0xffffff)
    );
    (surface.material as THREE.MeshToonMaterial).vertexColors = true;
    surface.receiveShadow = true;
    this.scene.add(surface);

    /* And the lines on it. Built from the same sweep the road was, so
       an edge and the line drawn along it cannot come apart. */
    const ink = new THREE.Mesh(buildTrackInk(track), inkMaterial());
    ink.receiveShadow = false;
    ink.castShadow = false;
    this.scene.add(ink);

    /* And the wall at the edge. Drawn only — `sim/world.ts` is what
       actually keeps the car in, by leaning on it rather than blocking
       it. Both read where the edge is from the same cross-section, so
       the wall the player sees and the line they are held at cannot
       drift apart. */
    this.scene.add(buildBarriers(track));

    // Ground plane, so the horizon is not empty space where the
    // circuit's own mesh runs out. Big enough to reach past the fog in
    // every direction. Its colour is a lit grass rather than the
    // near-black it was: under a real sky, ground that dark reads as a
    // hole rather than as a field.
    //
    // It has to sit under the whole circuit, not under the start line.
    // A plane at a fixed depth is only below the road while the road is
    // level, and Interlagos drops forty — so for most of a lap the
    // tarmac was underneath it and the view ahead was a field with a
    // road buried in it. Finding the lowest vertex of the track and
    // going below that makes it impossible for the ground to cover the
    // circuit, whatever the circuit does.
    //
    // The proper answer is terrain that follows the track rather than a
    // plane under it. This is the cheap version of that: correct about
    // what it must never do, crude about the rest.
    let lowest = Infinity;
    for (let i = 1; i < track.positions.length; i += 3) {
      if (track.positions[i]! < lowest) lowest = track.positions[i]!;
    }
    if (!Number.isFinite(lowest)) lowest = 0;

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(12000, 12000),
      // Exactly the grass in the track mesh, so the circuit's own
      // verges and the world beyond them are one field rather than two
      // greens meeting at a line.
      toonMaterial(0x548f47)
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = lowest - 1.2;
    ground.receiveShadow = true;
    this.scene.add(ground);
  }

  /**
   * A blocked-out open-wheeler. Deliberately primitive geometry: the
   * point of stage one is the physics, and a placeholder that is
   * obviously a placeholder is better than one pretending to be art.
   */
  /**
   * Replace the blocked-out body with a loaded model.
   *
   * Only the body goes: the wheels are positioned every frame from the
   * simulation's own wheel centres, so they have to stay the objects
   * the renderer already moves. A model whose wheels are welded to its
   * body would have them sliding through corners instead of following
   * the suspension.
   */
  async useCarModel(url: string, fit: CarFit): Promise<void> {
    const car = await loadCarModel(url, fit);
    for (const child of [...this.bodyGroup.children]) this.bodyGroup.remove(child);

    /* The model was fitted for a physically based renderer that is no
       longer running, and it has to be drawn rather than lit. */
    toonifyMaterials(car.object);

    /* Then a line round it. Collected first and added afterwards,
       because adding a child during a traverse would have the traverse
       walk into what it just made and outline the outline. */
    const meshes: THREE.Mesh[] = [];
    car.object.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (mesh.isMesh && mesh.geometry && !mesh.userData.outline) meshes.push(mesh);
    });
    // Parented to the mesh it belongs to, so it inherits that mesh's
    // transform exactly rather than needing it copied and maintained.
    for (const mesh of meshes) mesh.add(outlineMesh(mesh.geometry, this.outline));

    this.bodyGroup.add(car.object);
    console.info(
      '[render] car model:',
      Math.round(car.triangles),
      'triangles,',
      Math.round(car.wheelTriangles),
      'cut with the moulded wheels'
    );
  }

  private buildCar(): void {
    const { chassis, suspension } = this.params;
    const wheelCentreY = chassis.hardpointY - suspension.restLength;

    /* The same geometry the rivals are built from, in the player's
       colours. One car, ten liveries — which is also what makes the
       grid look like a grid rather than one detailed car being chased
       by nine simpler ones. */
    const car = buildCarGeometry(chassis, wheelCentreY);
    const livery: [THREE.BufferGeometry, THREE.Material][] = [
      [car.livery, toonMaterial(0xe8ebee)],
      [car.accent, toonMaterial(0xe2000f, { emissive: 0.18 })],
      [car.dark, toonMaterial(0x16191d)]
    ];

    for (const [geometry, material] of livery) {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.castShadow = true;
      mesh.add(outlineMesh(geometry, this.outline));
      this.bodyGroup.add(mesh);
    }

    /* The wheels stay separate, and have to: the simulation puts each
       one where its own suspension says it is, so they are placed in
       world space every frame rather than parented to the body. */
    const wheelGeo = buildWheelGeometry(chassis);
    /* Charcoal rather than the near-black it was. A black line round a
       black tyre is invisible, so the drawn version of a tyre has to be
       light enough for its own outline to show — which is exactly what
       an illustrator does, and for the same reason. */
    const wheelMat = toonMaterial(0x33393f);

    for (let i = 0; i < 4; i++) {
      const hub = new THREE.Group();
      const tyre = new THREE.Mesh(wheelGeo, wheelMat);
      tyre.castShadow = true;
      tyre.add(outlineMesh(wheelGeo, this.outline));
      hub.add(tyre);

      // A marker stripe so wheel spin and lockup are visible at a glance.
      const stripe = new THREE.Mesh(
        new THREE.BoxGeometry(0.4, 0.06, 0.62),
        toonMaterial(0xf5c518, { emissive: 0.2 })
      );
      hub.add(stripe);

      this.wheelMeshes.push(hub);
      this.scene.add(hub);
    }
  }

  /**
   * Show the cockpit only from the seat, and the exterior only from
   * outside. From inside, the blocked-out body would sit between the eye
   * and the road; from outside, the cockpit's own nose would z-fight the
   * body's.
   */
  private applyCameraMode(): void {
    /* The showcase orbit is outside the car whatever the camera mode
       says, so the body has to come back and the cockpit has to go —
       otherwise the title screen orbits a floating steering wheel with
       no car around it. */
    const inside = !this.showcase && this.cameraMode === 'cockpit';
    this.cockpit.setVisible(inside);
    this.bodyGroup.visible = !inside;
  }

  setCameraMode(mode: CameraMode): void {
    this.cameraMode = mode;
    this.applyCameraMode();
  }

  /** Advance to the next camera and return what it landed on. */
  cycleCamera(): CameraMode {
    const i = CAMERA_MODES.indexOf(this.cameraMode);
    this.setCameraMode(CAMERA_MODES[(i + 1) % CAMERA_MODES.length]!);
    return this.cameraMode;
  }

  /** The steering request, for the wheel in the driver's hands. */
  setControlSteer(steer: number): void {
    this.controlSteer = steer;
  }

  /** Hand the renderer a new simulation snapshot. */
  pushState(state: VehicleState, wheelCentres: Vec3[]): void {
    this.prev = this.curr;
    this.prevWheels = this.currWheels;
    this.curr = state;
    this.currWheels = wheelCentres.map((w) => vec3(w.x, w.y, w.z));
    this.prev ??= state;
    if (this.prevWheels.length === 0) this.prevWheels = this.currWheels;
  }

  render(alpha: number, frameDt: number): void {
    if (!this.curr || !this.prev) return;

    if (this.showcase !== this.showcaseApplied) {
      this.showcaseApplied = this.showcase;
      this.applyCameraMode();
    }

    const pos = v3lerp(this.prev.position, this.curr.position, alpha);
    const rot = quatSlerp(this.prev.rotation, this.curr.rotation, alpha);

    this.carGroup.position.set(pos.x, pos.y, pos.z);
    this.carGroup.quaternion.set(rot.x, rot.y, rot.z, rot.w);

    for (let i = 0; i < this.wheelMeshes.length; i++) {
      const a = this.prevWheels[i];
      const b = this.currWheels[i];
      if (!a || !b) continue;
      const p = v3lerp(a, b, alpha);
      const hub = this.wheelMeshes[i]!;
      hub.position.set(p.x, p.y, p.z);

      const steer = this.curr.steerAngles[i] ?? 0;
      const spin = this.curr.wheelSpin[i] ?? 0;
      hub.quaternion.set(rot.x, rot.y, rot.z, rot.w);
      hub.rotateY(-steer);
      hub.rotateX(spin);
    }

    if (this.cameraMode === 'cockpit') {
      const rpm = this.curr.engineRpm;
      // Rev lights only start to mean anything in the top third of the
      // range; below that they would be on constantly and tell you
      // nothing about when to pull the paddle.
      const revFraction = Math.max(0, Math.min(1, (rpm - 9000) / (15000 - 9000)));
      this.cockpit.update(
        this.controlSteer,
        this.curr.gear,
        Math.abs(this.curr.speed) * 3.6,
        revFraction,
        this.curr.overtakeCharge > 0.99
      );
    }

    this.rivalRenderer?.update(this.rivals, frameDt, this.params.chassis.wheelRadius);
    this.emitTyreSmoke(frameDt);
    this.smoke.update(frameDt);

    this.updateCamera(pos, rot, frameDt);
    // Point sizes are in pixels, and the lens changes with the camera.
    this.smoke.setProjection(this.canvas.clientHeight || 1080, this.camera.fov);
    // Centre the dome on the eye so its far edge is unreachable.
    this.sky?.position.copy(this.camera.position);
    this.renderer.render(this.scene, this.camera);
  }

  /**
   * Smoke off whichever tyres are sliding.
   *
   * Two ways a tyre lets go, and both belong on screen: a slip ratio
   * outside the rolling range is a locked brake or a spinning rear, and
   * a large slip angle is the car going somewhere other than where it
   * is pointed. The thresholds sit just past where the tyre model still
   * makes useful grip, so smoke means *you have lost something*, not
   * merely that the tyre is working.
   */
  private emitTyreSmoke(dt: number): void {
    const state = this.curr;
    if (!state) return;

    // Below walking pace a sliding tyre scrubs rather than smokes, and
    // a stationary car would otherwise sit in a cloud of its own.
    if (Math.abs(state.speed) < 4) return;

    const radius = this.params.chassis.wheelRadius;

    for (let i = 0; i < 4; i++) {
      const wheel = state.wheels[i]!;
      const centre = this.currWheels[i];
      if (!centre || !wheel.grounded) continue;

      const spinning = Math.max(0, Math.abs(wheel.slipRatio) - 0.2) / 0.45;
      const sliding = Math.max(0, Math.abs(wheel.slipAngle) - 0.17) / 0.2;
      const intensity = Math.min(1, Math.max(spinning, sliding));

      this.smoke.emit(
        i,
        vec3(centre.x, centre.y - radius, centre.z),
        intensity,
        state.velocity,
        dt
      );
    }
  }

  private updateCamera(pos: Vec3, rot: Quat, frameDt: number): void {
    const q = new THREE.Quaternion(rot.x, rot.y, rot.z, rot.w);
    const carPos = new THREE.Vector3(pos.x, pos.y, pos.z);

    if (this.showcase) {
      /* A slow walk around the car on its grid box.
       *
       * Low and close, because the point is the car rather than the
       * circuit: at eye height a single-seater is a silhouette, and
       * from a metre and a half up it is a shape you can see the floor,
       * the sidepod and the wing of. Slow enough — one turn every
       * fifty seconds — that it reads as a held shot rather than a
       * spin, and the angle is offset so the nose is never square to
       * the lens. */
      this.showcaseTime += frameDt;
      const angle = 2.1 + this.showcaseTime * 0.13;
      const radius = 9.5;
      this.camera.position.set(
        carPos.x + Math.sin(angle) * radius,
        carPos.y + 1.9,
        carPos.z + Math.cos(angle) * radius
      );
      this.camera.lookAt(carPos.x, carPos.y + 0.35, carPos.z);
      this.camera.fov = 34;
      this.camera.updateProjectionMatrix();
      return;
    }

    if (this.cameraMode === 'cockpit') {
      // The one shared eye position: the cockpit is laid out around this
      // point, so the camera has to use the same constant or the halo
      // and wheel end up in the wrong place relative to the view.
      const eye = EYE.clone().applyQuaternion(q).add(carPos);
      this.camera.position.copy(eye);
      this.camera.quaternion.copy(q);
      // Turned down from 78: a wide lens flattens the sense of speed and
      // pushes the apex out towards the edge of the frame, where the
      // distortion is worst and judging turn-in is hardest.
      this.camera.fov = 72;
    } else if (this.cameraMode === 'chase') {
      const want = new THREE.Vector3(0, 2.3, 7.5).applyQuaternion(q).add(carPos);
      // Exponential follow. The rate has to be high: a first-order filter
      // lags by roughly speed/rate, so at 85 m/s a rate of 9 would trail
      // the car by nearly ten metres and shrink it to a dot.
      const k = 1 - Math.exp(-frameDt * 24);
      this.smoothedCamPos.lerp(want, k);
      this.camera.position.copy(this.smoothedCamPos);
      this.camera.lookAt(carPos.x, carPos.y + 0.6, carPos.z);
      this.camera.fov = 62;
    } else {
      // A television camera: off to one side, high, holding the car in
      // frame. Fixed world coordinates would be useless on a seven
      // kilometre circuit.
      const offset = new THREE.Vector3(26, 9, 14).applyQuaternion(q).add(carPos);
      const k = 1 - Math.exp(-frameDt * 2.5);
      this.smoothedCamPos.lerp(offset, k);
      this.camera.position.copy(this.smoothedCamPos);
      this.camera.lookAt(carPos);
      this.camera.fov = 38;
    }
    this.camera.updateProjectionMatrix();
  }

  private resize(): void {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (w === 0 || h === 0) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    // The ink line is specified in pixels, so a phone and a projector
    // have to be told apart or one of them gets a line four times too
    // heavy for what it is drawing.
    this.outline.uniforms.screenHeight!.value = h;
    this.rivalRenderer?.setScreenHeight(h);
    this.cockpit.setScreenHeight(h);
  }
}
