import type { Quat, Vec3 } from '../core/math';

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
  drs: boolean;
  ers: boolean;
}

export const neutralControls = (): ControlState => ({
  throttle: 0,
  brake: 0,
  steer: 0,
  shiftUp: false,
  shiftDown: false,
  drs: false,
  ers: false
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
  /** Longitudinal / lateral acceleration in g, as a driver would feel it. */
  gLong: number;
  gLat: number;
  drsOpen: boolean;
  ersDeploying: boolean;
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
