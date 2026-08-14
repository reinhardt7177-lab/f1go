/*
 * Solve a circuit's straight lengths and corner radii so the layout
 * closes on itself.
 *
 *   npx tsx tools/fit-layout.ts <circuit-id> <target-length-m>
 *
 * Prints a section list to paste back into `src/track/circuits.ts`.
 * Straights move freely within a band, corner radii barely at all —
 * a corner's radius is what makes it feel like itself, so the closure
 * error is paid for out of the straights wherever possible.
 */
import { CIRCUIT_SPECS } from '../src/track/circuits';
import type { CircuitSpec } from '../src/track/circuit';

const id = process.argv[2]!;
const targetLength = Number(process.argv[3]!);
const spec = CIRCUIT_SPECS[id]!;

type Knob = { i: number; field: 'length' | 'radius'; lo: number; hi: number };

// Straights are free to move a long way; corner radii only a little,
// because their value is what makes the corner feel like itself.
const knobs: Knob[] = [];
spec.sections.forEach((s, i) => {
  if (s.radius === undefined) {
    knobs.push({ i, field: 'length', lo: s.length * 0.80, hi: s.length * 1.28 });
  } else {
    const r = s.radius;
    knobs.push({
      i,
      field: 'radius',
      lo: r > 0 ? r * 0.82 : r * 1.18,
      hi: r > 0 ? r * 1.18 : r * 0.82
    });
  }
});

const lengths = spec.sections.map((s) => s.length);
const radii = spec.sections.map((s) => s.radius);

const cost = (): number => {
  let total = 0;
  for (let i = 0; i < lengths.length; i++) {
    if (radii[i] !== undefined) total += lengths[i]! / radii[i]!;
  }
  const scale = Math.abs(total) > 1e-6 ? (Math.sign(total) * 2 * Math.PI) / total : 1;

  let h = 0;
  let x = 0;
  let z = 0;
  let len = 0;
  for (let i = 0; i < lengths.length; i++) {
    const L = lengths[i]!;
    len += L;
    const turn = radii[i] !== undefined ? (L / radii[i]!) * scale : 0;
    const n = Math.max(1, Math.round(L));
    for (let k = 0; k < n; k++) {
      h += turn / n;
      x += Math.sin(h) * (L / n);
      z += Math.cos(h) * (L / n);
    }
  }

  const miss = Math.hypot(x, z);
  const lengthErr = Math.abs(len - targetLength);
  // Closure dominates; distance is a strong but secondary pull.
  return miss + lengthErr * 0.6;
};

let best = cost();
for (let pass = 0; pass < 260; pass++) {
  const step = 40 * Math.pow(0.985, pass);
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

console.log(`cost=${best.toFixed(1)}`);
const out: CircuitSpec['sections'] = spec.sections.map((s, i) => ({
  ...s,
  length: Math.round(lengths[i]!),
  ...(radii[i] !== undefined ? { radius: Math.round(radii[i]!) } : {})
}));
console.log(`total length = ${out.reduce((n, s) => n + s.length, 0)} m\n`);
for (const s of out) {
  const parts = [`name: '${s.name}'`, `length: ${s.length}`];
  if (s.radius !== undefined) parts.push(`radius: ${s.radius}`);
  if (s.gradient !== undefined) parts.push(`gradient: ${s.gradient}`);
  if (s.banking !== undefined) parts.push(`banking: ${s.banking}`);
  if (s.halfWidth !== undefined) parts.push(`halfWidth: ${s.halfWidth}`);
  console.log(`    { ${parts.join(', ')} },`);
}
