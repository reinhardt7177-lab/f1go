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
 * What this tool cannot do is be trusted on its own, and that is worth
 * stating because it has now been proved twice. It optimises the raw
 * integrated centreline, sampled every 25 m; the circuit you actually
 * drive is a spline fitted through that, and the two disagree by more
 * than the cost function can see. Tightening the criteria below and
 * re-running it on Spa produced a layout that scored well here and was
 * measurably worse in the built mesh — it traded 8 m of overlap at the
 * start/finish for 15 m at Fagnes, which `check-layout.ts` and
 * `tests/overlap.test.ts` both caught immediately and which was
 * reverted.
 *
 * So: run it, paste the result, then run `check-layout.ts` and the test
 * suite. If either is worse than before, throw the result away. The
 * cost printed below is a search heuristic, not a verdict.
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

/**
 * Metres of clearance to insist on between two passes of the road.
 *
 * Four was not enough, and could not have been: it left the two roads
 * with their kerbs touching and nowhere at all for the run-off, so the
 * mesh had to clamp its verges to the bone wherever this tool declared
 * success. Twelve leaves a kerb and a strip of apron either side.
 */
const CLEARANCE = 12;
/** Sample spacing for the overlap test. Coarse: this runs ~10k times. */
const SAMPLE = 25;
/**
 * Height difference above which two passes are a bridge, not a clash.
 *
 * Six metres let Spa's start/finish straight sit five metres under the
 * descent to Eau Rouge and call it a flyover. It is not one: the real
 * circuit has no bridge there, and on screen it read as a road hanging
 * in the air over the pit straight.
 */
const BRIDGE = 4;

/**
 * Are two samples different roads, or the same one seen twice?
 *
 * This used to be `ignore anything closer than 300 m along the lap`,
 * and that single number is why the worst overlap on the circuit
 * survived every previous run of this tool: Spa's start/finish straight
 * and its descent to Eau Rouge are about 150 m apart around the lap, so
 * the check simply never looked at them.
 *
 * A fixed distance cannot work, because what counts as "the same road"
 * scales with how tight the corner is. What separates the two cases is
 * the walk against the gap — along a straight or a gentle curve you get
 * from one sample to the other in roughly the distance between them; if
 * the walk is half again as long as the gap, the road has doubled back
 * and these are two roads that must stay apart.
 */
const differentRoads = (alongLap: number, plan: number): boolean =>
  alongLap >= 40 && alongLap >= plan * 1.5;

type Knob = { i: number; field: 'length' | 'radius'; lo: number; hi: number };

/*
 * Straights move freely within a band; corner radii much less. A
 * corner's radius is what makes it feel like itself, so closure error
 * is paid for out of the straights wherever possible.
 *
 * The bands are wider than they were, and they had to be. Tuning an
 * existing layout by a few per cent is one job; taking a newly drafted
 * one that misses its own start by three hundred metres and making it
 * close at all is another, and the narrow bands simply could not reach.
 * A draft that has to be opened out by half is still a draft.
 *
 * `FIT_SPREAD` widens both bands for that case. Leave it at 1 when
 * refining a layout that already works — the wider the search, the more
 * freely the tool will trade away the shape you drew for closure it can
 * measure.
 */
const SPREAD = Number(process.env.FIT_SPREAD ?? 1);
const band = (v: number, lo: number, hi: number): [number, number] => [
  v * (1 - (1 - lo) * SPREAD),
  v * (1 + (hi - 1) * SPREAD)
];

const knobs: Knob[] = [];
spec.sections.forEach((s, i) => {
  if (s.radius === undefined) {
    const [lo, hi] = band(s.length, 0.8, 1.28);
    knobs.push({ i, field: 'length', lo, hi });
  } else {
    const r = s.radius;
    const [lo, hi] = band(Math.abs(r), 0.85, 1.15);
    knobs.push({
      i,
      field: 'radius',
      lo: r > 0 ? lo : -lo,
      hi: r > 0 ? hi : -hi
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
    for (let b = a + 1; b < n; b++) {
      const q = samples[b]!;
      if (Math.abs(p.y - q.y) > BRIDGE) continue;
      const plan = Math.hypot(p.x - q.x, p.z - q.z);
      const alongLap = Math.min(b - a, n - (b - a)) * SAMPLE;
      if (!differentRoads(alongLap, plan)) continue;
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
