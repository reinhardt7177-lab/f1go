/*
 * Report whether each circuit is driveable.
 *
 *   npx tsx tools/check-layout.ts [id...]
 *
 * The number that matters is the raw endpoint miss. The spline closes
 * the loop by construction, so its own reported gap is always tiny even
 * when the section list ends a kilometre from where it began — and a
 * layout like that is badly distorted near the timing line while every
 * other check still passes.
 */
import { getCircuit, CIRCUIT_SPECS } from '../src/track/circuits';

const ids = process.argv.slice(2);
const targets = ids.length ? ids : Object.keys(CIRCUIT_SPECS);

for (const id of targets) {
  let c;
  try {
    c = getCircuit(id);
  } catch (e) {
    console.log(`${id}: FAILED TO BUILD — ${(e as Error).message}`);
    continue;
  }

  const a = c.spline.sampleAt(0);
  const b = c.spline.sampleAt(c.length - 0.01);
  const gap = Math.hypot(a.position.x - b.position.x, a.position.y - b.position.y, a.position.z - b.position.z);

  const t0 = a.tangent;
  const t1 = c.spline.sampleAt(c.length - 1).tangent;
  const dot = t0.x * t1.x + t0.y * t1.y + t0.z * t1.z;

  let kink = 0;
  for (let s = 0; s < c.length; s += 2) {
    const p = c.spline.sampleAt(s).tangent;
    const q = c.spline.sampleAt(s + 2).tangent;
    kink = Math.max(kink, Math.acos(Math.min(1, p.x * q.x + p.y * q.y + p.z * q.z)));
  }

  let worst = -Infinity;
  let where = '';
  for (let s1 = 0; s1 < c.length; s1 += 8) {
    const p1 = c.spline.sampleAt(s1).position;
    for (let s2 = s1 + 250; s2 < c.length; s2 += 8) {
      if (c.length - (s2 - s1) < 250) continue;
      const p2 = c.spline.sampleAt(s2).position;
      if (Math.abs(p1.y - p2.y) > 6) continue;
      const plan = Math.hypot(p1.x - p2.x, p1.z - p2.z);
      const needed = c.halfWidthAt(s1) + c.halfWidthAt(s2);
      if (needed - plan > worst) {
        worst = needed - plan;
        where = `${c.sectionAt(s1)} / ${c.sectionAt(s2)}`;
      }
    }
  }

  let lo = Infinity;
  let hi = -Infinity;
  for (let s = 0; s < c.length; s += 5) {
    const y = c.spline.sampleAt(s).position.y;
    lo = Math.min(lo, y);
    hi = Math.max(hi, y);
  }

  console.log(
    `${id.padEnd(12)} len=${c.length.toFixed(0).padStart(5)}m  gap=${gap.toFixed(2).padStart(6)}m  ` +
      `headingDot=${dot.toFixed(5)}  maxKink=${kink.toFixed(3)}  ` +
      `elev=${(hi - lo).toFixed(0)}m  worstOverlap=${worst.toFixed(1)}m  [${where}]`
  );
}

/* The spline closes the loop by construction, so the gap it reports is
   always tiny. What matters is how far the raw section integration
   misses by — that is the error the closing segment has to absorb. */
console.log('\nraw integration closure (before the spline closes it):');
for (const id of targets) {
  const spec = CIRCUIT_SPECS[id];
  if (!spec) continue;
  let total = 0;
  for (const s of spec.sections) if (s.radius) total += s.length / s.radius;
  const scale = Math.abs(total) > 1e-6 ? (Math.sign(total) * 2 * Math.PI) / total : 1;

  let h = 0, x = 0, z = 0, len = 0;
  const STEP = 1;
  for (const s of spec.sections) {
    len += s.length;
    const turn = s.radius ? (s.length / s.radius) * scale : 0;
    const n = Math.max(1, Math.round(s.length / STEP));
    for (let i = 0; i < n; i++) {
      h += turn / n;
      x += Math.sin(h) * (s.length / n);
      z += Math.cos(h) * (s.length / n);
    }
  }
  console.log(`  ${id.padEnd(12)} length=${len}m  endpoint miss=${Math.hypot(x, z).toFixed(1)}m ` +
    `(${((Math.hypot(x, z) / len) * 100).toFixed(2)}% of lap)`);
}
