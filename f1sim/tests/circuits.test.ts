/**
 * Standards every racing circuit has to meet.
 *
 * `tests/circuit.test.ts` covers Spa in detail, including the things
 * that are true only of Spa. This file is the opposite: the properties
 * that any layout must have to be driveable at all, applied to every
 * circuit in the registry, so adding a new one cannot quietly ship a
 * shape that launches cars off the road.
 *
 * The important one is closure of the *raw* layout. The spline closes
 * the loop by construction, so the gap it reports is always tiny no
 * matter how badly the section list integrates — a circuit whose
 * sections end a kilometre from where they started still produces a
 * closed spline, just one whose shape near the timing line is nothing
 * like what was specified. Measuring the section integration directly is
 * the only way to see that error, and Monza's first draft had it at
 * 18% of a lap while every other check passed.
 */
import { describe, expect, it } from 'vitest';

import { CIRCUIT_SPECS, getCircuit } from '../src/track/circuits';
import type { CircuitSpec } from '../src/track/circuit';

/** Real lap distances, for circuits that model a real one. */
const REAL_LENGTH: Record<string, number> = {
  spa: 7004,
  monza: 5793
};

/** Walk the section list exactly as `buildCircuit` does. */
const integrate = (spec: CircuitSpec): { miss: number; length: number } => {
  let totalTurn = 0;
  for (const s of spec.sections) if (s.radius) totalTurn += s.length / s.radius;
  const scale =
    Math.abs(totalTurn) > 1e-6 ? (Math.sign(totalTurn) * 2 * Math.PI) / totalTurn : 1;

  let heading = 0;
  let x = 0;
  let z = 0;
  let length = 0;

  for (const s of spec.sections) {
    length += s.length;
    const turn = s.radius ? (s.length / s.radius) * scale : 0;
    const steps = Math.max(1, Math.round(s.length));
    for (let i = 0; i < steps; i++) {
      heading += turn / steps;
      x += Math.sin(heading) * (s.length / steps);
      z += Math.cos(heading) * (s.length / steps);
    }
  }

  return { miss: Math.hypot(x, z), length };
};

describe.each(Object.keys(CIRCUIT_SPECS))('circuit %s', (id) => {
  const spec = CIRCUIT_SPECS[id]!;
  const circuit = getCircuit(id);

  it('closes on itself before the spline has to help', () => {
    const { miss, length } = integrate(spec);
    expect(miss / length).toBeLessThan(0.04);
  });

  it('turns through exactly one revolution', () => {
    const a = circuit.spline.sampleAt(0).tangent;
    const b = circuit.spline.sampleAt(circuit.length - 1).tangent;
    expect(a.x * b.x + a.y * b.y + a.z * b.z).toBeGreaterThan(0.999);
  });

  it('has no kink a car could be thrown off', () => {
    let worst = 0;
    for (let s = 0; s < circuit.length; s += 2) {
      const p = circuit.spline.sampleAt(s).tangent;
      const q = circuit.spline.sampleAt(s + 2).tangent;
      worst = Math.max(worst, Math.acos(Math.min(1, p.x * q.x + p.y * q.y + p.z * q.z)));
    }
    expect(worst).toBeLessThan(0.15);
  });

  it('never lays one piece of road over another', () => {
    let worst = -Infinity;
    let where = '';

    for (let s1 = 0; s1 < circuit.length; s1 += 8) {
      const p1 = circuit.spline.sampleAt(s1).position;
      for (let s2 = s1 + 250; s2 < circuit.length; s2 += 8) {
        if (circuit.length - (s2 - s1) < 250) continue;
        const p2 = circuit.spline.sampleAt(s2).position;
        // Genuine height separation is a bridge, not an overlap.
        if (Math.abs(p1.y - p2.y) > 6) continue;

        const plan = Math.hypot(p1.x - p2.x, p1.z - p2.z);
        const needed = circuit.halfWidthAt(s1) + circuit.halfWidthAt(s2);
        if (needed - plan > worst) {
          worst = needed - plan;
          where = `${circuit.sectionAt(s1)} over ${circuit.sectionAt(s2)}`;
        }
      }
    }

    expect(worst, `road overlaps itself: ${where}`).toBeLessThanOrEqual(0);
  });

  it('names every metre of the lap', () => {
    for (let s = 0; s < circuit.length; s += 137) {
      expect(circuit.sectionAt(s)).toBeTruthy();
    }
  });

  it('reports sector splits that run in order and end at the lap', () => {
    const [s1, s2, s3] = spec.sectorSplits;
    expect(s1).toBeLessThan(s2!);
    expect(s2).toBeLessThan(s3!);
    expect(Math.abs(s3! - circuit.length) / circuit.length).toBeLessThan(0.05);
  });

  if (REAL_LENGTH[id] !== undefined) {
    it('comes out close to the real lap distance', () => {
      const real = REAL_LENGTH[id]!;
      expect(Math.abs(circuit.length - real) / real).toBeLessThan(0.06);
    });
  }
});
