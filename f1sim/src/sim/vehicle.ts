/**
 * The vehicle: a rigid chassis with four raycast wheels.
 *
 * Every tick each wheel casts a ray at the road, and the length of that
 * ray gives the spring compression, which gives the vertical load,
 * which — through the tyre model — gives the forces that actually move
 * the car. Nothing else touches the rigid body except aerodynamics.
 *
 * Convention: right-handed, +Y up, -Z forward, +X right (glTF/three.js).
 */
import RAPIER from '@dimforge/rapier3d-compat';

import { GRAVITY, RAD, clamp, quatRotate, quatRotateInverse, vec3 } from '../core/math';
import type { Vec3 } from '../core/math';
import { defaultAeroParams, groundEffect, solveAero } from './aero';
import type { AeroParams } from './aero';
import {
  brakeTorques,
  defaultDrivetrainParams,
  initialDrivetrainState,
  recoverEnergy,
  stepDrivetrain
} from './drivetrain';
import type { DrivetrainParams, DrivetrainState } from './drivetrain';
import { antiRollForce, defaultSuspensionParams, suspensionForce } from './suspension';
import type { SuspensionParams } from './suspension';
import {
  conditionGrip,
  defaultThermalParams,
  defaultTireParams,
  freshTire,
  solveTire,
  stepTireCondition
} from './tire';
import type { TireCondition, TireParams, TireThermalParams } from './tire';
import { FL, FR, RL, RR, emptyWheelTelemetry, neutralControls } from './types';
import type { ControlState, VehicleState, WheelTelemetry } from './types';

export interface ChassisParams {
  mass: number;
  /** Principal moments of inertia about the CG: [pitch, yaw, roll]. */
  inertia: Vec3;
  /** Half-extents of the collision box (m). */
  halfExtents: Vec3;
  /** Collider offset from the centre of mass (m). */
  colliderOffsetY: number;
  wheelbase: number;
  trackFront: number;
  trackRear: number;
  /** Fraction of static weight on the front axle. */
  frontWeightBias: number;
  /** Height of the suspension hardpoints above the CG (m). */
  hardpointY: number;
  wheelRadius: number;
  /** Rotational inertia of one wheel assembly (kg m^2). */
  wheelInertia: number;
  /** Maximum steering angle at the wheel (rad). */
  maxSteerAngle: number;
  /**
   * Fraction of steering lock still available at 300 km/h. Real cars get
   * this from the steering rack; here it stops the car being twitchy.
   */
  steerSpeedFactor: number;
}

export const defaultChassisParams = (): ChassisParams => ({
  mass: 798,
  inertia: vec3(1000, 1100, 150),
  // The collider must clear the road at every point in suspension
  // travel. If its underside can touch, the car rests on the box and the
  // springs stop carrying load — downforce then never reaches the tyres.
  // At the 0.30 m static ride height this leaves 60 mm of clearance,
  // which is exactly the suspension's travel.
  halfExtents: vec3(0.9, 0.14, 2.5),
  colliderOffsetY: -0.1,
  wheelbase: 3.6,
  trackFront: 1.6,
  trackRear: 1.55,
  frontWeightBias: 0.45,
  hardpointY: 0.16,
  wheelRadius: 0.36,
  wheelInertia: 1.8,
  maxSteerAngle: 20 * RAD,
  steerSpeedFactor: 0.45
});

export interface VehicleParams {
  chassis: ChassisParams;
  tire: TireParams;
  thermal: TireThermalParams;
  aero: AeroParams;
  drivetrain: DrivetrainParams;
  suspension: SuspensionParams;
}

export const defaultVehicleParams = (): VehicleParams => ({
  chassis: defaultChassisParams(),
  tire: defaultTireParams(),
  thermal: defaultThermalParams(),
  aero: defaultAeroParams(),
  drivetrain: defaultDrivetrainParams(),
  suspension: defaultSuspensionParams()
});

/** Below this speed slip ratio and slip angle are ill-conditioned. */
const SLIP_SPEED_FLOOR = 3.0;

/**
 * Tyre relaxation length (m).
 *
 * A carcass does not develop its cornering force the instant the wheel
 * is steered — it takes roughly half a metre of rolling for the tread to
 * deflect and the force to build. Modelling that lag is most of the
 * difference between a car that feels connected and one that feels like
 * it is on rails until it suddenly is not.
 */
const RELAXATION_LENGTH = 0.5;

/**
 * Reports the grip multiplier of whatever surface is under a point.
 * `world.ts` wires this to the circuit; on a bare pad it stays null and
 * everything is treated as tarmac.
 */
export type SurfaceSampler = (point: Vec3) => number;

interface Wheel {
  /** Hardpoint in chassis-local space. */
  hardpoint: Vec3;
  steered: boolean;
  driven: boolean;
  front: boolean;
  omega: number;
  spin: number;
  compression: number;
  lastCompression: number;
  telemetry: WheelTelemetry;
  steerAngle: number;
  /** Contact point in world space, for the renderer's wheel placement. */
  contactY: number;
  /** Relaxed slip angle — lags the geometric one by the carcass. */
  relaxedSlipAngle: number;
  condition: TireCondition;
}

export class Vehicle {
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;

  params: VehicleParams;
  controls: ControlState = neutralControls();
  drivetrain: DrivetrainState;

  private readonly wheels: Wheel[] = [];
  private gLong = 0;
  private gLat = 0;
  private lastVelocity: Vec3 = vec3();
  private downforce = 0;
  private drag = 0;
  private rideHeightFront = 0.05;
  private rideHeightRear = 0.05;

  /** Set by the world when the car is on a circuit rather than a pad. */
  surfaceSampler: SurfaceSampler | null = null;

  constructor(
    private readonly world: RAPIER.World,
    params: VehicleParams = defaultVehicleParams(),
    spawn: Vec3 = vec3(0, 0.35, 0)
  ) {
    this.params = params;
    this.drivetrain = initialDrivetrainState(params.drivetrain);

    const c = params.chassis;

    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(spawn.x, spawn.y, spawn.z)
      .setLinearDamping(0)
      .setAngularDamping(0.08)
      .setCanSleep(false)
      // The body origin is the centre of mass, so the collider is offset
      // rather than the mass being offset.
      .setAdditionalMassProperties(
        c.mass,
        { x: 0, y: 0, z: 0 },
        { x: c.inertia.x, y: c.inertia.y, z: c.inertia.z },
        { x: 0, y: 0, z: 0, w: 1 }
      );

    this.body = world.createRigidBody(bodyDesc);

    const colliderDesc = RAPIER.ColliderDesc.cuboid(
      c.halfExtents.x,
      c.halfExtents.y,
      c.halfExtents.z
    )
      .setTranslation(0, c.colliderOffsetY, 0)
      .setDensity(0)
      .setFriction(0.2)
      .setRestitution(0);

    this.collider = world.createCollider(colliderDesc, this.body);

    // Front axle sits ahead of the CG (-Z) by the distance implied by the
    // weight bias: more weight on the front means the CG is closer to it.
    const front = -c.wheelbase * (1 - c.frontWeightBias);
    const rear = c.wheelbase * c.frontWeightBias;

    const make = (x: number, z: number, steered: boolean, driven: boolean, isFront: boolean): Wheel => ({
      hardpoint: vec3(x, c.hardpointY, z),
      steered,
      driven,
      front: isFront,
      omega: 0,
      spin: 0,
      compression: 0,
      lastCompression: 0,
      telemetry: emptyWheelTelemetry(),
      steerAngle: 0,
      contactY: 0,
      relaxedSlipAngle: 0,
      condition: freshTire(params.thermal)
    });

    this.wheels[FL] = make(-c.trackFront / 2, front, true, false, true);
    this.wheels[FR] = make(c.trackFront / 2, front, true, false, true);
    this.wheels[RL] = make(-c.trackRear / 2, rear, false, true, false);
    this.wheels[RR] = make(c.trackRear / 2, rear, false, true, false);
  }

  /** Bolt on a new set of tyres — cold, unworn. */
  fitFreshTires(): void {
    for (const w of this.wheels) {
      w.condition = freshTire(this.params.thermal);
      w.relaxedSlipAngle = 0;
    }
  }

  /** Hold the car still, as a pit stop does. */
  holdStationary(): void {
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    for (const w of this.wheels) w.omega = 0;
  }

  /** Average tyre wear across the four corners, 0..1. */
  averageWear(): number {
    return this.wheels.reduce((sum, w) => sum + w.condition.wear, 0) / this.wheels.length;
  }

  /** Put the car back on the road, upright and stationary. */
  reset(position: Vec3 = vec3(0, 0.35, 0), heading = 0): void {
    const half = heading / 2;
    this.body.setTranslation(position, true);
    this.body.setRotation({ x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.drivetrain = initialDrivetrainState(this.params.drivetrain);
    for (const w of this.wheels) {
      w.omega = 0;
      w.compression = 0;
      w.lastCompression = 0;
      w.relaxedSlipAngle = 0;
      w.condition = freshTire(this.params.thermal);
      w.telemetry = emptyWheelTelemetry();
    }
    this.gLong = 0;
    this.gLat = 0;
    this.lastVelocity = vec3();
  }

  step(dt: number): void {
    const { chassis, aero, tire, thermal, drivetrain, suspension } = this.params;

    this.body.resetForces(false);
    this.body.resetTorques(false);

    const rot = this.body.rotation();
    const pos = this.body.translation();
    const linvel = this.body.linvel();
    const angvel = this.body.angvel();

    const up = quatRotate(rot, vec3(0, 1, 0));
    const forward = quatRotate(rot, vec3(0, 0, -1));

    const velocity = vec3(linvel.x, linvel.y, linvel.z);
    const speedAlongForward =
      velocity.x * forward.x + velocity.y * forward.y + velocity.z * forward.z;

    // ---------------------------------------------------------------
    // Aerodynamics. Downforce is split front/rear and applied at the
    // axles, so the aero balance produces a real pitching moment rather
    // than a single force at the centre of mass.
    // ---------------------------------------------------------------
    const drsOpen = this.controls.drs;
    // Ride heights come from the previous tick's suspension state: the
    // rays for this tick have not been cast yet, and one step of lag is
    // immaterial next to the aero time constant.
    const air = solveAero(
      aero,
      Math.abs(speedAlongForward),
      drsOpen,
      this.rideHeightFront,
      this.rideHeightRear
    );
    this.downforce = air.downforce;
    this.drag = air.drag;

    const frontAxle = this.localToWorld(vec3(0, 0, -chassis.wheelbase * (1 - chassis.frontWeightBias)));
    const rearAxle = this.localToWorld(vec3(0, 0, chassis.wheelbase * chassis.frontWeightBias));

    this.body.addForceAtPoint(
      { x: -up.x * air.downforceFront, y: -up.y * air.downforceFront, z: -up.z * air.downforceFront },
      frontAxle,
      true
    );
    this.body.addForceAtPoint(
      { x: -up.x * air.downforceRear, y: -up.y * air.downforceRear, z: -up.z * air.downforceRear },
      rearAxle,
      true
    );

    const speedMag = Math.hypot(velocity.x, velocity.y, velocity.z);
    if (speedMag > 0.1) {
      const k = -air.drag / speedMag;
      this.body.addForce({ x: velocity.x * k, y: velocity.y * k, z: velocity.z * k }, true);
    }

    // ---------------------------------------------------------------
    // Steering, with lock reduced as speed rises.
    // ---------------------------------------------------------------
    const speedKmh = Math.abs(speedAlongForward) * 3.6;
    const lockScale =
      1 - (1 - chassis.steerSpeedFactor) * clamp(speedKmh / 300, 0, 1);
    const steerAngle = this.controls.steer * chassis.maxSteerAngle * lockScale;

    // ---------------------------------------------------------------
    // Suspension pass: cast every ray first so the anti-roll bars can
    // see both wheels on an axle before any force is applied.
    // ---------------------------------------------------------------
    const maxRay = suspension.restLength + chassis.wheelRadius + suspension.maxTravel;
    const contacts: (RayContact | null)[] = [];

    for (let i = 0; i < 4; i++) {
      const w = this.wheels[i]!;
      w.steerAngle = w.steered ? steerAngle : 0;
      const origin = this.localToWorld(w.hardpoint);
      const contact = this.castWheelRay(origin, up, maxRay);
      contacts[i] = contact;

      w.lastCompression = w.compression;
      if (contact) {
        const suspensionLength = contact.distance - chassis.wheelRadius;
        w.compression = suspension.restLength - suspensionLength;
        w.contactY = contact.point.y;
      } else {
        w.compression = -suspension.maxTravel;
        w.contactY = origin.y - maxRay;
      }
    }

    // Floor height above the road at each axle, for ground effect. The
    // reference plane sits under the chassis; the wheel radius plus the
    // extended suspension length gives the hardpoint height, and the
    // collider's underside is a fixed offset below that.
    const floorOffset =
      chassis.colliderOffsetY - chassis.halfExtents.y - chassis.hardpointY;
    const floorHeight = (w: Wheel): number =>
      chassis.wheelRadius + (suspension.restLength - w.compression) + floorOffset;

    this.rideHeightFront = Math.max(
      0,
      (floorHeight(this.wheels[FL]!) + floorHeight(this.wheels[FR]!)) / 2
    );
    this.rideHeightRear = Math.max(
      0,
      (floorHeight(this.wheels[RL]!) + floorHeight(this.wheels[RR]!)) / 2
    );

    const arbFront = antiRollForce(
      suspension.antiRollFront,
      this.wheels[FL]!.compression,
      this.wheels[FR]!.compression
    );
    const arbRear = antiRollForce(
      suspension.antiRollRear,
      this.wheels[RL]!.compression,
      this.wheels[RR]!.compression
    );

    // ---------------------------------------------------------------
    // Drivetrain, before the tyres so wheel torque is available below.
    // ---------------------------------------------------------------
    const driveTorques = stepDrivetrain(
      drivetrain,
      this.drivetrain,
      dt,
      this.controls.throttle,
      this.controls.shiftUp,
      this.controls.shiftDown,
      this.controls.ers,
      [this.wheels[RL]!.omega, this.wheels[RR]!.omega]
    );
    const brakes = brakeTorques(drivetrain, this.controls.brake);
    let brakingPower = 0;

    // ---------------------------------------------------------------
    // Per-wheel forces.
    // ---------------------------------------------------------------
    for (let i = 0; i < 4; i++) {
      const w = this.wheels[i]!;
      const contact = contacts[i];
      const t = w.telemetry;

      const driveTorque = w.driven ? (i === RL ? driveTorques[0] : driveTorques[1]) : 0;
      const brakeTorque = w.front ? brakes.front : brakes.rear;

      if (!contact) {
        // Airborne: the wheel still spins up under drive torque and slows
        // under braking, but generates nothing.
        w.omega += (driveTorque - Math.sign(w.omega) * brakeTorque) * (dt / chassis.wheelInertia);
        w.spin += w.omega * dt;
        t.grounded = false;
        t.load = 0;
        t.forceLong = 0;
        t.forceLat = 0;
        t.slipAngle = 0;
        t.slipRatio = 0;
        t.gripUsage = 0;
        t.compression = w.compression;
        t.omega = w.omega;

        // An airborne tyre still cools in the airstream.
        stepTireCondition(thermal, w.condition, 0, Math.hypot(linvel.x, linvel.z), dt, false);
        t.surfaceTemp = w.condition.surfaceTemp;
        t.coreTemp = w.condition.coreTemp;
        t.wear = w.condition.wear;
        continue;
      }

      // --- vertical load -------------------------------------------
      const compressionVelocity = (w.compression - w.lastCompression) / dt;
      const stiffness = w.front ? suspension.stiffnessFront : suspension.stiffnessRear;
      const damping = w.front ? suspension.dampingFront : suspension.dampingRear;

      let load = suspensionForce(
        stiffness,
        damping,
        w.compression,
        compressionVelocity,
        suspension.maxTravel
      );

      const arb = w.front ? arbFront : arbRear;
      load += i === FL || i === RL ? arb : -arb;
      load = Math.max(0, load);

      this.body.addForceAtPoint(
        { x: up.x * load, y: up.y * load, z: up.z * load },
        contact.point,
        true
      );

      // --- contact patch kinematics --------------------------------
      const r = vec3(contact.point.x - pos.x, contact.point.y - pos.y, contact.point.z - pos.z);
      const patchVelocity = vec3(
        linvel.x + (angvel.y * r.z - angvel.z * r.y),
        linvel.y + (angvel.z * r.x - angvel.x * r.z),
        linvel.z + (angvel.x * r.y - angvel.y * r.x)
      );

      // Into the wheel's frame: chassis frame, then the steer angle.
      const local = quatRotateInverse(rot, patchVelocity);
      const cos = Math.cos(w.steerAngle);
      const sin = Math.sin(w.steerAngle);
      const vLong = -(local.z * cos) + local.x * sin; // forward is -Z
      const vLat = local.x * cos + local.z * sin;

      const denom = Math.max(Math.abs(vLong), SLIP_SPEED_FLOOR);
      const geometricSlipAngle = Math.atan2(vLat, denom);

      // Relaxation: the carcass takes about half a metre of rolling to
      // build its cornering force, so the effective slip angle chases
      // the geometric one at a rate set by distance travelled, not time.
      const relaxRate = clamp((Math.abs(vLong) * dt) / RELAXATION_LENGTH, 0, 1);
      w.relaxedSlipAngle += (geometricSlipAngle - w.relaxedSlipAngle) * relaxRate;
      const slipAngle = w.relaxedSlipAngle;

      // Everything that scales the available friction without changing
      // the shape of the curve.
      const surfaceGrip = this.surfaceSampler ? this.surfaceSampler(contact.point) : 1;
      const gripScale = surfaceGrip * conditionGrip(thermal, w.condition);

      // --- wheel spin, sub-stepped ---------------------------------
      // The wheel/tyre pair is a stiff system: a wheel carries very
      // little rotational inertia against several thousand newton-metres
      // of drive torque, so at the outer timestep the slip ratio can
      // jump clean past the grip peak in one step. Past the peak the
      // tyre gives up force as slip grows, so the error compounds and
      // the wheel runs away into permanent wheelspin — a numerical
      // artefact, not physics. Integrating the wheel on its own finer
      // clock keeps it on the stable side of the curve.
      const SUB = 8;
      const subDt = dt / SUB;
      const radius = chassis.wheelRadius;
      const inertia = chassis.wheelInertia;
      const EPS = 1e-3;

      let sumLong = 0;
      let sumLat = 0;
      let sumGrip = 0;
      let slipRatio = 0;

      for (let k = 0; k < SUB; k++) {
        slipRatio = clamp((w.omega * radius - vLong) / denom, -4, 4);
        const f = solveTire(tire, slipRatio, slipAngle, load, gripScale);
        sumLong += f.long;
        sumLat += f.lat;
        sumGrip += f.gripUsage;

        // Local slope of longitudinal force against slip ratio. Near zero
        // slip this is enormous — that stiffness is what an explicit
        // integrator cannot survive.
        const slope = Math.max(
          0,
          (solveTire(tire, slipRatio + EPS, slipAngle, load, gripScale).long - f.long) / EPS
        );

        const brakeDirection = -Math.sign(w.omega || vLong || 1);
        const torque = driveTorque + brakeDirection * brakeTorque - f.long * radius;

        // Semi-implicit update: evaluating the tyre's resistance at the
        // *end* of the sub-step damps the wheel exactly as hard as the
        // curve is steep, so it settles onto the grip peak instead of
        // overshooting it and running away down the far side.
        const damping = 1 + ((subDt / inertia) * radius * slope * radius) / denom;
        let omegaNext = w.omega + (subDt / inertia) * (torque / damping);

        // Brakes may stop a wheel but must never drive it backwards.
        if (brakeTorque > 0 && w.omega !== 0 && Math.sign(omegaNext) !== Math.sign(w.omega)) {
          omegaNext = 0;
        }
        w.omega = clamp(omegaNext, -600, 600);
      }

      const forces = {
        long: sumLong / SUB,
        lat: sumLat / SUB,
        gripUsage: sumGrip / SUB
      };

      w.spin += w.omega * dt;
      if (brakeTorque > 0) brakingPower += Math.abs(brakeTorque * w.omega);

      // --- apply tyre force ----------------------------------------
      // Back into world space through the same two rotations.
      const fx = forces.lat * cos - forces.long * sin;
      const fz = -(forces.long * cos) - forces.lat * sin;
      const worldForce = quatRotate(rot, vec3(fx, 0, fz));

      this.body.addForceAtPoint(
        { x: worldForce.x, y: worldForce.y, z: worldForce.z },
        contact.point,
        true
      );

      // Rolling resistance, always opposing motion.
      if (Math.abs(vLong) > 0.05) {
        const rr = -Math.sign(vLong) * tire.rollingResistance * load;
        const rrWorld = quatRotate(rot, vec3(0, 0, -rr));
        this.body.addForceAtPoint({ x: rrWorld.x, y: rrWorld.y, z: rrWorld.z }, contact.point, true);
      }

      // Heat and wear come from the same quantity: the power dissipated
      // by the contact patch sliding, which is force times sliding speed.
      const slideLong = w.omega * radius - vLong;
      const slideLat = vLat;
      const frictionPower =
        Math.abs(forces.long * slideLong) + Math.abs(forces.lat * slideLat);
      stepTireCondition(thermal, w.condition, frictionPower, Math.abs(vLong), dt, true);

      t.grounded = true;
      t.load = load;
      t.compression = w.compression;
      t.slipAngle = slipAngle;
      t.slipRatio = slipRatio;
      t.forceLong = forces.long;
      t.forceLat = forces.lat;
      t.gripUsage = forces.gripUsage;
      t.omega = w.omega;
      t.surfaceTemp = w.condition.surfaceTemp;
      t.coreTemp = w.condition.coreTemp;
      t.wear = w.condition.wear;
      t.gripScale = gripScale;
      t.surfaceGrip = surfaceGrip;
    }

    recoverEnergy(drivetrain, this.drivetrain, brakingPower, dt);

    // ---------------------------------------------------------------
    // Accelerations, measured the way a driver feels them.
    // ---------------------------------------------------------------
    const accel = vec3(
      (velocity.x - this.lastVelocity.x) / dt,
      (velocity.y - this.lastVelocity.y) / dt,
      (velocity.z - this.lastVelocity.z) / dt
    );
    const localAccel = quatRotateInverse(rot, accel);
    this.gLong = -localAccel.z / GRAVITY;
    this.gLat = localAccel.x / GRAVITY;
    this.lastVelocity = velocity;
  }

  /** Snapshot for the renderer and the HUD. */
  getState(): VehicleState {
    const pos = this.body.translation();
    const rot = this.body.rotation();
    const lin = this.body.linvel();
    const ang = this.body.angvel();
    const forward = quatRotate(rot, vec3(0, 0, -1));

    return {
      position: vec3(pos.x, pos.y, pos.z),
      rotation: { x: rot.x, y: rot.y, z: rot.z, w: rot.w },
      velocity: vec3(lin.x, lin.y, lin.z),
      angularVelocity: vec3(ang.x, ang.y, ang.z),
      speed: lin.x * forward.x + lin.y * forward.y + lin.z * forward.z,
      engineRpm: this.drivetrain.rpm,
      gear: this.drivetrain.gear,
      wheels: [
        { ...this.wheels[FL]!.telemetry },
        { ...this.wheels[FR]!.telemetry },
        { ...this.wheels[RL]!.telemetry },
        { ...this.wheels[RR]!.telemetry }
      ],
      steerAngles: [
        this.wheels[FL]!.steerAngle,
        this.wheels[FR]!.steerAngle,
        this.wheels[RL]!.steerAngle,
        this.wheels[RR]!.steerAngle
      ],
      wheelSpin: [
        this.wheels[FL]!.spin,
        this.wheels[FR]!.spin,
        this.wheels[RL]!.spin,
        this.wheels[RR]!.spin
      ],
      downforce: this.downforce,
      drag: this.drag,
      rideHeightFront: this.rideHeightFront,
      rideHeightRear: this.rideHeightRear,
      groundEffectFront: groundEffect(this.params.aero, this.rideHeightFront),
      groundEffectRear: groundEffect(this.params.aero, this.rideHeightRear),
      gLong: this.gLong,
      gLat: this.gLat,
      drsOpen: this.controls.drs,
      ersDeploying: this.drivetrain.ersDeploying
    };
  }

  /** Where each wheel's centre should be drawn, in world space. */
  wheelCentres(): Vec3[] {
    const { suspension } = this.params;
    const rot = this.body.rotation();
    const up = quatRotate(rot, vec3(0, 1, 0));
    return this.wheels.map((w) => {
      const hp = this.localToWorld(w.hardpoint);
      const length = clamp(
        suspension.restLength - w.compression,
        suspension.restLength - suspension.maxTravel,
        suspension.restLength + suspension.maxTravel
      );
      const drop = length;
      return vec3(hp.x - up.x * drop, hp.y - up.y * drop, hp.z - up.z * drop);
    });
  }

  private localToWorld(local: Vec3): Vec3 {
    const rot = this.body.rotation();
    const pos = this.body.translation();
    const r = quatRotate(rot, local);
    return vec3(pos.x + r.x, pos.y + r.y, pos.z + r.z);
  }

  private castWheelRay(origin: Vec3, up: Vec3, maxToi: number): RayContact | null {
    const dir = { x: -up.x, y: -up.y, z: -up.z };
    const ray = new RAPIER.Ray(origin, dir);
    const hit = this.world.castRayAndGetNormal(
      ray,
      maxToi,
      true,
      undefined,
      undefined,
      undefined,
      this.body
    );
    if (!hit) return null;
    return {
      distance: hit.timeOfImpact,
      point: vec3(
        origin.x + dir.x * hit.timeOfImpact,
        origin.y + dir.y * hit.timeOfImpact,
        origin.z + dir.z * hit.timeOfImpact
      ),
      normal: vec3(hit.normal.x, hit.normal.y, hit.normal.z)
    };
  }
}

interface RayContact {
  distance: number;
  point: Vec3;
  normal: Vec3;
}
