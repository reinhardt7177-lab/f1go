/**
 * Speed profile over the racing line.
 *
 * Three steps, in order:
 *
 *  1. **Corner limits.** The fastest a corner can be taken is where the
 *     lateral acceleration the tyres can produce equals the one the
 *     corner demands. For an F1 car that is not a fixed number, because
 *     the grip itself grows with speed:
 *
 *         v² · κ = μ · (g + ½ρ·ClA·v² / m)
 *
 *     Solving for v gives
 *
 *         v² = μg / (κ − μρ·ClA / 2m)
 *
 *     and the denominator going negative is not a failure — it means
 *     downforce grows faster than the corner demands, so the corner is
 *     flat out at any speed. That is exactly why Blanchimont is flat and
 *     La Source is not, and it falls straight out of the algebra.
 *
 *  2. **Backward pass.** Walk the lap backwards, capping each station at
 *     the speed from which you could still slow to the next one. This is
 *     what produces braking points.
 *
 *  3. **Forward pass.** Walk forwards, capping each station at the speed
 *     you could actually have reached from the last one. This is what
 *     stops the profile promising a corner exit the engine cannot serve.
 *
 * Both passes use whatever grip is left after cornering has taken its
 * share of the friction circle, so a car still turning cannot also brake
 * at full force.
 */
import { GRAVITY } from '../core/math';
import { muAtLoad } from '../sim/tire';
import type { VehicleParams } from '../sim/vehicle';
import type { RacingLine } from './racingline';

export interface ProfileOptions {
  /**
   * Fraction of the tyre's peak the driver actually uses. Below one
   * because a profile driven at exactly the limit has no margin for the
   * controller's own error.
   */
  gripUsage: number;
  /** Ceiling, in case a circuit has no corner slow enough to set one. */
  maxSpeed: number;
  /** Longitudinal deceleration ceiling from the brakes alone (m/s²). */
  maxBraking: number;
}

export const defaultProfileOptions = (): ProfileOptions => ({
  gripUsage: 0.82,
  maxSpeed: 103,
  maxBraking: 45
});

/**
 * Fastest speed a corner of curvature `kappa` can be taken at.
 *
 * Solved iteratively because the available friction coefficient falls as
 * load rises, and the load depends on the speed being solved for. Three
 * passes is plenty — it converges fast.
 */
export const cornerLimit = (
  kappa: number,
  p: VehicleParams,
  options: ProfileOptions
): number => {
  const k = Math.abs(kappa);
  if (k < 1e-7) return options.maxSpeed;

  const m = p.chassis.mass;
  const weight = m * GRAVITY;
  let v = 40;

  for (let pass = 0; pass < 4; pass++) {
    const downforce = 0.5 * p.aero.airDensity * v * v * p.aero.clA;
    const mu = muAtLoad(p.tire, (weight + downforce) / 4) * options.gripUsage;

    // v² (κ − μρClA/2m) = μg
    const aeroTerm = (mu * p.aero.airDensity * p.aero.clA) / (2 * m);
    const denom = k - aeroTerm;

    // Downforce outruns the corner: flat out.
    if (denom <= 1e-7) return options.maxSpeed;

    v = Math.min(options.maxSpeed, Math.sqrt((mu * GRAVITY) / denom));
  }

  return v;
};

/** Total acceleration the tyres can deliver at a given speed (m/s²). */
const gripAcceleration = (v: number, p: VehicleParams, options: ProfileOptions): number => {
  const weight = p.chassis.mass * GRAVITY;
  const downforce = 0.5 * p.aero.airDensity * v * v * p.aero.clA;
  const load = weight + downforce;
  const mu = muAtLoad(p.tire, load / 4) * options.gripUsage;
  return (mu * load) / p.chassis.mass;
};

/** What is left for braking or driving once cornering has taken its cut. */
const longitudinalBudget = (
  v: number,
  kappa: number,
  p: VehicleParams,
  options: ProfileOptions
): number => {
  const total = gripAcceleration(v, p, options);
  const lateral = v * v * Math.abs(kappa);
  const remaining = total * total - lateral * lateral;
  return remaining <= 0 ? 0 : Math.sqrt(remaining);
};

export class SpeedProfile {
  /** Target speed at each station of the racing line (m/s). */
  readonly target: Float32Array;
  readonly spacing: number;

  constructor(
    private readonly line: RacingLine,
    params: VehicleParams,
    private readonly options: ProfileOptions = defaultProfileOptions()
  ) {
    const n = line.stationCount;
    this.spacing = line.spacing;
    this.target = new Float32Array(n);

    // 1. corner limits
    for (let i = 0; i < n; i++) {
      this.target[i] = cornerLimit(line.curvature[i]!, params, options);
    }

    // Engine-limited acceleration, from power rather than torque: near
    // top speed it is power that runs out, not grip.
    const power = 700_000 * 0.9;
    const engineAccel = (v: number): number =>
      Math.min(18, power / (params.chassis.mass * Math.max(v, 8)));

    const drag = (v: number): number =>
      (0.5 * params.aero.airDensity * v * v * params.aero.cdA) / params.chassis.mass;

    // 2. backward pass — braking points
    for (let pass = 0; pass < 2; pass++) {
      for (let step = 0; step < n; step++) {
        const i = (n - 1 - step + n) % n;
        const next = (i + 1) % n;
        const vNext = this.target[next]!;
        const budget = Math.min(
          options.maxBraking,
          longitudinalBudget(this.target[i]!, line.curvature[i]!, params, options)
        );
        // Drag helps you slow down.
        const decel = budget + drag(this.target[i]!);
        const reachable = Math.sqrt(vNext * vNext + 2 * decel * this.spacing);
        if (reachable < this.target[i]!) this.target[i] = reachable;
      }
    }

    // 3. forward pass — what the car can actually get back
    for (let pass = 0; pass < 2; pass++) {
      for (let step = 0; step < n; step++) {
        const i = step % n;
        const next = (i + 1) % n;
        const v = this.target[i]!;
        const budget = longitudinalBudget(v, line.curvature[i]!, params, options);
        const accel = Math.max(0, Math.min(budget, engineAccel(v)) - drag(v));
        const reachable = Math.sqrt(v * v + 2 * accel * this.spacing);
        if (reachable < this.target[next]!) this.target[next] = reachable;
      }
    }
  }

  /** Interpolated target speed at a distance along the circuit (m/s). */
  at(s: number): number {
    const n = this.target.length;
    const length = this.line.length;
    const wrapped = ((s % length) + length) % length;
    const f = wrapped / this.spacing;
    const i = Math.floor(f) % n;
    const j = (i + 1) % n;
    const u = f - Math.floor(f);
    return this.target[i]! + (this.target[j]! - this.target[i]!) * u;
  }

  /**
   * The slowest target anywhere in the next `distance` metres — what the
   * driver should actually be aiming at, since braking has to start
   * before the corner rather than at it.
   */
  lookahead(s: number, distance: number): number {
    let slowest = this.at(s);
    for (let d = this.spacing; d <= distance; d += this.spacing) {
      slowest = Math.min(slowest, this.at(s + d));
    }
    return slowest;
  }

  /** Estimated lap time if the profile were driven exactly. */
  idealLapTime(): number {
    let t = 0;
    for (let i = 0; i < this.target.length; i++) {
      t += this.spacing / Math.max(1, this.target[i]!);
    }
    return t;
  }

  get maxSpeed(): number {
    return this.options.maxSpeed;
  }
}
