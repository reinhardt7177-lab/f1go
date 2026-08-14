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

  /* --- ground effect ------------------------------------------------
   * A modern F1 floor is a venturi: the closer it runs to the road, the
   * faster the air underneath and the more it sucks the car down — right
   * up until the flow separates and the downforce collapses. That
   * collapse re-extends the springs, the floor rises, the flow
   * reattaches, and the car slams down again. Porpoising is not scripted
   * here; it falls out of these three numbers.
   */

  /** Ride height of peak downforce (m). */
  optimalRideHeight: number;
  /** Below this the floor stalls (m). */
  stallRideHeight: number;
  /** Downforce multiplier at the optimal height. */
  groundEffectGain: number;
  /** Multiplier once fully stalled. */
  stallLoss: number;
  /** Height above which ground effect has faded out (m). */
  groundEffectRange: number;
}

export const defaultAeroParams = (): AeroParams => ({
  clA: 4.2,
  cdA: 1.3,
  frontBalance: 0.44,
  airDensity: 1.225,
  drsDragReduction: 0.22,
  drsDownforceLoss: 0.18,

  optimalRideHeight: 0.03,
  stallRideHeight: 0.016,
  groundEffectGain: 1.45,
  stallLoss: 0.62,
  groundEffectRange: 0.11
});

/**
 * Downforce multiplier as a function of floor height.
 *
 * Rises from 1 at `groundEffectRange` to `groundEffectGain` at the
 * optimum, then falls steeply to `stallLoss` below the stall height.
 */
export const groundEffect = (p: AeroParams, rideHeight: number): number => {
  const h = Math.max(0, rideHeight);

  if (h >= p.groundEffectRange) return 1;

  if (h >= p.optimalRideHeight) {
    // Gaining downforce as the floor approaches the road.
    const t = (p.groundEffectRange - h) / (p.groundEffectRange - p.optimalRideHeight);
    return 1 + (p.groundEffectGain - 1) * t * t;
  }

  if (h <= p.stallRideHeight) return p.stallLoss;

  // Between the stall height and the optimum the floor is losing the
  // flow — a short, steep transition, which is what makes it oscillate.
  const t = (p.optimalRideHeight - h) / (p.optimalRideHeight - p.stallRideHeight);
  return p.groundEffectGain + (p.stallLoss - p.groundEffectGain) * t * t;
};

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
 * @param speed  forward speed in m/s; reverse produces the same drag
 * @param rideHeightFront floor height at the front axle (m)
 * @param rideHeightRear  floor height at the rear axle (m)
 *
 * Ground effect is evaluated per axle, so a car that is bottoming at the
 * front and riding high at the rear loses front downforce specifically —
 * the aero balance moves rearward and the car understeers, exactly as it
 * does in reality.
 */
export const solveAero = (
  p: AeroParams,
  speed: number,
  drsOpen: boolean,
  rideHeightFront = p.optimalRideHeight,
  rideHeightRear = p.optimalRideHeight
): AeroForces => {
  const q = 0.5 * p.airDensity * speed * speed; // dynamic pressure

  const clA = drsOpen ? p.clA * (1 - p.drsDownforceLoss) : p.clA;
  const cdA = drsOpen ? p.cdA * (1 - p.drsDragReduction) : p.cdA;

  const base = q * clA;
  const front = base * p.frontBalance * groundEffect(p, rideHeightFront);
  const rear = base * (1 - p.frontBalance) * groundEffect(p, rideHeightRear);

  return {
    downforce: front + rear,
    downforceFront: front,
    downforceRear: rear,
    drag: q * cdA
  };
};

/**
 * Terminal speed for a given power, useful as a sanity check while
 * tuning: at top speed all engine power goes into overcoming drag.
 */
export const terminalSpeed = (p: AeroParams, powerWatts: number): number =>
  Math.cbrt(powerWatts / (0.5 * p.airDensity * p.cdA));
