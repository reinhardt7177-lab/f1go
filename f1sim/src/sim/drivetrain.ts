/**
 * Engine, gearbox, differential and energy recovery.
 *
 * The clutch is not modelled: above idle the drivetrain is treated as
 * locked, so engine speed follows the driven wheels through the gear
 * ratios. That is a fair approximation for a seamless-shift F1 gearbox
 * and it keeps the model deterministic and cheap.
 */
import { clamp } from '../core/math';

export interface DrivetrainParams {
  idleRpm: number;
  redlineRpm: number;
  /** Peak torque (Nm) and the rpm it occurs at. */
  peakTorque: number;
  peakTorqueRpm: number;
  /** Torque still available at the redline, as a fraction of peak. */
  redlineTorqueFraction: number;

  gearRatios: number[];
  finalDrive: number;
  /** Mechanical efficiency of the whole driveline. */
  efficiency: number;

  /** Engine braking torque at closed throttle, scaled by rpm (Nm). */
  engineBrakingTorque: number;

  /** Limited-slip differential locking factor, 0 = open, 1 = spool. */
  diffLock: number;

  /* --- Overtake Mode (2026) ------------------------------------------
   * The aid that replaced DRS. Within a second of the car ahead the
   * driver may release a fixed slug of extra electrical energy — roughly
   * half a megajoule, worth about 67 bhp while it lasts. It is a power
   * boost, not a drag reduction, so unlike DRS it works in the corners
   * too, and it runs out rather than lasting the whole straight.
   */

  /** Extra power while Overtake Mode is deploying (W). */
  overtakePower: number;
  /** Energy released per activation (J). */
  overtakeEnergyPerUse: number;
  /** Store the boost draws from (J). */
  ersCapacity: number;
  /** Fraction of braking energy recovered. */
  ersRecoveryEfficiency: number;

  /** Total brake torque at full pedal (Nm), split front/rear. */
  brakeTorque: number;
  brakeBias: number;

  /** Seconds a gearshift takes; torque is cut for this long. */
  shiftTime: number;
}

export const defaultDrivetrainParams = (): DrivetrainParams => ({
  idleRpm: 4000,
  redlineRpm: 15000,
  peakTorque: 610,
  peakTorqueRpm: 10500,
  redlineTorqueFraction: 0.82,

  // Eighth is geared to run out just above the drag-limited top speed in
  // straight mode: at the 15,000 rpm limiter this is 373 km/h. Taller
  // than that and the car never reaches the limiter, so the gear is
  // wasted; shorter and it sits on the limiter with speed still
  // available. A first pass here was geared for 438 and the car simply
  // could not pull it.
  gearRatios: [3.4, 2.6, 2.1, 1.78, 1.54, 1.36, 1.2, 1.02],
  finalDrive: 5.35,
  efficiency: 0.95,

  engineBrakingTorque: 90,

  diffLock: 0.6,

  // 0.5 MJ at 50 kW is ten seconds of about 67 bhp, which is the
  // regulation figure.
  overtakePower: 50_000,
  overtakeEnergyPerUse: 500_000,
  ersCapacity: 4_000_000,
  ersRecoveryEfficiency: 0.4,

  brakeTorque: 22_000,
  brakeBias: 0.58,

  shiftTime: 0.05
});

/**
 * Torque curve: rises to peak, then falls away towards the redline.
 * Two quadratics stitched at the peak — smooth enough to drive against
 * and cheap enough to evaluate every tick.
 */
export const engineTorque = (p: DrivetrainParams, rpm: number): number => {
  const r = clamp(rpm, 0, p.redlineRpm);
  if (r < p.peakTorqueRpm) {
    // Rise from ~55% of peak at idle to 100% at the peak.
    const t = clamp((r - p.idleRpm) / Math.max(1, p.peakTorqueRpm - p.idleRpm), 0, 1);
    return p.peakTorque * (0.55 + 0.45 * (2 * t - t * t));
  }
  const t = clamp((r - p.peakTorqueRpm) / Math.max(1, p.redlineRpm - p.peakTorqueRpm), 0, 1);
  return p.peakTorque * (1 - (1 - p.redlineTorqueFraction) * t * t);
};

/** Peak power in watts, and the rpm it arrives at — a tuning readout. */
export const peakPower = (p: DrivetrainParams): { watts: number; rpm: number } => {
  let best = { watts: 0, rpm: p.peakTorqueRpm };
  for (let rpm = p.idleRpm; rpm <= p.redlineRpm; rpm += 100) {
    const watts = (engineTorque(p, rpm) * rpm * 2 * Math.PI) / 60;
    if (watts > best.watts) best = { watts, rpm };
  }
  return best;
};

export interface DrivetrainState {
  gear: number;
  rpm: number;
  shiftTimer: number;
  ersStore: number;
  overtakeDeploying: boolean;
  /** Energy left in the activation currently running (J). */
  overtakeRemaining: number;
  /** True until the button is released, so one press is one slug. */
  overtakeLatched: boolean;
}

export const initialDrivetrainState = (p: DrivetrainParams): DrivetrainState => ({
  gear: 1,
  rpm: p.idleRpm,
  shiftTimer: 0,
  ersStore: p.ersCapacity,
  overtakeDeploying: false,
  overtakeRemaining: 0,
  overtakeLatched: false
});

export const gearRatio = (p: DrivetrainParams, gear: number): number =>
  (p.gearRatios[clamp(gear, 1, p.gearRatios.length) - 1] ?? 1) * p.finalDrive;

/**
 * Advance the drivetrain one tick and report the torque to deliver to
 * each rear wheel.
 *
 * @param drivenOmega  angular velocity of each driven wheel (rad/s)
 * @returns torque for [left, right] driven wheels, in Nm at the wheel
 */
export const stepDrivetrain = (
  p: DrivetrainParams,
  s: DrivetrainState,
  dt: number,
  throttle: number,
  shiftUp: boolean,
  shiftDown: boolean,
  overtakeRequested: boolean,
  drivenOmega: [number, number]
): [number, number] => {
  // --- gear selection -------------------------------------------------
  if (s.shiftTimer > 0) s.shiftTimer = Math.max(0, s.shiftTimer - dt);
  else if (shiftUp && s.gear < p.gearRatios.length) {
    s.gear++;
    s.shiftTimer = p.shiftTime;
  } else if (shiftDown && s.gear > 1) {
    s.gear--;
    s.shiftTimer = p.shiftTime;
  }

  const ratio = gearRatio(p, s.gear);

  // --- engine speed follows the driven wheels -------------------------
  const avgOmega = (drivenOmega[0] + drivenOmega[1]) / 2;
  const rawRpm = (Math.abs(avgOmega) * ratio * 60) / (2 * Math.PI);
  s.rpm = clamp(rawRpm, p.idleRpm, p.redlineRpm);

  // Torque is cut while the gearbox is mid-shift.
  const shifting = s.shiftTimer > 0;
  const effectiveThrottle = shifting ? 0 : clamp(throttle, 0, 1);

  // --- engine and ERS -------------------------------------------------
  let crankTorque = engineTorque(p, s.rpm) * effectiveThrottle;

  // One press releases one slug of energy; holding the button down does
  // not extend it, and it has to be released before another can be armed.
  if (overtakeRequested && !s.overtakeLatched && s.overtakeRemaining <= 0 && s.ersStore > 0) {
    s.overtakeRemaining = Math.min(p.overtakeEnergyPerUse, s.ersStore);
    s.overtakeLatched = true;
  }
  if (!overtakeRequested) s.overtakeLatched = false;

  s.overtakeDeploying = false;
  if (s.overtakeRemaining > 0 && effectiveThrottle > 0.2) {
    const omega = (s.rpm * 2 * Math.PI) / 60;
    if (omega > 1) {
      crankTorque += p.overtakePower / omega;
      const used = p.overtakePower * dt;
      s.overtakeRemaining = Math.max(0, s.overtakeRemaining - used);
      s.ersStore = Math.max(0, s.ersStore - used);
      s.overtakeDeploying = true;
    }
  }

  // Engine braking when off throttle, scaled by how hard it is spinning.
  // Only once the wheels are actually driving the engine: below idle a
  // real clutch is slipping or open, and applying it there would drive
  // the car backwards from a standstill.
  if (effectiveThrottle < 0.05 && !shifting && rawRpm > p.idleRpm) {
    crankTorque -= p.engineBrakingTorque * (s.rpm / p.redlineRpm);
  }

  // Hitting the limiter stops it pulling any harder.
  if (rawRpm >= p.redlineRpm) crankTorque = Math.min(crankTorque, 0);

  const wheelTorque = crankTorque * ratio * p.efficiency;

  // --- differential ---------------------------------------------------
  // An open diff splits torque evenly. Locking biases torque towards the
  // slower wheel, which is what stops a rear-wheel-drive car lighting up
  // the inside tyre on corner exit.
  const half = wheelTorque / 2;
  const diff = drivenOmega[0] - drivenOmega[1];
  const bias = clamp(diff * 0.02, -1, 1) * p.diffLock * Math.abs(half);

  return [half - bias, half + bias];
};

/** Recover energy under braking, called by the vehicle each tick. */
export const recoverEnergy = (
  p: DrivetrainParams,
  s: DrivetrainState,
  brakingPowerWatts: number,
  dt: number
): void => {
  if (brakingPowerWatts <= 0) return;
  s.ersStore = Math.min(
    p.ersCapacity,
    s.ersStore + brakingPowerWatts * p.ersRecoveryEfficiency * dt
  );
};

/** Brake torque per wheel at a given pedal position (Nm). */
export const brakeTorques = (
  p: DrivetrainParams,
  brake: number
): { front: number; rear: number } => {
  const total = p.brakeTorque * clamp(brake, 0, 1);
  return {
    front: (total * p.brakeBias) / 2,
    rear: (total * (1 - p.brakeBias)) / 2
  };
};
