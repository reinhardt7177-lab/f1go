import type { Quat, Vec3 } from '../core/math';
import type { AeroMode } from './aero';

/** Normalised driver inputs. Everything upstream of the sim produces this. */
export interface ControlState {
  /** 0..1 */
  throttle: number;
  /** 0..1 */
  brake: number;
  /** -1 (full left) .. 1 (full right) */
  steer: number;
  /** Requested gear change this tick, consumed by the drivetrain. */
  shiftUp: boolean;
  shiftDown: boolean;
  /**
   * Reclines the wings for a straight. Under the 2026 rules this is not
   * an overtaking aid and carries no proximity condition — every car may
   * use it whenever the driver judges it safe, and paying for it in
   * downforce is the whole decision.
   */
  straightMode: boolean;
  /**
   * Overtake Mode: extra electrical energy, permitted within a second of
   * the car ahead. This is what replaced DRS as the overtaking aid — a
   * power boost rather than a drag reduction.
   */
  overtake: boolean;
}

export const neutralControls = (): ControlState => ({
  throttle: 0,
  brake: 0,
  steer: 0,
  shiftUp: false,
  shiftDown: false,
  straightMode: false,
  overtake: false
});

export const FL = 0;
export const FR = 1;
export const RL = 2;
export const RR = 3;

/** Per-wheel telemetry, the numbers you actually tune against. */
export interface WheelTelemetry {
  /** Vertical load through the contact patch (N). */
  load: number;
  /** Suspension compression, 0 = fully extended (m). */
  compression: number;
  /** Slip angle (rad) — lateral velocity vs heading at the contact patch. */
  slipAngle: number;
  /** Slip ratio — longitudinal, 0 = rolling, +ve = driving, -ve = braking. */
  slipRatio: number;
  /** Tyre forces in the wheel's own frame (N). */
  forceLong: number;
  forceLat: number;
  /** How much of the available grip is being used, 0..1+. */
  gripUsage: number;
  /** Wheel spin rate (rad/s). */
  omega: number;
  grounded: boolean;

  /** Tread temperature (deg C) — sets grip right now. */
  surfaceTemp: number;
  /** Carcass temperature (deg C) — what the tread relaxes towards. */
  coreTemp: number;
  /** 0 = new, 1 = fully worn. */
  wear: number;
  /** Friction multiplier from surface, temperature and wear combined. */
  gripScale: number;
  /** Grip multiplier of the surface under this wheel alone. */
  surfaceGrip: number;
}

/** A complete snapshot of the car. The renderer only ever sees one of these. */
export interface VehicleState {
  position: Vec3;
  rotation: Quat;
  velocity: Vec3;
  angularVelocity: Vec3;

  /** Forward speed along the car's own axis (m/s). */
  speed: number;
  engineRpm: number;
  gear: number;
  wheels: [WheelTelemetry, WheelTelemetry, WheelTelemetry, WheelTelemetry];
  /** Wheel steer angles (rad), for drawing the front wheels. */
  steerAngles: [number, number, number, number];
  /** Accumulated wheel rotation (rad), for spinning the wheel meshes. */
  wheelSpin: [number, number, number, number];

  downforce: number;
  drag: number;
  /** Floor height above the road at each axle (m). */
  rideHeightFront: number;
  rideHeightRear: number;
  /** Downforce multiplier the floor is currently producing, per axle. */
  groundEffectFront: number;
  groundEffectRear: number;
  /** Longitudinal / lateral acceleration in g, as a driver would feel it. */
  gLong: number;
  gLat: number;
  aeroMode: AeroMode;
  overtakeDeploying: boolean;
  /** Overtake energy left in the current allocation, 0..1. */
  overtakeCharge: number;
}

export const emptyWheelTelemetry = (): WheelTelemetry => ({
  load: 0,
  compression: 0,
  slipAngle: 0,
  slipRatio: 0,
  forceLong: 0,
  forceLat: 0,
  gripUsage: 0,
  omega: 0,
  grounded: false,
  surfaceTemp: 80,
  coreTemp: 80,
  wear: 0,
  gripScale: 1,
  surfaceGrip: 1
});
