/**
 * The simulation world: physics plus the cars in it.
 *
 * Deliberately free of any rendering dependency, so it can be stepped
 * headlessly in a test, on a server for multiplayer authority, or inside
 * a training loop for the AI. `main.ts` is the only place the renderer
 * and this module meet.
 */
import RAPIER from '@dimforge/rapier3d-compat';

import { GRAVITY, vec3 } from '../core/math';
import type { Vec3 } from '../core/math';
import { Vehicle, defaultVehicleParams } from './vehicle';
import type { VehicleParams } from './vehicle';

let rapierReady: Promise<void> | null = null;

/** Load the Rapier WebAssembly module once per process. */
export const initPhysics = (): Promise<void> => {
  rapierReady ??= RAPIER.init();
  return rapierReady;
};

export interface SurfaceDescriptor {
  /** Half-extents of the drivable pad (m). */
  halfExtents: Vec3;
}

export class SimWorld {
  readonly physics: RAPIER.World;
  readonly car: Vehicle;

  /** Seconds of simulated time elapsed. */
  time = 0;
  /** Steps taken, the authoritative tick counter for replays. */
  tick = 0;

  constructor(params: VehicleParams = defaultVehicleParams(), surface?: SurfaceDescriptor) {
    this.physics = new RAPIER.World({ x: 0, y: -GRAVITY, z: 0 });

    // Stage one is a flat test pad. When `track/` grows a mesh generator
    // this is the only line that changes: swap the cuboid for a trimesh
    // collider built from the track spline.
    // Large enough that a full-throttle run to top speed stays on it —
    // this car covers 600 m in the eleven seconds it takes to reach
    // 300 km/h — and thick enough that a car pressed down by two tonnes
    // of aero load cannot tunnel through. The top face stays at y = 0.
    const pad = surface?.halfExtents ?? vec3(3000, 5, 3000);
    const ground = this.physics.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(0, -pad.y, 0)
    );
    this.physics.createCollider(
      RAPIER.ColliderDesc.cuboid(pad.x, pad.y, pad.z).setFriction(1).setRestitution(0),
      ground
    );

    this.car = new Vehicle(this.physics, params);
  }

  /**
   * Advance by exactly one fixed step.
   *
   * Order matters: vehicle forces are computed from the state left by the
   * previous solve, then handed to the solver in one integration.
   */
  step(dt: number): void {
    this.physics.timestep = dt;
    this.car.step(dt);
    this.physics.step();
    this.time += dt;
    this.tick++;
  }

  /**
   * A cheap hash of the dynamic state, used by the determinism test.
   * Any divergence between two runs shows up here within a few ticks.
   */
  stateHash(): number {
    const p = this.car.body.translation();
    const r = this.car.body.rotation();
    const v = this.car.body.linvel();
    let h = 2166136261;
    for (const n of [p.x, p.y, p.z, r.x, r.y, r.z, r.w, v.x, v.y, v.z]) {
      // Quantise before hashing so that only meaningful divergence counts.
      const q = Math.round(n * 1e6);
      h ^= q;
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  dispose(): void {
    this.physics.free();
  }
}
