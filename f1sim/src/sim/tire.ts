/**
 * Tyre model — a simplified Pacejka "magic formula" with load sensitivity
 * and a friction ellipse for combined slip.
 *
 * This is the single most important file for how the car feels. Three
 * behaviours matter and all three are modelled here:
 *
 *  1. Grip peaks at a small slip and *falls off* past it. That peak is
 *     what a driver hunts for, and the fall-off is what makes a spin
 *     recoverable or not.
 *  2. Grip per newton of load decreases as load increases (load
 *     sensitivity). This is why weight transfer costs you overall grip,
 *     and why anti-roll bar balance changes understeer/oversteer at all.
 *  3. Longitudinal and lateral grip share one budget. Brake and turn at
 *     the same time and you get less of each.
 */
import { clamp } from '../core/math';

export interface TireParams {
  /** Peak friction coefficient at the reference load. */
  muNominal: number;
  /** Reference vertical load the coefficient is quoted at (N). */
  loadReference: number;
  /**
   * Load sensitivity: fractional loss of mu per unit of load above
   * reference. 0 disables it and makes the car feel inert and forgiving.
   */
  loadSensitivity: number;

  /** Lateral magic-formula coefficients (slip angle in radians). */
  latB: number;
  latC: number;
  latE: number;

  /** Longitudinal magic-formula coefficients (slip ratio, dimensionless). */
  longB: number;
  longC: number;
  longE: number;

  /** Rolling resistance coefficient. */
  rollingResistance: number;
}

/** Dry slick, roughly F1-representative. */
export const defaultTireParams = (): TireParams => ({
  muNominal: 1.75,
  loadReference: 3000,
  loadSensitivity: 0.08,
  // B, C and E are not independent: together they fix where the curve
  // peaks. These are solved so that lateral grip peaks near 7 degrees of
  // slip angle and longitudinal grip near 0.12 slip ratio, which is what
  // SLIP_ANGLE_AT_PEAK and SLIP_RATIO_AT_PEAK below assume. Change one
  // and the peak moves — `tire.test.ts` checks they stay consistent.
  latB: 16.0,
  latC: 1.5,
  latE: 0.3,
  longB: 13.0,
  longC: 1.65,
  longE: 0.3,
  rollingResistance: 0.014
});

export interface TireForces {
  /** Longitudinal force, +ve accelerates the car (N). */
  long: number;
  /** Lateral force (N). */
  lat: number;
  /** Fraction of the friction ellipse consumed, 0..1+. */
  gripUsage: number;
}

/**
 * The magic formula itself: normalised force for a given normalised slip.
 * Returns roughly -1..1, peaking a little above 1 for a racing tyre.
 */
export const magicFormula = (slip: number, B: number, C: number, E: number): number => {
  const Bs = B * slip;
  return Math.sin(C * Math.atan(Bs - E * (Bs - Math.atan(Bs))));
};

/**
 * Effective friction coefficient at a given vertical load.
 *
 * Falls with load, which is the whole reason weight transfer matters.
 * Clamped so an extreme load spike cannot drive mu negative.
 */
export const muAtLoad = (p: TireParams, load: number): number => {
  const excess = load / p.loadReference - 1;
  return Math.max(0.35, p.muNominal * (1 - p.loadSensitivity * excess));
};

/**
 * Solve one contact patch.
 *
 * @param slipRatio  longitudinal slip, 0 = rolling
 * @param slipAngle  lateral slip angle in radians
 * @param load       vertical load in newtons
 */
export const solveTire = (
  p: TireParams,
  slipRatio: number,
  slipAngle: number,
  load: number
): TireForces => {
  if (load <= 1) return { long: 0, lat: 0, gripUsage: 0 };

  const mu = muAtLoad(p, load);
  const peak = mu * load;

  // Slip-circle method. Normalise each slip by the slip at which its own
  // curve peaks, so that a combined magnitude of 1 sits on the peak of
  // the friction ellipse regardless of direction.
  const nLong = slipRatio / SLIP_RATIO_AT_PEAK;
  const nLat = slipAngle / SLIP_ANGLE_AT_PEAK;
  const sigma = Math.hypot(nLong, nLat);

  if (sigma < 1e-6) return { long: 0, lat: 0, gripUsage: 0 };

  // Blend the two curve shapes by direction: on the axes this reduces
  // exactly to the pure longitudinal or pure lateral curve, and between
  // them it interpolates smoothly.
  //
  // The weights are squared direction cosines because those sum to one.
  // Using the cosines themselves would let the blend reach sqrt(2) times
  // either curve at 45 degrees, and the resultant would escape the
  // friction circle — grip out of nowhere for braking into a corner.
  const wLong = (nLong / sigma) ** 2;
  const wLat = (nLat / sigma) ** 2;
  const normalised =
    wLong * magicFormula(sigma * SLIP_RATIO_AT_PEAK, p.longB, p.longC, p.longE) +
    wLat * magicFormula(sigma * SLIP_ANGLE_AT_PEAK, p.latB, p.latC, p.latE);

  const magnitude = normalised * peak;

  // Force opposes slip: driving slip pushes the car forward, and slip to
  // the right generates force to the left.
  const fLong = (nLong / sigma) * magnitude;
  const fLat = -(nLat / sigma) * magnitude;

  return {
    long: fLong,
    lat: fLat,
    gripUsage: clamp(Math.hypot(fLong, fLat) / Math.max(peak, 1e-6), 0, 2)
  };
};

/**
 * Slip values at which each pure curve peaks, used to normalise combined
 * slip. Derived once from the default coefficients; close enough for the
 * ellipse even if the coefficients are tuned a little.
 */
export const SLIP_RATIO_AT_PEAK = 0.12;
export const SLIP_ANGLE_AT_PEAK = 0.125; // ~7.2 degrees

/** Peak longitudinal force available at a given load, for the AI later. */
export const peakForce = (p: TireParams, load: number): number => muAtLoad(p, load) * load;
