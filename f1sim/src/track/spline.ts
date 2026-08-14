/**
 * Centreline spline.
 *
 * This is the load-bearing data structure of the whole project. Once a
 * circuit exists as a spline, everything else derives from it: the road
 * mesh, the racing line, sector and timing lines, respawn points, and —
 * most importantly — `project()`, which converts a world position into
 * `(s, t)`: distance along the track and lateral offset from the centre.
 *
 * With `(s, t)` in hand, lap counting, sector timing, off-track
 * detection, race position and the AI's target all become one-liners.
 * Stage one only needs the maths; the mesh generator comes later.
 */
import { clamp, v3add, v3cross, v3dot, v3len, v3normalize, v3scale, v3sub, vec3 } from '../core/math';
import type { Vec3 } from '../core/math';

export interface TrackSample {
  /** Distance along the centreline (m). */
  s: number;
  position: Vec3;
  /** Unit tangent, pointing the racing direction. */
  tangent: Vec3;
  /** Unit normal pointing to the driver's left. */
  left: Vec3;
  /** Signed curvature (1/m); positive turns left. */
  curvature: number;
}

export interface Projection {
  /** Distance along the centreline (m). */
  s: number;
  /** Lateral offset; positive is to the left of the racing direction (m). */
  t: number;
  /** Height above the centreline at that point (m). */
  height: number;
  sample: TrackSample;
}

/**
 * Uniform Catmull-Rom through the control points, resampled at a fixed
 * arc-length interval so that lookups by distance are a direct index
 * rather than a search.
 */
export class CenterlineSpline {
  private readonly samples: TrackSample[] = [];

  readonly length: number;
  readonly closed: boolean;

  /**
   * @param controlPoints at least four points
   * @param spacing       resample interval in metres
   */
  constructor(controlPoints: Vec3[], spacing = 1, closed = true) {
    if (controlPoints.length < 4) {
      throw new Error('a centreline needs at least four control points');
    }
    this.closed = closed;

    // Dense evaluation first, then resample by arc length.
    const dense: Vec3[] = [];
    const segments = closed ? controlPoints.length : controlPoints.length - 1;
    const perSegment = 64;

    for (let i = 0; i < segments; i++) {
      for (let j = 0; j < perSegment; j++) {
        dense.push(catmullRom(controlPoints, i, j / perSegment, closed));
      }
    }
    if (closed) dense.push(dense[0]!);
    else dense.push(catmullRom(controlPoints, segments - 1, 1, closed));

    // Cumulative arc length along the dense polyline.
    const cumulative: number[] = [0];
    for (let i = 1; i < dense.length; i++) {
      cumulative.push(cumulative[i - 1]! + v3len(v3sub(dense[i]!, dense[i - 1]!)));
    }
    const total = cumulative[cumulative.length - 1]!;
    this.length = total;

    const count = Math.max(8, Math.round(total / spacing));
    const step = total / count;

    for (let i = 0; i < count; i++) {
      const s = i * step;
      this.samples.push({
        s,
        position: pointAtDistance(dense, cumulative, s),
        tangent: vec3(0, 0, 1),
        left: vec3(1, 0, 0),
        curvature: 0
      });
    }

    // Tangents and curvature from central differences on the resampled
    // points — cheap and stable at uniform spacing.
    const n = this.samples.length;
    for (let i = 0; i < n; i++) {
      const prev = this.samples[(i - 1 + n) % n]!;
      const next = this.samples[(i + 1) % n]!;
      const cur = this.samples[i]!;

      const tangent = v3normalize(v3sub(next.position, prev.position));
      cur.tangent = tangent;
      // Left is up x tangent for a right-handed frame with +Y up.
      cur.left = v3normalize(v3cross(vec3(0, 1, 0), tangent));

      const dT = v3sub(next.tangent, prev.tangent);
      const ds = 2 * step;
      cur.curvature = v3dot(dT, cur.left) / ds;
    }

    // Second pass: curvature above used tangents that were still being
    // filled in, so recompute now that all tangents are final.
    for (let i = 0; i < n; i++) {
      const prev = this.samples[(i - 1 + n) % n]!;
      const next = this.samples[(i + 1) % n]!;
      const cur = this.samples[i]!;
      const dT = v3sub(next.tangent, prev.tangent);
      cur.curvature = v3dot(dT, cur.left) / (2 * step);
    }

    this.spacing = step;
  }

  private readonly spacing: number;

  get sampleCount(): number {
    return this.samples.length;
  }

  /** Interpolated frame at a distance along the track. */
  sampleAt(s: number): TrackSample {
    const n = this.samples.length;
    const wrapped = this.closed ? ((s % this.length) + this.length) % this.length : clamp(s, 0, this.length);
    const f = wrapped / this.spacing;
    const i0 = Math.floor(f) % n;
    const i1 = (i0 + 1) % n;
    const a = this.samples[i0]!;
    const b = this.samples[i1]!;
    const u = f - Math.floor(f);

    return {
      s: wrapped,
      position: v3add(a.position, v3scale(v3sub(b.position, a.position), u)),
      tangent: v3normalize(v3add(a.tangent, v3scale(v3sub(b.tangent, a.tangent), u))),
      left: v3normalize(v3add(a.left, v3scale(v3sub(b.left, a.left), u))),
      curvature: a.curvature + (b.curvature - a.curvature) * u
    };
  }

  /**
   * World position -> `(s, t)`.
   *
   * Scans the resampled points for the nearest, then refines against that
   * segment. `hint` skips the scan when the previous result is known,
   * which is what you want when tracking a car every tick.
   */
  project(point: Vec3, hint?: number): Projection {
    const n = this.samples.length;
    let bestIndex = 0;
    let bestDistSq = Infinity;

    if (hint === undefined) {
      for (let i = 0; i < n; i++) {
        const d = sqDistance(point, this.samples[i]!.position);
        if (d < bestDistSq) {
          bestDistSq = d;
          bestIndex = i;
        }
      }
    } else {
      // Search a window around the hint — a car cannot have moved far.
      const centre = Math.round((((hint % this.length) + this.length) % this.length) / this.spacing);
      const window = Math.max(4, Math.ceil(60 / this.spacing));
      for (let k = -window; k <= window; k++) {
        const i = ((centre + k) % n + n) % n;
        const d = sqDistance(point, this.samples[i]!.position);
        if (d < bestDistSq) {
          bestDistSq = d;
          bestIndex = i;
        }
      }
    }

    // Refine: project onto the segment leaving the nearest sample, and
    // onto the one entering it, and keep whichever is closer.
    const best = this.refine(point, bestIndex, bestIndex + 1);
    const alt = this.refine(point, (bestIndex - 1 + n) % n, bestIndex);
    return best.distanceSq <= alt.distanceSq ? best.projection : alt.projection;
  }

  private refine(
    point: Vec3,
    i0: number,
    i1: number
  ): { projection: Projection; distanceSq: number } {
    const n = this.samples.length;
    const a = this.samples[((i0 % n) + n) % n]!;
    const b = this.samples[((i1 % n) + n) % n]!;

    const seg = v3sub(b.position, a.position);
    const segLenSq = Math.max(1e-9, v3dot(seg, seg));
    const u = clamp(v3dot(v3sub(point, a.position), seg) / segLenSq, 0, 1);

    const s = a.s + u * this.spacing;
    const sample = this.sampleAt(s);
    const delta = v3sub(point, sample.position);

    return {
      projection: {
        s,
        t: v3dot(delta, sample.left),
        height: delta.y,
        sample
      },
      distanceSq: v3dot(delta, delta)
    };
  }
}

const sqDistance = (a: Vec3, b: Vec3): number => {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
};

const catmullRom = (points: Vec3[], segment: number, u: number, closed: boolean): Vec3 => {
  const n = points.length;
  const idx = (i: number): Vec3 => {
    if (closed) return points[((i % n) + n) % n]!;
    return points[clamp(i, 0, n - 1)]!;
  };
  const p0 = idx(segment - 1);
  const p1 = idx(segment);
  const p2 = idx(segment + 1);
  const p3 = idx(segment + 2);

  const u2 = u * u;
  const u3 = u2 * u;

  const blend = (a: number, b: number, c: number, d: number): number =>
    0.5 * (2 * b + (-a + c) * u + (2 * a - 5 * b + 4 * c - d) * u2 + (-a + 3 * b - 3 * c + d) * u3);

  return vec3(
    blend(p0.x, p1.x, p2.x, p3.x),
    blend(p0.y, p1.y, p2.y, p3.y),
    blend(p0.z, p1.z, p2.z, p3.z)
  );
};

const pointAtDistance = (dense: Vec3[], cumulative: number[], s: number): Vec3 => {
  let lo = 0;
  let hi = cumulative.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (cumulative[mid]! <= s) lo = mid;
    else hi = mid;
  }
  const segLen = cumulative[hi]! - cumulative[lo]!;
  const u = segLen > 1e-9 ? (s - cumulative[lo]!) / segLen : 0;
  return v3add(dense[lo]!, v3scale(v3sub(dense[hi]!, dense[lo]!), u));
};
