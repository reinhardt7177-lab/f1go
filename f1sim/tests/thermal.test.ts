import { describe, expect, it } from 'vitest';

import {
  conditionGrip,
  defaultThermalParams,
  freshTire,
  stepTireCondition,
  thermalGrip,
  wearGrip
} from '../src/sim/tire';

const p = defaultThermalParams();
const DT = 1 / 120;

describe('temperature window', () => {
  it('peaks at the optimal temperature', () => {
    const best = thermalGrip(p, p.optimalTemp, 0);
    expect(best).toBeCloseTo(1, 6);
    expect(thermalGrip(p, p.optimalTemp - 15, 0)).toBeLessThan(best);
    expect(thermalGrip(p, p.optimalTemp + 15, 0)).toBeLessThan(best);
  });

  it('falls off both cold and hot', () => {
    // Cold rubber is too stiff to key into the road; hot rubber greases.
    expect(thermalGrip(p, 30, 0)).toBeLessThan(0.8);
    expect(thermalGrip(p, 190, 0)).toBeLessThan(0.8);
  });

  it('never falls below the floor', () => {
    for (const t of [-40, 0, 400]) {
      expect(thermalGrip(p, t, 0)).toBeGreaterThanOrEqual(p.gripFloor);
    }
  });

  it('shifts the window down as the tyre wears', () => {
    // A worn tyre wants to run cooler, so peak grip moves with it.
    const freshAtOptimal = thermalGrip(p, p.optimalTemp, 0);
    const wornAtOptimal = thermalGrip(p, p.optimalTemp, 1);
    const wornAtShifted = thermalGrip(p, p.optimalTemp - p.wearTempPenalty, 1);

    expect(wornAtOptimal).toBeLessThan(freshAtOptimal);
    expect(wornAtShifted).toBeGreaterThan(wornAtOptimal);
  });
});

describe('wear', () => {
  it('reduces grip monotonically', () => {
    expect(wearGrip(p, 0)).toBeCloseTo(1, 10);
    expect(wearGrip(p, 0.5)).toBeLessThan(wearGrip(p, 0.2));
    expect(wearGrip(p, 1)).toBeCloseTo(p.gripAtFullWear, 10);
  });
});

describe('thermal integration', () => {
  it('starts out of the blankets, below the window', () => {
    const c = freshTire(p);
    expect(c.surfaceTemp).toBeLessThan(p.optimalTemp);
    expect(conditionGrip(p, c)).toBeLessThan(1);
  });

  it('heats the surface faster than the core', () => {
    const c = freshTire(p);
    const startSurface = c.surfaceTemp;
    const startCore = c.coreTemp;

    // A second of hard sliding: 40 kN of force at 2 m/s of slip.
    for (let i = 0; i < 120; i++) stepTireCondition(p, c, 80_000, 60, DT, true);

    const surfaceRise = c.surfaceTemp - startSurface;
    const coreRise = c.coreTemp - startCore;

    // The surface is what sets grip right now, so it has to move within a
    // corner. The core barely notices a single second — it may even drift
    // down, since a tyre out of the blankets is above ambient and losing
    // heat faster than the tread is yet feeding it.
    expect(surfaceRise).toBeGreaterThan(5);
    expect(Math.abs(coreRise)).toBeLessThan(surfaceRise / 3);
  });

  it('works a cold tyre into its window', () => {
    const c = freshTire(p);
    const cold = conditionGrip(p, c);

    // Twenty seconds of moderate work, as an out-lap would provide.
    for (let i = 0; i < 120 * 20; i++) stepTireCondition(p, c, 12_000, 50, DT, true);

    expect(c.surfaceTemp).toBeGreaterThan(p.optimalTemp - p.tempWindow);
    expect(conditionGrip(p, c)).toBeGreaterThan(cold);
  });

  it('overheats and loses grip when abused', () => {
    const c = freshTire(p);
    for (let i = 0; i < 120 * 20; i++) stepTireCondition(p, c, 120_000, 40, DT, true);

    expect(c.surfaceTemp).toBeGreaterThan(p.optimalTemp + p.tempWindow);
    expect(conditionGrip(p, c)).toBeLessThan(0.95);
  });

  it('cools back towards ambient when left alone', () => {
    const c = freshTire(p, 160);
    for (let i = 0; i < 120 * 60; i++) stepTireCondition(p, c, 0, 30, DT, true);
    expect(c.surfaceTemp).toBeLessThan(120);
  });

  it('cools faster in a stronger airstream', () => {
    const slow = freshTire(p, 150);
    const fast = freshTire(p, 150);
    for (let i = 0; i < 120 * 10; i++) {
      stepTireCondition(p, slow, 0, 5, DT, true);
      stepTireCondition(p, fast, 0, 85, DT, true);
    }
    expect(fast.surfaceTemp).toBeLessThan(slow.surfaceTemp);
  });

  it('wears in proportion to friction energy', () => {
    const gentle = freshTire(p);
    const abused = freshTire(p);
    for (let i = 0; i < 120 * 30; i++) {
      stepTireCondition(p, gentle, 8_000, 50, DT, true);
      stepTireCondition(p, abused, 80_000, 50, DT, true);
    }
    expect(abused.wear).toBeGreaterThan(gentle.wear * 5);
    expect(abused.wear).toBeLessThanOrEqual(1);
  });

  it('does not wear an airborne tyre', () => {
    const c = freshTire(p);
    for (let i = 0; i < 120 * 5; i++) stepTireCondition(p, c, 50_000, 60, DT, false);
    expect(c.wear).toBe(0);
  });
});
