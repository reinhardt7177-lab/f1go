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
 * @param gripScale  everything that modifies the available friction
 *                   without changing the shape of the curve: the surface
 *                   under the wheel, tyre temperature and wear
 */
export const solveTire = (
  p: TireParams,
  slipRatio: number,
  slipAngle: number,
  load: number,
  gripScale = 1
): TireForces => {
  if (load <= 1) return { long: 0, lat: 0, gripUsage: 0 };

  const mu = muAtLoad(p, load) * gripScale;
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

/* ------------------------------------------------------------------ *
 * Thermal and wear model
 *
 * A tyre only delivers its quoted friction inside a temperature window
 * perhaps thirty degrees wide. Cold, the rubber is too stiff to key into
 * the road; overheated, it greases and the grip falls away. Everything
 * that makes a stint interesting comes out of this: the out-lap, warming
 * the fronts under braking, losing the rears through a long corner,
 * managing a set to the end.
 *
 * Two temperatures are tracked. The surface responds within a corner and
 * is what sets grip right now; the core responds over a lap and is what
 * the surface relaxes back towards.
 * ------------------------------------------------------------------ */

export interface TireThermalParams {
  /** Temperature of peak grip (deg C). */
  optimalTemp: number;
  /** Half-width of the usable window (deg C). */
  tempWindow: number;
  /** Grip multiplier at the edge of the window. */
  gripAtWindowEdge: number;
  /** Lowest the multiplier can fall to far outside the window. */
  gripFloor: number;

  /** Surface thermal mass (J/K) — small, so it responds within a corner. */
  surfaceHeatCapacity: number;
  /** Core thermal mass (J/K) — large, responds over a lap. */
  coreHeatCapacity: number;
  /** Conductance between surface and core (W/K). */
  surfaceToCore: number;
  /** Convective cooling, at rest and per m/s of airflow (W/K). */
  coolingBase: number;
  coolingPerSpeed: number;
  ambientTemp: number;

  /** Wear per megajoule of friction energy through the contact patch. */
  wearPerMJ: number;
  /** Grip multiplier once the tyre is fully worn. */
  gripAtFullWear: number;
  /** Wear also narrows the window: multiplier on optimal temp when worn. */
  wearTempPenalty: number;
}

export const defaultThermalParams = (): TireThermalParams => ({
  optimalTemp: 100,
  tempWindow: 25,
  gripAtWindowEdge: 0.93,
  gripFloor: 0.62,

  // Sized from the equilibrium these have to hold rather than picked by
  // feel. A tyre being worked hard dissipates on the order of 8 kW and
  // should settle near 100 C in a 60 m/s airstream, which fixes the
  // cooling conductance at about 110 W/K: (100 - 26) x 110 = 8.1 kW.
  // Get this wrong in the other direction — as a first pass here did —
  // and cooling swamps the heat input, so the tyres never come in at all.
  // The tread is a thin layer and must respond within a corner, so its
  // time constant against the cooling conductance is about a minute.
  surfaceHeatCapacity: 5_500,
  coreHeatCapacity: 45_000,
  surfaceToCore: 120,
  coolingBase: 45,
  coolingPerSpeed: 1.1,
  ambientTemp: 26,

  // A hard-worked set puts roughly 25 MJ through each contact patch over
  // a stint, which should leave it most of the way worn out.
  wearPerMJ: 0.03,
  gripAtFullWear: 0.72,
  wearTempPenalty: 8
});

/** Mutable per-wheel condition. */
export interface TireCondition {
  surfaceTemp: number;
  coreTemp: number;
  /** 0 = new, 1 = fully worn. */
  wear: number;
}

/**
 * A new set, out of the blankets. Starting at the cold edge of the
 * window rather than at the optimum means the first lap is a real
 * out-lap: the tyres have to be worked into their window before the car
 * will do what you ask of it.
 */
export const freshTire = (
  p: TireThermalParams,
  startTemp = p.optimalTemp - p.tempWindow
): TireCondition => ({
  surfaceTemp: startTemp,
  coreTemp: startTemp,
  wear: 0
});

/**
 * Grip multiplier from temperature.
 *
 * A raised cosine across the window, decaying outside it. Deliberately
 * asymmetric in effect through `wearTempPenalty`: a worn tyre wants to
 * run cooler, so the window shifts down as rubber is lost.
 */
export const thermalGrip = (p: TireThermalParams, temp: number, wear: number): number => {
  const optimal = p.optimalTemp - p.wearTempPenalty * wear;
  const d = Math.abs(temp - optimal) / p.tempWindow;

  if (d <= 1) {
    // 1 at the centre, gripAtWindowEdge at the edge.
    return 1 - (1 - p.gripAtWindowEdge) * (1 - Math.cos(d * Math.PI)) * 0.5;
  }
  // Outside the window grip decays towards the floor.
  const beyond = Math.min(1, (d - 1) / 1.6);
  return Math.max(
    p.gripFloor,
    p.gripAtWindowEdge - (p.gripAtWindowEdge - p.gripFloor) * (1 - Math.cos(beyond * Math.PI)) * 0.5
  );
};

/** Grip multiplier from wear alone. */
export const wearGrip = (p: TireThermalParams, wear: number): number =>
  1 - (1 - p.gripAtFullWear) * clamp(wear, 0, 1);

/** Combined multiplier applied to the tyre's friction coefficient. */
export const conditionGrip = (p: TireThermalParams, c: TireCondition): number =>
  thermalGrip(p, c.surfaceTemp, c.wear) * wearGrip(p, c.wear);

/**
 * Advance one tyre's condition.
 *
 * @param frictionPower  energy per second dissipated in the contact
 *                       patch: force times the speed at which the patch
 *                       is sliding, which is exactly what heats a tyre
 *                       and exactly what wears it
 * @param airspeed       for convective cooling (m/s)
 */
export const stepTireCondition = (
  p: TireThermalParams,
  c: TireCondition,
  frictionPower: number,
  airspeed: number,
  dt: number,
  grounded: boolean
): void => {
  const heatIn = Math.max(0, frictionPower);

  const cooling = (p.coolingBase + p.coolingPerSpeed * Math.max(0, airspeed)) *
    (c.surfaceTemp - p.ambientTemp);
  const toCore = p.surfaceToCore * (c.surfaceTemp - c.coreTemp);

  c.surfaceTemp += ((heatIn - cooling - toCore) / p.surfaceHeatCapacity) * dt;

  // The core is fed by the surface and loses heat far more slowly.
  const coreCooling = p.coolingBase * 0.25 * (c.coreTemp - p.ambientTemp);
  c.coreTemp += ((toCore - coreCooling) / p.coreHeatCapacity) * dt;

  c.surfaceTemp = clamp(c.surfaceTemp, p.ambientTemp - 5, 260);
  c.coreTemp = clamp(c.coreTemp, p.ambientTemp - 5, 220);

  if (grounded) {
    c.wear = clamp(c.wear + (heatIn * dt * p.wearPerMJ) / 1_000_000, 0, 1);
  }
};
