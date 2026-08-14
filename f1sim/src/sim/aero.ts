/**
 * Aerodynamics.
 *
 * This is what separates an F1 car from every other car: downforce grows
 * with the square of speed, so grip *increases* the faster you go. A fast
 * corner that is impossible at 150 km/h is flat at 250 km/h. Get this
 * wrong and no amount of tyre tuning will make the car feel right.
 */

export interface AeroParams {
  /** Lift coefficient x frontal area, summed over the whole car (m^2). */
  clA: number;
  /** Drag coefficient x frontal area (m^2). */
  cdA: number;
  /** Fraction of total downforce carried by the front axle, 0..1. */
  frontBalance: number;
  /** Air density (kg/m^3) at sea level, 15 C. */
  airDensity: number;
  /** Fraction of cdA removed when DRS is open. */
  drsDragReduction: number;
  /** Fraction of clA lost when DRS is open — the trade you make. */
  drsDownforceLoss: number;
}

export const defaultAeroParams = (): AeroParams => ({
  clA: 4.2,
  cdA: 1.3,
  frontBalance: 0.44,
  airDensity: 1.225,
  drsDragReduction: 0.22,
  drsDownforceLoss: 0.18
});

export interface AeroForces {
  /** Total downward force (N). */
  downforce: number;
  /** Downforce applied at the front axle (N). */
  downforceFront: number;
  /** Downforce applied at the rear axle (N). */
  downforceRear: number;
  /** Rearward force opposing motion (N). */
  drag: number;
}

/**
 * @param speed forward speed in m/s; reverse produces the same drag
 */
export const solveAero = (p: AeroParams, speed: number, drsOpen: boolean): AeroForces => {
  const q = 0.5 * p.airDensity * speed * speed; // dynamic pressure

  const clA = drsOpen ? p.clA * (1 - p.drsDownforceLoss) : p.clA;
  const cdA = drsOpen ? p.cdA * (1 - p.drsDragReduction) : p.cdA;

  const downforce = q * clA;

  return {
    downforce,
    downforceFront: downforce * p.frontBalance,
    downforceRear: downforce * (1 - p.frontBalance),
    drag: q * cdA
  };
};

/**
 * Terminal speed for a given power, useful as a sanity check while
 * tuning: at top speed all engine power goes into overcoming drag.
 */
export const terminalSpeed = (p: AeroParams, powerWatts: number): number =>
  Math.cbrt(powerWatts / (0.5 * p.airDensity * p.cdA));
