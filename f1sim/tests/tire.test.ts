import { describe, expect, it } from 'vitest';

import { DEG, RAD } from '../src/core/math';
import {
  SLIP_ANGLE_AT_PEAK,
  defaultTireParams,
  magicFormula,
  muAtLoad,
  solveTire
} from '../src/sim/tire';

const p = defaultTireParams();

describe('magic formula', () => {
  it('produces no force at zero slip', () => {
    expect(magicFormula(0, p.latB, p.latC, p.latE)).toBe(0);
  });

  it('is odd about zero', () => {
    const a = magicFormula(0.08, p.latB, p.latC, p.latE);
    const b = magicFormula(-0.08, p.latB, p.latC, p.latE);
    expect(a).toBeCloseTo(-b, 12);
  });

  it('peaks near the documented slip angle and then falls away', () => {
    let peakSlip = 0;
    let peakValue = 0;
    for (let slip = 0; slip < 0.5; slip += 0.001) {
      const v = magicFormula(slip, p.latB, p.latC, p.latE);
      if (v > peakValue) {
        peakValue = v;
        peakSlip = slip;
      }
    }
    // Within a degree of the constant the combined-slip maths relies on.
    expect(peakSlip * DEG).toBeCloseTo(SLIP_ANGLE_AT_PEAK * DEG, 0);

    // Past the peak the tyre gives up grip — this is what makes a slide
    // recoverable or not, so it must actually be modelled.
    const beyond = magicFormula(0.35, p.latB, p.latC, p.latE);
    expect(beyond).toBeLessThan(peakValue);
  });
});

describe('load sensitivity', () => {
  it('reduces the friction coefficient as load rises', () => {
    const light = muAtLoad(p, p.loadReference * 0.5);
    const nominal = muAtLoad(p, p.loadReference);
    const heavy = muAtLoad(p, p.loadReference * 2);

    expect(light).toBeGreaterThan(nominal);
    expect(nominal).toBeGreaterThan(heavy);
    expect(nominal).toBeCloseTo(p.muNominal, 10);
  });

  it('means doubling load gives less than double the grip', () => {
    const single = muAtLoad(p, 3000) * 3000;
    const double = muAtLoad(p, 6000) * 6000;
    expect(double).toBeLessThan(single * 2);
  });

  it('never lets the coefficient collapse to zero', () => {
    expect(muAtLoad(p, 500_000)).toBeGreaterThan(0.3);
  });
});

describe('solveTire', () => {
  it('produces nothing without load', () => {
    const f = solveTire(p, 0.1, 0.1, 0);
    expect(f.long).toBe(0);
    expect(f.lat).toBe(0);
  });

  it('opposes lateral slip', () => {
    // Slip to the right should generate force to the left.
    const right = solveTire(p, 0, 5 * RAD, 3000);
    expect(right.lat).toBeLessThan(0);
    const left = solveTire(p, 0, -5 * RAD, 3000);
    expect(left.lat).toBeGreaterThan(0);
  });

  it('drives the car forward under positive slip ratio', () => {
    expect(solveTire(p, 0.1, 0, 3000).long).toBeGreaterThan(0);
    expect(solveTire(p, -0.1, 0, 3000).long).toBeLessThan(0);
  });

  it('reduces to the pure curve on each axis', () => {
    const pureLat = solveTire(p, 0, SLIP_ANGLE_AT_PEAK, 3000);
    const expected = -magicFormula(SLIP_ANGLE_AT_PEAK, p.latB, p.latC, p.latE) * muAtLoad(p, 3000) * 3000;
    expect(pureLat.lat).toBeCloseTo(expected, 6);
  });

  it('shares one grip budget between braking and cornering', () => {
    const load = 3000;
    const pureLat = Math.abs(solveTire(p, 0, SLIP_ANGLE_AT_PEAK, load).lat);
    const combined = solveTire(p, -0.12, SLIP_ANGLE_AT_PEAK, load);

    // Braking hard while at peak slip angle must cost lateral grip.
    expect(Math.abs(combined.lat)).toBeLessThan(pureLat);

    // And the resultant must stay inside the friction circle.
    const resultant = Math.hypot(combined.long, combined.lat);
    const available = muAtLoad(p, load) * load;
    expect(resultant).toBeLessThanOrEqual(available * 1.02);
  });

  it('never exceeds the friction circle at any slip combination', () => {
    const load = 4200;
    const available = muAtLoad(p, load) * load;
    for (let ratio = -1; ratio <= 1; ratio += 0.05) {
      for (let angle = -0.6; angle <= 0.6; angle += 0.03) {
        const f = solveTire(p, ratio, angle, load);
        expect(Math.hypot(f.long, f.lat)).toBeLessThanOrEqual(available * 1.02);
      }
    }
  });
});
