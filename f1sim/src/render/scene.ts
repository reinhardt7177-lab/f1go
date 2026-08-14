/**
 * Rendering. Reads `VehicleState` snapshots and draws them — it never
 * writes to the simulation, and the simulation never imports this file.
 */
import * as THREE from 'three';

import { quatSlerp, v3lerp, vec3 } from '../core/math';
import type { Quat, Vec3 } from '../core/math';
import type { VehicleState } from '../sim/types';

export type CameraMode = 'cockpit' | 'chase' | 'trackside';

export class SceneRenderer {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly carGroup = new THREE.Group();
  private readonly wheelMeshes: THREE.Object3D[] = [];

  cameraMode: CameraMode = 'chase';

  /** Previous and current sim snapshots, blended by `alpha` when drawing. */
  private prev: VehicleState | null = null;
  private curr: VehicleState | null = null;
  private prevWheels: Vec3[] = [];
  private currWheels: Vec3[] = [];

  private smoothedCamPos = new THREE.Vector3(0, 5, 12);

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // Fog has to reach far enough that the road ahead reads as ground
    // rather than as a void — at 300 km/h the car covers 85 m a second,
    // so a 500 m draw distance is under six seconds of visibility.
    this.scene.background = new THREE.Color(0x121820);
    this.scene.fog = new THREE.Fog(0x121820, 350, 2200);

    this.camera = new THREE.PerspectiveCamera(68, 1, 0.1, 4000);

    this.buildLighting();
    this.buildTestPad();
    this.buildCar();

    this.scene.add(this.carGroup);
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  private buildLighting(): void {
    this.scene.add(new THREE.HemisphereLight(0x9fb6c8, 0x20262c, 1.1));

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
   * Stage one is a skid pad: a flat surface with distance references so
   * you can actually read what the car is doing. Grid lines every 10 m,
   * a 50 m radius circle for steady-state cornering, and gate markers
   * down the straight for braking tests.
   */
  private buildTestPad(): void {
    const pad = new THREE.Mesh(
      new THREE.PlaneGeometry(6000, 6000),
      new THREE.MeshStandardMaterial({ color: 0x353b43, roughness: 0.95, metalness: 0 })
    );
    pad.rotation.x = -Math.PI / 2;
    pad.receiveShadow = true;
    this.scene.add(pad);

    // 10 m grid. Without a reference like this a flat plane gives no
    // sense of speed at all, which makes the whole bench useless.
    const grid = new THREE.GridHelper(6000, 600, 0x6f7f8d, 0x525d68);
    grid.position.y = 0.01;
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.75;
    this.scene.add(grid);

    // Skid-pad circle: hold a steady radius here to read peak lateral g.
    const circle = new THREE.Mesh(
      new THREE.RingGeometry(49.85, 50.15, 256),
      new THREE.MeshBasicMaterial({ color: 0xe2000f, side: THREE.DoubleSide })
    );
    circle.rotation.x = -Math.PI / 2;
    circle.position.set(0, 0.02, -50);
    this.scene.add(circle);

    // Distance boards down the straight, for braking tests.
    const boardGeo = new THREE.BoxGeometry(0.15, 1.6, 2.6);
    const boardMat = new THREE.MeshStandardMaterial({ color: 0xf5c518, roughness: 0.6 });
    for (let i = 1; i <= 24; i++) {
      const board = new THREE.Mesh(boardGeo, boardMat);
      board.position.set(9, 0.8, -i * 100);
      board.castShadow = true;
      this.scene.add(board);
    }
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
    this.carGroup.add(tub);

    const nose = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.18, 1.4), bodyMat);
    nose.position.set(0, -0.05, -2.1);
    nose.castShadow = true;
    this.carGroup.add(nose);

    const frontWing = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.08, 0.5), accentMat);
    frontWing.position.set(0, -0.16, -2.75);
    frontWing.castShadow = true;
    this.carGroup.add(frontWing);

    const rearWing = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.1, 0.42), accentMat);
    rearWing.position.set(0, 0.52, 2.2);
    rearWing.castShadow = true;
    this.carGroup.add(rearWing);

    const airbox = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.34, 0.7), darkMat);
    airbox.position.set(0, 0.36, 0.9);
    this.carGroup.add(airbox);

    const halo = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.045, 8, 24, Math.PI), darkMat);
    halo.rotation.set(-Math.PI / 2, 0, 0);
    halo.position.set(0, 0.26, -0.35);
    this.carGroup.add(halo);

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

    this.updateCamera(pos, rot, frameDt);
    this.renderer.render(this.scene, this.camera);
  }

  private updateCamera(pos: Vec3, rot: Quat, frameDt: number): void {
    const q = new THREE.Quaternion(rot.x, rot.y, rot.z, rot.w);
    const carPos = new THREE.Vector3(pos.x, pos.y, pos.z);

    if (this.cameraMode === 'cockpit') {
      const eye = new THREE.Vector3(0, 0.52, -0.15).applyQuaternion(q).add(carPos);
      this.camera.position.copy(eye);
      this.camera.quaternion.copy(q);
      this.camera.fov = 78;
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
      this.camera.position.set(28, 14, 18);
      this.camera.lookAt(carPos);
      this.camera.fov = 40;
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
