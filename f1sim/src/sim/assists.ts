/**
 * Driver aids.
 *
 * These sit *between* the input source and the vehicle: they read
 * telemetry and shape the controls, but never touch the physics. That
 * keeps the vehicle model honest and lets the same code serve the
 * player, the test bench and — later — the AI driver, which needs
 * exactly this to get off the line.
 *
 * Worth being clear about why one is needed at all. First gear puts
 * roughly 26 kN of thrust through rear tyres that can carry about 7.5 kN
 * at a standstill. Full throttle from rest therefore spins the wheels,
 * and spinning wheels have almost no lateral grip left, so the car turns
 * around. That is not a bug — it is what the model should do, and it is
 * why a real driver feeds the throttle in rather than mashing it.
 */
import { clamp } from '../core/math';

export interface AssistState {
  /** Current throttle ceiling, 0..1. */
  throttleLimit: number;
}

export const initialAssistState = (): AssistState => ({ throttleLimit: 1 });

export interface TractionControlParams {
  /** Slip ratio the controller aims to hold on the driven wheels. */
  targetSlip: number;
  /** How fast the ceiling drops once slip is exceeded (per second). */
  cutRate: number;
  /** How fast it is handed back (per second). */
  restoreRate: number;
  /** Never cut below this, or the car cannot move at all. */
  floor: number;
}

export const defaultTractionControl = (): TractionControlParams => ({
  targetSlip: 0.14,
  cutRate: 6,
  restoreRate: 1.5,
  floor: 0.08
});

/**
 * Limit throttle to keep the driven wheels near their peak-grip slip.
 *
 * @param desired    throttle the driver asked for, 0..1
 * @param drivenSlip largest absolute slip ratio across the driven wheels
 * @returns the throttle to actually apply
 */
export const tractionControl = (
  desired: number,
  drivenSlip: number,
  state: AssistState,
  dt: number,
  p: TractionControlParams = defaultTractionControl()
): number => {
  if (drivenSlip > p.targetSlip) {
    state.throttleLimit -= dt * p.cutRate * clamp(drivenSlip / p.targetSlip - 1, 0, 3);
  } else {
    state.throttleLimit += dt * p.restoreRate;
  }
  state.throttleLimit = clamp(state.throttleLimit, p.floor, 1);
  return Math.min(desired, state.throttleLimit);
};
