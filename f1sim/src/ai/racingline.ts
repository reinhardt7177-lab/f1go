/**
 * The racing line.
 *
 * Stored as a lateral offset from the centreline at each station, so it
 * indexes by the same `s` everything else uses. That keeps the whole
 * stack on one coordinate: the car's position projects to `s`, the line
 * says where to be at that `s`, and the speed profile says how fast.
 *
 * The line is found by Laplacian smoothing under a width constraint:
 * repeatedly pull each point towards the midpoint of its neighbours,
 * then clamp it back inside the road. Left alone that converges on the
 * shortest path round the circuit, which straightens every corner it
 * can and is a good first approximation to a racing line — it runs wide
 * on entry, cuts the apex and drifts out on exit, because that is what
 * the shortest path through a corridor does.
 *
 * It is not a minimum-curvature line, which is what a real optimiser
 * would produce and which is meaningfully quicker. The difference is
 * mostly in long corners, where the shortest path apexes too early.
 */
import { clamp, v3add, v3scale, v3sub, vec3 } from '../core/math';
import type { Vec3 } from '../core/math';
import type { Circuit } from '../track/circuit';

export interface RacingLineOptions {
  /** Distance between stations (m). */
  spacing: number;
  /** Smoothing passes. More converges harder on the shortest path. */
  iterations: number;
  /** How far each pass moves a point, 0..1. */
  relaxation: number;
  /** Margin kept inside the white lines (m) — half a car plus a little. */
  margin: number;
  /** Passes of a 1-2-1 filter over the curvature estimate. */
  curvatureSmoothing: number;
}

export const defaultRacingLineOptions = (): RacingLineOptions => ({
  spacing: 5,
  iterations: 600,
  relaxation: 0.35,
  margin: 1.3,
  curvatureSmoothing: 6
});

export class RacingLine {
  /** Lateral offset from the centreline at each station (m). */
  readonly offsets: Float32Array;
  /** Signed curvature of the line itself (1/m). */
  readonly curvature: Float32Array;
  readonly spacing: number;
  readonly length: number;

  constructor(
    private readonly circuit: Circuit,
    options: RacingLineOptions = defaultRacingLineOptions()
  ) {
    const count = Math.max(16, Math.round(circuit.length / options.spacing));
    this.spacing = circuit.length / count;
    this.length = circuit.length;
    this.offsets = new Float32Array(count);
    this.curvature = new Float32Array(count);

    // Cache the centreline frames once; the smoothing loop touches them
    // hundreds of times.
    const centre: Vec3[] = new Array(count);
    const left: Vec3[] = new Array(count);
    const limit = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      const s = i * this.spacing;
      const sample = circuit.spline.sampleAt(s);
      centre[i] = sample.position;
      left[i] = sample.left;
      limit[i] = Math.max(0, circuit.halfWidthAt(s) - options.margin);
    }

    // Road width is stated per section, so it steps at every boundary —
    // Kemmel is 7.5 m half-width and Les Combes 6, and the constraint
    // drops 1.5 m over a single station. A line pinned to that boundary
    // inherits the step as a kink, and the sharpest curvature on the
    // whole circuit ends up being on a straight. Narrowing early instead
    // keeps the line legal and keeps the corner where it belongs.
    const window = 3;
    const eased = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      let narrowest = limit[i]!;
      for (let k = -window; k <= window; k++) {
        narrowest = Math.min(narrowest, limit[((i + k) % count + count) % count]!);
      }
      eased[i] = narrowest;
    }
    smooth(eased, 2);
    for (let i = 0; i < count; i++) limit[i] = Math.min(limit[i]!, eased[i]!);

    const point = (i: number): Vec3 =>
      v3add(centre[i]!, v3scale(left[i]!, this.offsets[i]!));

    for (let pass = 0; pass < options.iterations; pass++) {
      for (let i = 0; i < count; i++) {
        const prev = point((i - 1 + count) % count);
        const next = point((i + 1) % count);
        const here = point(i);

        // Move towards the midpoint of the neighbours, then express the
        // result as a lateral offset again and clamp it to the road.
        const midpoint = v3scale(v3add(prev, next), 0.5);
        const pull = v3scale(v3sub(midpoint, here), options.relaxation);
        const moved = v3add(here, pull);

        const delta = v3sub(moved, centre[i]!);
        const l = left[i]!;
        const lateral = delta.x * l.x + delta.y * l.y + delta.z * l.z;

        this.offsets[i] = clamp(lateral, -limit[i]!, limit[i]!);
      }
    }

    // Curvature of the resulting line, by the circumscribed-circle
    // radius through three consecutive points.
    for (let i = 0; i < count; i++) {
      const a = point((i - 1 + count) % count);
      const b = point(i);
      const c = point((i + 1) % count);
      this.curvature[i] = signedCurvature(a, b, c, left[i]!);
    }

    // Three points five metres apart give a noisy estimate, and the line
    // is pinned hard against the boundary in places, which adds kinks of
    // its own. The speed profile turns curvature directly into a target
    // speed, so that noise becomes a target that jumps about between
    // neighbouring stations and a driver that brakes at phantom corners.
    smooth(this.curvature, options.curvatureSmoothing);
  }

  private index(s: number): number {
    const n = this.offsets.length;
    const wrapped = ((s % this.length) + this.length) % this.length;
    return Math.min(n - 1, Math.floor(wrapped / this.spacing));
  }

  /** Lateral offset of the line at a distance along the circuit. */
  offsetAt(s: number): number {
    const n = this.offsets.length;
    const wrapped = ((s % this.length) + this.length) % this.length;
    const f = wrapped / this.spacing;
    const i = Math.floor(f) % n;
    const j = (i + 1) % n;
    const u = f - Math.floor(f);
    return this.offsets[i]! + (this.offsets[j]! - this.offsets[i]!) * u;
  }

  curvatureAt(s: number): number {
    return this.curvature[this.index(s)]!;
  }

  /** World position of the racing line at a distance along the circuit. */
  pointAt(s: number): Vec3 {
    const sample = this.circuit.spline.sampleAt(s);
    return v3add(sample.position, v3scale(sample.left, this.offsetAt(s)));
  }

  get stationCount(): number {
    return this.offsets.length;
  }
}

/** In-place 1-2-1 smoothing of a periodic array. */
const smooth = (values: Float32Array, passes: number): void => {
  const n = values.length;
  const scratch = new Float32Array(n);
  for (let pass = 0; pass < passes; pass++) {
    for (let i = 0; i < n; i++) {
      const prev = values[(i - 1 + n) % n]!;
      const next = values[(i + 1) % n]!;
      scratch[i] = 0.25 * prev + 0.5 * values[i]! + 0.25 * next;
    }
    values.set(scratch);
  }
};

/**
 * Curvature through three points, signed so that positive turns towards
 * `left` — the same convention the centreline uses.
 */
const signedCurvature = (a: Vec3, b: Vec3, c: Vec3, left: Vec3): number => {
  const ab = v3sub(b, a);
  const bc = v3sub(c, b);
  const ac = v3sub(c, a);

  const lab = Math.hypot(ab.x, ab.y, ab.z);
  const lbc = Math.hypot(bc.x, bc.y, bc.z);
  const lac = Math.hypot(ac.x, ac.y, ac.z);
  if (lab < 1e-6 || lbc < 1e-6 || lac < 1e-6) return 0;

  // Menger curvature: 4 * triangle area / product of side lengths.
  const cross = vec3(
    ab.y * bc.z - ab.z * bc.y,
    ab.z * bc.x - ab.x * bc.z,
    ab.x * bc.y - ab.y * bc.x
  );
  const area = Math.hypot(cross.x, cross.y, cross.z) / 2;
  const magnitude = (4 * area) / (lab * lbc * lac);

  // The turn direction comes from which side of the chord the middle
  // point falls, measured against the road's own left vector.
  const toMid = v3sub(b, v3scale(v3add(a, c), 0.5));
  const side = toMid.x * left.x + toMid.y * left.y + toMid.z * left.z;
  return side >= 0 ? -magnitude : magnitude;
};
