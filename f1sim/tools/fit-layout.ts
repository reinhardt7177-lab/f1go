/*
 * Solve a circuit's straight lengths and corner radii so the layout
 * closes on itself without laying road over road.
 *
 *   npx tsx tools/fit-layout.ts <circuit-id> <target-length-m>
 *
 * Prints a section list to paste back into `src/track/circuits.ts`.
 *
 * Three objectives, and the third is the one that makes this tool worth
 * having. Closing the loop is easy on its own — but a lap that closes
 * tightly has, by definition, curled back to where it began, and on a
 * circuit like Spa the shortest way to do that runs the return leg
 * straight through an earlier part of the track. Sweeping a ribbon
 * along that centreline leaves two sheets of road interpenetrating, and
 * a car meeting the seam at 250 km/h is launched off the circuit.
 *
 * Fitting for closure alone did exactly that here: it took Spa's
 * endpoint miss from 189 m to 0.4 m and, in the same move, put Fagnes
 * 15 m inside the run to Blanchimont. So the overlap is a term in the
 * cost, not something to check afterwards and hope for.
 */
import { CIRCUIT_SPECS } from '../src/track/circuits';
import type { CircuitSpec } from '../src/track/circuit';

const id = process.argv[2]!;
const targetLength = Number(process.argv[3]!);
const spec = CIRCUIT_SPECS[id];
if (!spec) throw new Error(`unknown circuit: ${id}`);

/** Metres of clearance to insist on between two passes of the road. */
const CLEARANCE = 4;
/** Sample spacing for the overlap test. Coarse: this runs ~10k times. */
const SAMPLE = 25;
/** Ignore pairs closer than this along the lap — they are the same road. */
const APART = 300;
/** Height difference above which two passes are a bridge, not a clash. */
const BRIDGE = 6;

type Knob = { i: number; field: 'length' | 'radius'; lo: number; hi: number };

// Straights move freely within a band; corner radii barely at all. A
// corner's radius is what makes it feel like itself, so closure error is
// paid for out of the straights wherever possible.
const knobs: Knob[] = [];
spec.sections.forEach((s, i) => {
  if (s.radius === undefined) {
    knobs.push({ i, field: 'length', lo: s.length * 0.8, hi: s.length * 1.28 });
  } else {
    const r = s.radius;
    knobs.push({
      i,
      field: 'radius',
      lo: r > 0 ? r * 0.85 : r * 1.15,
      hi: r > 0 ? r * 1.15 : r * 0.85
    });
  }
});

const lengths = spec.sections.map((s) => s.length);
const radii = spec.sections.map((s) => s.radius);

interface Sample {
  x: number;
  y: number;
  z: number;
  halfWidth: number;
}

const walk = (): { miss: number; length: number; samples: Sample[] } => {
  let totalTurn = 0;
  for (let i = 0; i < lengths.length; i++) {
    if (radii[i] !== undefined) totalTurn += lengths[i]! / radii[i]!;
  }
  const scale =
    Math.abs(totalTurn) > 1e-6 ? (Math.sign(totalTurn) * 2 * Math.PI) / totalTurn : 1;

  let heading = 0;
  let x = 0;
  let y = 0;
  let z = 0;
  let travelled = 0;
  let nextSample = 0;
  let halfWidth = spec.defaultHalfWidth;
  const samples: Sample[] = [];

  for (let i = 0; i < lengths.length; i++) {
    const section = spec.sections[i]!;
    if (section.halfWidth !== undefined) halfWidth = section.halfWidth;
    const L = lengths[i]!;
    const gradient = section.gradient ?? 0;
    const turn = radii[i] !== undefined ? (L / radii[i]!) * scale : 0;
    const steps = Math.max(1, Math.round(L));
    const dl = L / steps;

    for (let k = 0; k < steps; k++) {
      heading += turn / steps;
      x += Math.sin(heading) * dl;
      z += Math.cos(heading) * dl;
      y += gradient * dl;
      travelled += dl;
      if (travelled >= nextSample) {
        samples.push({ x, y, z, halfWidth });
        nextSample += SAMPLE;
      }
    }
  }

  return { miss: Math.hypot(x, z), length: travelled, samples };
};

const cost = (): number => {
  const { miss, length, samples } = walk();

  let worst = 0;
  const n = samples.length;
  for (let a = 0; a < n; a++) {
    const p = samples[a]!;
    for (let b = a + Math.ceil(APART / SAMPLE); b < n; b++) {
      if ((n - (b - a)) * SAMPLE < APART) continue;
      const q = samples[b]!;
      if (Math.abs(p.y - q.y) > BRIDGE) continue;
      const plan = Math.hypot(p.x - q.x, p.z - q.z);
      const needed = p.halfWidth + q.halfWidth + CLEARANCE;
      if (needed - plan > worst) worst = needed - plan;
    }
  }

  // Closure and overlap both in metres; overlap weighted hard because a
  // metre of interpenetrating road is a far worse defect than a metre
  // of closure error, which the spline absorbs harmlessly.
  return miss + Math.abs(length - targetLength) * 0.6 + worst * 25;
};

let best = cost();
for (let pass = 0; pass < 120; pass++) {
  const step = 40 * Math.pow(0.97, pass);
  for (const k of knobs) {
    const arr = k.field === 'length' ? lengths : (radii as number[]);
    const original = arr[k.i]!;
    for (const delta of [step, -step]) {
      const next = original + delta;
      const lo = Math.min(k.lo, k.hi);
      const hi = Math.max(k.lo, k.hi);
      if (next < lo || next > hi) continue;
      arr[k.i] = next;
      const c = cost();
      if (c < best) {
        best = c;
        break;
      }
      arr[k.i] = original;
    }
  }
}

const final = walk();
console.error(
  `cost=${best.toFixed(1)}  miss=${final.miss.toFixed(1)}m  length=${final.length.toFixed(0)}m`
);

for (let i = 0; i < spec.sections.length; i++) {
  const s = spec.sections[i]!;
  const parts = [`name: '${s.name}'`, `length: ${Math.round(lengths[i]!)}`];
  if (radii[i] !== undefined) parts.push(`radius: ${Math.round(radii[i]!)}`);
  if (s.gradient !== undefined) parts.push(`gradient: ${s.gradient}`);
  if (s.banking !== undefined) parts.push(`banking: ${s.banking}`);
  if (s.halfWidth !== undefined) parts.push(`halfWidth: ${s.halfWidth}`);
  console.log(`    { ${parts.join(', ')} },`);
}
