/**
 * Rendering. Reads `VehicleState` snapshots and draws them — it never
 * writes to the simulation, and the simulation never imports this file.
 */
import * as THREE from 'three';

import { quatSlerp, v3lerp, vec3 } from '../core/math';
import type { Quat, Vec3 } from '../core/math';
import type { VehicleState } from '../sim/types';
import type { TrackGeometry } from '../track/mesh';
import { Cockpit, EYE } from './cockpit';

/**
 * Sky colours, zenith to horizon.
 *
 * The previous background was a single near-black value with a dark
 * green plane under it, which read as a void with a hard line across
 * the middle rather than as outdoors. A gradient plus a fog tinted to
 * the horizon value is most of what makes it a place.
 */
const ZENITH = 0x1d4b7c;
const SKY_MID = 0x63a0d2;
const HORIZON = 0xc6d7e2;

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

  constructor(private readonly canvas: HTMLCanvasElement, track: TrackGeometry) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // Fog has to reach far enough that the road ahead reads as ground
    // rather than as a void — at 300 km/h the car covers 85 m a second,
    // so a 500 m draw distance is under six seconds of visibility.
    //
    // Its colour is the horizon's, not the sky's. That single choice is
    // what removes the seam: distant ground fades into exactly the value
    // the sky meets it with, so the two stop being separate surfaces
    // with a hard line between them and start being a landscape.
    this.scene.fog = new THREE.Fog(HORIZON, 400, 2400);

    this.camera = new THREE.PerspectiveCamera(68, 1, 0.1, 4000);

    this.buildSky();
    this.buildLighting();
    this.buildTrack(track);
    this.buildCar();

    // Both hang off the car, so neither needs its own transform maths —
    // they inherit position and attitude from the chassis for free.
    this.carGroup.add(this.bodyGroup);
    this.carGroup.add(this.cockpit.group);
    this.scene.add(this.carGroup);
    this.applyCameraMode();
    this.resize();
    window.addEventListener('resize', () => this.resize());
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
    const grad = ctx.createLinearGradient(0, 0, 0, 256);
    const hex = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;
    grad.addColorStop(0, hex(ZENITH));
    grad.addColorStop(0.34, hex(SKY_MID));
    grad.addColorStop(0.5, hex(HORIZON));
    grad.addColorStop(1, hex(HORIZON));
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
    sun.shadow.mapSize.set(2048, 2048);
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

    const surface = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 })
    );
    surface.receiveShadow = true;
    this.scene.add(surface);

    // Ground plane far below, so the horizon is not empty space where
    // the circuit's own mesh runs out. Big enough to reach past the fog
    // in every direction. Its colour is a lit grass rather than the
    // near-black it was: under a real sky, ground that dark reads as a
    // hole rather than as a field.
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(12000, 12000),
      new THREE.MeshStandardMaterial({ color: 0x53703c, roughness: 1 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -1.2;
    ground.receiveShadow = true;
    this.scene.add(ground);
  }

  /**
   * A blocked-out open-wheeler. Deliberately primitive geometry: the
   * point of stage one is the physics, and a placeholder that is
   * obviously a placeholder is better than one pretending to be art.
   */
  private buildCar(): void {
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xd0d4d8, roughness: 0.45, metalness: 0.15 });
    const accentMat = new THREE.MeshStandardMaterial({ color: 0xe2000f, roughness: 0.4 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x16191d, roughness: 0.85 });

    const tub = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.36, 3.0), bodyMat);
    tub.position.set(0, 0.02, 0.1);
    tub.castShadow = true;
    this.bodyGroup.add(tub);

    const nose = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.18, 1.4), bodyMat);
    nose.position.set(0, -0.05, -2.1);
    nose.castShadow = true;
    this.bodyGroup.add(nose);

    const frontWing = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.08, 0.5), accentMat);
    frontWing.position.set(0, -0.16, -2.75);
    frontWing.castShadow = true;
    this.bodyGroup.add(frontWing);

    const rearWing = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.1, 0.42), accentMat);
    rearWing.position.set(0, 0.52, 2.2);
    rearWing.castShadow = true;
    this.bodyGroup.add(rearWing);

    const airbox = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.34, 0.7), darkMat);
    airbox.position.set(0, 0.36, 0.9);
    this.bodyGroup.add(airbox);

    const halo = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.045, 8, 24, Math.PI), darkMat);
    halo.rotation.set(-Math.PI / 2, 0, 0);
    halo.position.set(0, 0.26, -0.35);
    this.bodyGroup.add(halo);

    const wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.38, 20);
    wheelGeo.rotateZ(Math.PI / 2);
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x1b1e22, roughness: 0.9 });

    for (let i = 0; i < 4; i++) {
      const hub = new THREE.Group();
      const tyre = new THREE.Mesh(wheelGeo, wheelMat);
      tyre.castShadow = true;
      hub.add(tyre);

      // A marker stripe so wheel spin and lockup are visible at a glance.
      const stripe = new THREE.Mesh(
        new THREE.BoxGeometry(0.4, 0.06, 0.62),
        new THREE.MeshStandardMaterial({ color: 0xf5c518, roughness: 0.5 })
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
    const inside = this.cameraMode === 'cockpit';
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

    this.updateCamera(pos, rot, frameDt);
    // Centre the dome on the eye so its far edge is unreachable.
    this.sky?.position.copy(this.camera.position);
    this.renderer.render(this.scene, this.camera);
  }

  private updateCamera(pos: Vec3, rot: Quat, frameDt: number): void {
    const q = new THREE.Quaternion(rot.x, rot.y, rot.z, rot.w);
    const carPos = new THREE.Vector3(pos.x, pos.y, pos.z);

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
  }
}
