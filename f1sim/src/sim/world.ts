/**
 * The simulation world: physics, the circuit, and the cars in it.
 *
 * Deliberately free of any rendering dependency, so it can be stepped
 * headlessly in a test, on a server for multiplayer authority, or inside
 * a training loop for the AI. `main.ts` is the only place the renderer
 * and this module meet.
 */
import RAPIER from '@dimforge/rapier3d-compat';

import { GRAVITY, vec3 } from '../core/math';
import type { Vec3 } from '../core/math';
import { LapTimer } from '../race/timing';
import type { CompletedLap } from '../race/timing';
import { getCircuit } from '../track/circuits';
import { buildTrackGeometry } from '../track/mesh';
import type { Circuit } from '../track/circuit';
import type { TrackGeometry } from '../track/mesh';
import { Vehicle, defaultVehicleParams } from './vehicle';
import type { VehicleParams } from './vehicle';

let rapierReady: Promise<void> | null = null;

/** Load the Rapier WebAssembly module once per process. */
export const initPhysics = (): Promise<void> => {
  rapierReady ??= RAPIER.init();
  return rapierReady;
};

export interface WorldOptions {
  circuitId?: string;
  /** Distance along the centreline to start from (m). */
  startDistance?: number;
}

export class SimWorld {
  readonly physics: RAPIER.World;
  readonly car: Vehicle;
  readonly circuit: Circuit;
  readonly geometry: TrackGeometry;
  readonly timer: LapTimer;

  /** Seconds of simulated time elapsed. */
  time = 0;
  /** Steps taken, the authoritative tick counter for replays. */
  tick = 0;

  /** Where the car is on the circuit right now. */
  distance = 0;
  lateral = 0;
  onTrack = true;
  /** Set for one tick when a lap is completed. */
  lapJustCompleted: CompletedLap | null = null;

  private projectionHint: number | undefined = undefined;

  constructor(params: VehicleParams = defaultVehicleParams(), options: WorldOptions = {}) {
    this.physics = new RAPIER.World({ x: 0, y: -GRAVITY, z: 0 });

    this.circuit = getCircuit(options.circuitId ?? 'spa');
    this.geometry = buildTrackGeometry(this.circuit);
    this.timer = new LapTimer(this.circuit);

    // One static trimesh for the whole circuit — road, kerbs, run-off and
    // the grass beyond. Which surface a wheel is on is answered by the
    // spline rather than by the collider, so the mesh carries geometry
    // only and there is no need to split it per material.
    const ground = this.physics.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    this.physics.createCollider(
      RAPIER.ColliderDesc.trimesh(this.geometry.positions, this.geometry.indices)
        .setFriction(1)
        .setRestitution(0),
      ground
    );

    // A catch floor well below the circuit. Without it a car that slides
    // past the edge of the track mesh falls for ever, and the projection
    // and timing keep running on a car that is kilometres underground.
    let lowest = Infinity;
    for (let i = 1; i < this.geometry.positions.length; i += 3) {
      lowest = Math.min(lowest, this.geometry.positions[i]!);
    }
    const floor = this.physics.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(0, lowest - 8, 0)
    );
    this.physics.createCollider(
      RAPIER.ColliderDesc.cuboid(6000, 2, 6000).setFriction(0.6),
      floor
    );

    const start = this.gridSlot(options.startDistance ?? 0);
    this.car = new Vehicle(this.physics, params, start.position);
    this.car.reset(start.position, start.heading);

    // Grip under each wheel comes from the circuit's lateral profile.
    this.car.surfaceSampler = (point: Vec3): number => {
      const p = this.circuit.spline.project(point, this.projectionHint);
      return this.circuit.gripAt(p.s, p.t);
    };
  }

  /** Position and heading on the centreline at a given distance. */
  gridSlot(distance: number): { position: Vec3; heading: number } {
    const sample = this.circuit.spline.sampleAt(distance);

    // `Vehicle.reset` takes a yaw about +Y, and rotating the forward axis
    // (0, 0, -1) by yaw θ gives (-sin θ, 0, -cos θ). Solving that for the
    // spline's tangent is where the two minus signs come from — get them
    // wrong and the car is mirrored across the road, which looks fine at
    // the start line, where the tangent happens to be -Z, and sends the
    // car straight off the circuit everywhere else.
    return {
      position: vec3(sample.position.x, sample.position.y + 0.5, sample.position.z),
      heading: Math.atan2(-sample.tangent.x, -sample.tangent.z)
    };
  }

  /** Put the car back on the racing line at its current position. */
  respawn(): void {
    const slot = this.gridSlot(this.distance);
    this.car.reset(slot.position, slot.heading);
    this.timer.resetLap();
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

    const pos = this.car.body.translation();
    const projection = this.circuit.spline.project(
      vec3(pos.x, pos.y, pos.z),
      this.projectionHint
    );
    this.projectionHint = projection.s;
    this.distance = projection.s;
    this.lateral = projection.t;
    this.onTrack = this.circuit.isOnTrack(projection.s, projection.t);

    this.lapJustCompleted = this.timer.update(projection.s, this.onTrack, dt);

    this.time += dt;
    this.tick++;
  }

  /** The section of circuit the car is currently on. */
  currentSection(): string {
    return this.circuit.sectionAt(this.distance);
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
