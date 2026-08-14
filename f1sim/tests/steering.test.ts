/**
 * Steering feel.
 *
 * Two complaints produced this shape, in order: the car swung too far
 * left and right, and then — after the first fix — it stopped feeling
 * connected at all. The second was caused by the first: a speed falloff
 * added here multiplied with the one `ChassisParams` already applies, so
 * a half-travel input at racing speed reached the road wheels as a
 * fraction of a degree.
 *
 * So the rule these guard is that this function shapes *resolution* and
 * nothing else. Speed sensitivity belongs to the car, is applied once,
 * and must not reappear here.
 */
import { describe, expect, it } from 'vitest';

import { shapeSteer } from '../src/input/controls';

const FEEL = { steerExpo: 1.6, steerSensitivity: 0.88 };
const LINEAR = { steerExpo: 1, steerSensitivity: 1 };

describe('shapeSteer', () => {
  it('passes a linear setting straight through', () => {
    for (const v of [0, 0.25, 0.5, 1]) {
      expect(shapeSteer(v, LINEAR)).toBeCloseTo(v, 9);
    }
  });

  it('keeps centre at centre and reaches full travel at the stop', () => {
    expect(shapeSteer(0, FEEL)).toBe(0);
    expect(shapeSteer(1, FEEL)).toBeCloseTo(FEEL.steerSensitivity, 9);
  });

  it('is odd — the two directions behave identically', () => {
    for (const v of [0.15, 0.4, 0.75, 1]) {
      expect(shapeSteer(-v, FEEL)).toBeCloseTo(-shapeSteer(v, FEEL), 12);
    }
  });

  it('gives finer control near centre than linear', () => {
    // Half travel produces well under half lock, which is the point of
    // the curve — but not so little that the car stops responding.
    const half = shapeSteer(0.5, FEEL) / FEEL.steerSensitivity;
    expect(half).toBeLessThan(0.45);
    expect(half).toBeGreaterThan(0.25);
  });

  it('rises monotonically, so more travel is never less steering', () => {
    let previous = -1;
    for (let v = 0; v <= 1.0001; v += 0.05) {
      const out = shapeSteer(v, FEEL);
      expect(out).toBeGreaterThan(previous);
      previous = out;
    }
  });

  it('does not depend on speed — the car owns that, and owns it once', () => {
    // Regression guard for the stacked-falloff bug. This function takes
    // no speed argument by design; if one is ever reintroduced, the
    // chassis' own reduction will multiply with it again.
    expect(shapeSteer.length).toBe(2);
  });

  it('never exceeds full lock, whatever it is handed', () => {
    for (const v of [1, 1.5, -2, 4]) {
      expect(Math.abs(shapeSteer(v, FEEL))).toBeLessThanOrEqual(1 + 1e-9);
    }
  });

  it('honours sensitivity as a plain scale on the result', () => {
    const full = shapeSteer(0.6, { steerExpo: 1.6, steerSensitivity: 1 });
    const half = shapeSteer(0.6, { steerExpo: 1.6, steerSensitivity: 0.5 });
    expect(half).toBeCloseTo(full * 0.5, 9);
  });
});
