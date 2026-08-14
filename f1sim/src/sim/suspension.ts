/**
 * Suspension: spring, damper and anti-roll bar.
 *
 * The anti-roll bar is the reason this file exists separately from the
 * vehicle. It couples the two wheels on an axle, and shifting stiffness
 * between the front and rear bar is the primary tool for dialling out
 * understeer or oversteer — because a stiffer bar puts more load onto
 * that axle's outside tyre, and load sensitivity then costs that axle
 * grip. Tune it against `tire.loadSensitivity`.
 */
import { clamp } from '../core/math';

export interface SuspensionParams {
  /** Uncompressed spring length (m). */
  restLength: number;
  /** Travel either side of rest before the suspension bottoms out (m). */
  maxTravel: number;
  /** Spring rate (N/m). */
  stiffnessFront: number;
  stiffnessRear: number;
  /** Damping coefficient (Ns/m). */
  dampingFront: number;
  dampingRear: number;
  /** Anti-roll bar rate (N/m of left-right compression difference). */
  antiRollFront: number;
  antiRollRear: number;
}

/**
 * Spring rates are set by the downforce, not by the car's weight. At
 * 300 km/h this car makes roughly 19 kN of downforce on top of its 7.8 kN
 * of weight, so each corner has to carry about 6.6 kN without running out
 * of travel. Rates sized for the static weight alone would bottom the car
 * out on every straight.
 */
export const defaultSuspensionParams = (): SuspensionParams => ({
  restLength: 0.12,
  maxTravel: 0.08,
  stiffnessFront: 160_000,
  stiffnessRear: 180_000,
  dampingFront: 8_000,
  dampingRear: 8_600,
  antiRollFront: 38_000,
  antiRollRear: 28_000
});

/**
 * Vertical force from one corner, before the anti-roll bar.
 *
 * @param compression  how far the spring is compressed from rest (m)
 * @param compressionVelocity  rate of compression, +ve compressing (m/s)
 */
export const suspensionForce = (
  stiffness: number,
  damping: number,
  compression: number,
  compressionVelocity: number,
  maxTravel: number
): number => {
  const c = clamp(compression, -maxTravel, maxTravel);

  // Bump stop. Past full travel this has to be much stiffer than the
  // spring, or the chassis sinks until its collider punches through the
  // road — but it cannot be arbitrarily stiff. An explicit integrator is
  // only stable while sqrt(k/m) * dt stays below about 2, which at
  // 120 Hz and a 200 kg corner mass caps the rate near 11 MN/m. A first
  // pass here used two hundred times the spring rate, or 32 MN/m: every
  // time a wheel touched the stop the solver added energy instead of
  // absorbing it, and the car was fired off the circuit at 300 m/s.
  const overTravel = compression - c;
  const bumpStop = overTravel * stiffness * BUMP_STOP_RATIO;

  const force = stiffness * c + bumpStop + damping * compressionVelocity;

  // A spring can push the wheel down but never pull the car down, and no
  // single corner can deliver more than a hard landing's worth of load.
  return Math.min(MAX_CORNER_FORCE, Math.max(0, force));
};

/** Bump-stop rate as a multiple of the spring rate. */
const BUMP_STOP_RATIO = 18;

/**
 * Ceiling on the vertical force one corner may produce (N).
 *
 * A backstop rather than a model: roughly ten times the static corner
 * load, which no legitimate landing exceeds, and which caps the damage
 * any future stiffness mistake can do.
 */
const MAX_CORNER_FORCE = 80_000;

/**
 * Anti-roll contribution for one axle.
 *
 * @returns the force to add at the left wheel; negate it for the right.
 */
export const antiRollForce = (
  rate: number,
  compressionLeft: number,
  compressionRight: number
): number => rate * (compressionRight - compressionLeft) * 0.5;
