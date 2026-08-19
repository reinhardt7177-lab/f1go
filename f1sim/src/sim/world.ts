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

export interface BarrierParams {
  /**
   * Restoring acceleration per metre past the edge (1/s^2).
   *
   * A spring rather than a wall, so a car arriving at a shallow angle
   * is eased back rather than stopped.
   */
  stiffness: number;
  /** Most it may ever pull (m/s^2). */
  maxAccel: number;
  /** Damping on outward lateral speed, so the car does not bounce. */
  damping: number;
  /** How far inside the barrier the force starts (m). */
  margin: number;
  /** Outward velocity removed per second once past the line. */
  absorb: number;
  /** Depth past the line at which absorption is at full strength (m). */
  absorbDepth: number;
}

export const defaultBarrier = (): BarrierParams => ({
  stiffness: 9,
  /* A little over 1 g of spring, which is what turns a car that has
     drifted wide back towards the road. */
  maxAccel: 12,
  damping: 2.5,
  /* Half a car's width, so the force starts as the bodywork reaches the
     wall rather than as the centreline does. */
  margin: 1,
  /* And this is what actually stops a car going through.
   *
   * A spring alone cannot. Force takes time to change momentum, and a
   * car arriving at 140 km/h square to the wall carries more of it than
   * twelve metres per second squared can turn round before it is
   * already nine metres into the grass — which is exactly what it did:
   * the wall was drawn and the car sailed over it.
   *
   * So past the line the outward part of the velocity is taken away
   * directly, a share of it each tick. That is what a wall does. The
   * share ramps with depth rather than biting at full strength on
   * contact, so brushing the barrier is a nudge and driving squarely
   * into it is a firm, quick stop — never the instant dead halt that
   * would flip the car, which is the whole reason the wall is not a
   * collider in the first place.
   */
  absorb: 14,
  /* Depth at which absorption reaches full strength (m). */
  absorbDepth: 1.5
});

/**
 * Another car to bump into.
 *
 * Deliberately the smallest thing that can be collided with — a place
 * and a direction. The rivals are run kinematically along the racing
 * line by `race/field.ts` and are not rigid bodies, so there is nothing
 * here to solve a contact against; what this gives is enough to push
 * the player off them, which is what "you cannot drive through another
 * car" actually has to mean.
 */
export interface TrafficBody {
  position: Vec3;
  heading: number;
}

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

  /**
   * Keeps the car on the circuit, or null to let it leave.
   *
   * Null by default, which is why no existing test moves. The wall the
   * player sees is drawn by `render/barrier.ts` and is deliberately not
   * in the collider: a thin wall in a trimesh is something a fast car
   * goes through or climbs, and a car that hits one squarely stops dead
   * or flips. This leans on it instead. Both read the edge from the
   * same cross-section, so they cannot disagree about where it is.
   */
  barrier: BarrierParams | null = null;

  /**
   * The rest of the field, for contact. Empty means an open circuit.
   *
   * Set every tick by the composition root rather than owned here,
   * because the field belongs to `race/` and this is `sim/` — the
   * simulation is told where the other cars are, it does not go and
   * find out.
   */
  traffic: readonly TrafficBody[] = [];

  /**
   * Indices of the traffic touched this tick.
   *
   * A kinematic car cannot be pushed by an impulse, so the half of the
   * contact that acts on the rival has to be done by whoever owns it.
   * This is how it finds out.
   */
  readonly contacts: number[] = [];

  private projectionHint: number | undefined = undefined;

  constructor(params: VehicleParams = defaultVehicleParams(), options: WorldOptions = {}) {
    this.physics = new RAPIER.World({ x: 0, y: -GRAVITY, z: 0 });

    this.circuit = getCircuit(options.circuitId ?? 'redbullring');
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
  gridSlot(distance: number, lateral = 0): { position: Vec3; heading: number } {
    const sample = this.circuit.spline.sampleAt(distance);

    // `Vehicle.reset` takes a yaw about +Y, and rotating the forward axis
    // (0, 0, -1) by yaw θ gives (-sin θ, 0, -cos θ). Solving that for the
    // spline's tangent is where the two minus signs come from — get them
    // wrong and the car is mirrored across the road, which looks fine at
    // the start line, where the tangent happens to be -Z, and sends the
    // car straight off the circuit everywhere else.
    return {
      position: vec3(
        sample.position.x + sample.left.x * lateral,
        sample.position.y + 0.5,
        sample.position.z + sample.left.z * lateral
      ),
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
    /* After the vehicle, not before it: `Vehicle.step` clears the
       body's accumulated forces on its way in, so anything added ahead
       of it is wiped before the solver ever sees it. */
    this.applyBarrier();
    this.applyTraffic();
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

  /**
   * Lean on a car that has gone past the edge of the circuit.
   *
   * Uses last tick's projection rather than re-projecting: at 120 Hz
   * that is eight milliseconds of lag against a force that ramps over
   * metres, and projecting twice a tick to save it would be the most
   * expensive thing in the loop.
   */
  private applyBarrier(): void {
    const p = this.barrier;
    if (!p) return;

    const edge =
      this.circuit.halfWidthAt(this.distance) +
      this.circuit.kerbWidth +
      this.circuit.runoffAt(this.distance) -
      p.margin;

    const over = Math.abs(this.lateral) - edge;
    if (over <= 0) return;

    const sample = this.circuit.spline.sampleAt(this.distance);
    // `left` is +t, so pushing back in is away from whichever side the
    // car has drifted to.
    const side = Math.sign(this.lateral);
    const inward = -side;

    const velocity = this.car.body.linvel();
    const outward = (velocity.x * sample.left.x + velocity.z * sample.left.z) * side;

    const mass = this.car.params.chassis.mass;
    const accel = Math.min(p.stiffness * over, p.maxAccel) + p.damping * Math.max(0, outward);
    const force = accel * mass * inward;

    this.car.body.addForce(
      { x: sample.left.x * force, y: 0, z: sample.left.z * force },
      true
    );

    /* And take the outward momentum away directly, because a force
       cannot do it fast enough — see `defaultBarrier`. Ramped with
       depth so the first touch is a nudge, and applied as an impulse so
       it is independent of how hard the car is being driven into it. */
    if (outward > 0) {
      const depth = Math.min(over / p.absorbDepth, 1);
      const removed = Math.min(1, p.absorb * depth * this.physics.timestep) * outward;
      const impulse = -removed * mass * side;
      this.car.body.applyImpulse(
        { x: sample.left.x * impulse, y: 0, z: sample.left.z * impulse },
        true
      );
    }
  }

  /**
   * Keep the player out of the other cars.
   *
   * Both are approximated by two circles a couple of metres apart —
   * near enough to a five-metre single-seater that you cannot drive
   * through one lengthways, and far cheaper than a real contact solve
   * against nine bodies that do not exist as bodies.
   *
   * The response is a push and an absorption, exactly like the barrier
   * and for exactly the same reason: a hard contact at a closing speed
   * of fifty km/h launches a light car with a flat floor, and a
   * ten-year-old who is nudged off line will keep racing where one who
   * has been fired into the scenery will not.
   */
  private applyTraffic(): void {
    this.contacts.length = 0;
    if (this.traffic.length === 0) return;

    const RADIUS = 1.15;
    const REACH = 1.9;

    const pos = this.car.body.translation();
    const rot = this.car.body.rotation();
    // Forward is -Z; yaw straight out of the quaternion is enough here.
    const yaw = Math.atan2(
      2 * (rot.w * rot.y + rot.x * rot.z),
      1 - 2 * (rot.y * rot.y + rot.z * rot.z)
    );
    const mine = [-1, 1].map((end) => ({
      x: pos.x - Math.sin(yaw) * REACH * end,
      z: pos.z - Math.cos(yaw) * REACH * end
    }));

    const mass = this.car.params.chassis.mass;
    const velocity = this.car.body.linvel();

    for (let i = 0; i < this.traffic.length; i++) {
      const other = this.traffic[i]!;
      // Cheap reject before the four circle tests.
      if (Math.abs(other.position.y - pos.y) > 3) continue;
      const dx = other.position.x - pos.x;
      const dz = other.position.z - pos.z;
      if (dx * dx + dz * dz > 100) continue;

      const theirs = [-1, 1].map((end) => ({
        x: other.position.x - Math.sin(other.heading) * REACH * end,
        z: other.position.z - Math.cos(other.heading) * REACH * end
      }));

      let deepest = 0;
      let nx = 0;
      let nz = 0;
      for (const a of mine) {
        for (const b of theirs) {
          const ex = a.x - b.x;
          const ez = a.z - b.z;
          const gap = Math.hypot(ex, ez);
          const overlap = RADIUS * 2 - gap;
          if (overlap > deepest && gap > 1e-6) {
            deepest = overlap;
            nx = ex / gap;
            nz = ez / gap;
          }
        }
      }
      if (deepest <= 0) continue;

      this.contacts.push(i);

      /* Push out of the other car, hard enough to separate within a
         few ticks but as a force rather than a teleport. */
      const push = deepest * 60 * mass;
      this.car.body.addForce({ x: nx * push, y: 0, z: nz * push }, true);

      // And take away the part of the closing speed that is into it.
      const closing = -(velocity.x * nx + velocity.z * nz);
      if (closing > 0) {
        const removed = Math.min(1, 12 * this.physics.timestep) * closing * mass;
        this.car.body.applyImpulse({ x: nx * removed, y: 0, z: nz * removed }, true);
      }
    }
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
