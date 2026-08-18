/**
 * Circuits.
 *
 * A track is described the way a track map describes it: a sequence of
 * straights and constant-radius corners, each with a length, a gradient
 * and a banking angle. Integrating that description gives the three
 * dimensional centreline, which becomes a spline, which everything else
 * hangs off.
 *
 * This is a much better source format than a list of coordinates. It is
 * readable, it is editable by someone holding a track map, and corner
 * radii — the numbers that actually decide how a circuit drives — are
 * stated directly instead of being implied by point spacing.
 */
import { clamp, v3len, v3sub, vec3 } from '../core/math';
import type { Vec3 } from '../core/math';
import { CenterlineSpline } from './spline';

export type SurfaceKind = 'tarmac' | 'kerb' | 'runoff' | 'grass' | 'gravel';

/** Friction multiplier applied to the tyre's coefficient. */
export const SURFACE_GRIP: Record<SurfaceKind, number> = {
  tarmac: 1,
  kerb: 0.86,
  runoff: 0.78,
  gravel: 0.42,
  grass: 0.33
};

export interface CircuitSection {
  name: string;
  /** Arc length along the centreline (m). */
  length: number;
  /** Corner radius (m). 0 is a straight; positive turns right. */
  radius?: number;
  /** Rise over run; 0.14 is a 14 per cent climb. */
  gradient?: number;
  /** Banking (rad); positive raises the outside of a right-hand corner. */
  banking?: number;
  /** Road half-width (m); carried forward from the previous section. */
  halfWidth?: number;
  /** Run-off beyond the kerb on each side (m). */
  runoff?: number;
}

export interface CircuitSpec {
  id: string;
  name: string;
  country: string;
  sections: CircuitSection[];
  /** Distances along the lap where each sector ends; last is the lap. */
  sectorSplits: number[];
  /** Half-width used until a section overrides it. */
  defaultHalfWidth: number;
  defaultRunoff: number;
  kerbWidth: number;
  /** Where the timing line sits, as a distance from the first section. */
  startLine: number;
}

/** Per-sample profile, indexed the same way the spline samples are. */
interface Profile {
  halfWidth: number;
  runoff: number;
  banking: number;
  section: string;
}

export class Circuit {
  readonly spline: CenterlineSpline;
  readonly spec: CircuitSpec;
  readonly length: number;
  readonly kerbWidth: number;
  /** Sector boundaries in metres, ascending, last entry is `length`. */
  readonly sectorSplits: number[];

  private readonly profile: Profile[];
  private readonly profileSpacing: number;

  constructor(spec: CircuitSpec, samples: IntegratedSample[]) {
    this.spec = spec;
    this.kerbWidth = spec.kerbWidth;

    const controlPoints = samples.map((s) => s.position);
    this.spline = new CenterlineSpline(controlPoints, 2, true);
    this.length = this.spline.length;

    // The integration and the spline resample at different rates, so the
    // profile is stored on its own uniform grid and looked up by distance.
    this.profileSpacing = this.length / samples.length;
    this.profile = samples.map((s) => ({
      halfWidth: s.halfWidth,
      runoff: s.runoff,
      banking: s.banking,
      section: s.section
    }));

    this.sectorSplits = spec.sectorSplits.map((d) => clamp(d, 0, this.length));
    if (this.sectorSplits[this.sectorSplits.length - 1] !== this.length) {
      this.sectorSplits[this.sectorSplits.length - 1] = this.length;
    }
  }

  private profileAt(s: number): Profile {
    const n = this.profile.length;
    const wrapped = ((s % this.length) + this.length) % this.length;
    const i = Math.min(n - 1, Math.floor(wrapped / this.profileSpacing));
    return this.profile[i]!;
  }

  halfWidthAt(s: number): number {
    return this.profileAt(s).halfWidth;
  }

  runoffAt(s: number): number {
    return this.profileAt(s).runoff;
  }

  bankingAt(s: number): number {
    return this.profileAt(s).banking;
  }

  sectionAt(s: number): string {
    return this.profileAt(s).section;
  }

  /** Which surface a point sits on, given its lateral offset. */
  surfaceAt(s: number, t: number): SurfaceKind {
    const p = this.profileAt(s);
    const d = Math.abs(t);
    if (d <= p.halfWidth) return 'tarmac';
    if (d <= p.halfWidth + this.kerbWidth) return 'kerb';
    if (d <= p.halfWidth + this.kerbWidth + p.runoff) return 'runoff';
    return 'grass';
  }

  /** Grip multiplier for a world position. */
  gripAt(s: number, t: number): number {
    return SURFACE_GRIP[this.surfaceAt(s, t)];
  }

  /** True when all four wheels would be within the white lines. */
  isOnTrack(s: number, t: number): boolean {
    return Math.abs(t) <= this.halfWidthAt(s);
  }

  /** Which sector a distance falls in, 0-based. */
  sectorAt(s: number): number {
    const wrapped = ((s % this.length) + this.length) % this.length;
    for (let i = 0; i < this.sectorSplits.length; i++) {
      if (wrapped < this.sectorSplits[i]!) return i;
    }
    return this.sectorSplits.length - 1;
  }
}

interface IntegratedSample {
  position: Vec3;
  halfWidth: number;
  runoff: number;
  banking: number;
  section: string;
}

/**
 * Walk the section list, integrating heading and height.
 *
 * Heading is measured so that zero points along -Z (the forward axis)
 * and increases when turning right, matching the right-handed, +Y up
 * convention used everywhere else.
 */
export const buildCircuit = (spec: CircuitSpec, step = 4): Circuit => {
  const samples: IntegratedSample[] = [];

  // A closed lap must turn through exactly one full revolution. Radii
  // read off a track map never sum to that on their own, and the
  // shortfall appears as a kink in the tangent at the timing line: the
  // spline is closed in position but not in direction, so a car driving
  // straight through the line finds the road at an angle to it and
  // leaves the circuit. Normalising the total turn removes the kink at
  // the cost of adjusting every radius by the same small factor.
  let totalTurn = 0;
  for (const section of spec.sections) {
    if (section.radius) totalTurn += section.length / section.radius;
  }
  const turnScale =
    Math.abs(totalTurn) > 1e-6 ? (Math.sign(totalTurn) * 2 * Math.PI) / totalTurn : 1;

  let heading = 0;
  let x = 0;
  let y = 0;
  let z = 0;
  let halfWidth = spec.defaultHalfWidth;
  let runoff = spec.defaultRunoff;

  for (const section of spec.sections) {
    if (section.halfWidth !== undefined) halfWidth = section.halfWidth;
    if (section.runoff !== undefined) runoff = section.runoff;

    const gradient = section.gradient ?? 0;
    const banking = section.banking ?? 0;
    const radius = section.radius ?? 0;
    const steps = Math.max(1, Math.round(section.length / step));
    const ds = section.length / steps;

    for (let i = 0; i < steps; i++) {
      samples.push({
        position: vec3(x, y, z),
        halfWidth,
        runoff,
        banking,
        section: section.name
      });

      // Advance along the current heading, then turn.
      x += Math.sin(heading) * ds;
      z += -Math.cos(heading) * ds;
      y += gradient * ds;

      if (radius !== 0) heading += (ds / radius) * turnScale;
    }
  }

  // Close the loop cleanly. Real circuits return to their start; the
  // integration will not, because the radii are approximations. Spread
  // the mismatch over the whole lap so no single corner distorts.
  const first = samples[0]!.position;
  const last = samples[samples.length - 1]!.position;
  const gap = v3sub(first, last);
  const n = samples.length;

  if (v3len(gap) > 0.001) {
    for (let i = 0; i < n; i++) {
      const w = i / (n - 1);
      const p = samples[i]!.position;
      samples[i]!.position = vec3(p.x + gap.x * w, p.y + gap.y * w, p.z + gap.z * w);
    }
  }

  // Round off the vertical profile — after closing the loop, not before.
  //
  // Gradient is stated per section, so it steps at every boundary: at
  // Interlagos the drop into the Senna S runs at -8 per cent into
  // Raidillon at +17, a 25-point break over a single sample. That is a
  // crease, not a compression, and a car with 50 mm of floor clearance
  // and a 3.6 m wheelbase grounds out on it and stops dead. Real
  // circuits have vertical curves; a few smoothing passes give these
  // ones the same, spreading each transition over roughly twenty metres.
  //
  // Order matters. Smoothing first would blend the unclosed start and
  // end heights across the seam, dragging the whole first corner up with
  // it — the closure ramp is only correct on an unsmoothed profile.
  smoothHeights(samples, 20);

  return new Circuit(spec, samples);
};

/** 1-2-1 smoothing of the height channel, in place and periodic. */
const smoothHeights = (samples: IntegratedSample[], passes: number): void => {
  const n = samples.length;
  const scratch = new Float64Array(n);
  for (let pass = 0; pass < passes; pass++) {
    for (let i = 0; i < n; i++) {
      const prev = samples[(i - 1 + n) % n]!.position.y;
      const next = samples[(i + 1) % n]!.position.y;
      scratch[i] = 0.25 * prev + 0.5 * samples[i]!.position.y + 0.25 * next;
    }
    for (let i = 0; i < n; i++) samples[i]!.position.y = scratch[i]!;
  }
};

