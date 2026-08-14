/**
 * Steering feel.
 *
 * The complaint these guard against is a car that swings too far left
 * and right for the input given. The fix is a reshaping, not a cap, so
 * what matters is that the ends of the range survive while the middle
 * gets finer — a plain reduction would have made full lock unreachable
 * and turned understeer into the new complaint.
 */
import { describe, expect, it } from 'vitest';

import { shapeSteer } from '../src/input/controls';

const OPTIONS = { steerExpo: 2.2, steerHighSpeed: 0.34, steerFalloffSpeed: 220 };

describe('shapeSteer', () => {
  it('leaves centre and the stops where they are at low speed', () => {
    expect(shapeSteer(0, 0, OPTIONS)).toBe(0);
    expect(shapeSteer(1, 0, OPTIONS)).toBeCloseTo(1, 6);
    expect(shapeSteer(-1, 0, OPTIONS)).toBeCloseTo(-1, 6);
  });

  it('is odd — the two directions behave identically', () => {
    for (const v of [0.15, 0.4, 0.75, 1]) {
      expect(shapeSteer(-v, 90, OPTIONS)).toBeCloseTo(-shapeSteer(v, 90, OPTIONS), 12);
    }
  });

  it('gives finer control near centre than a linear input would', () => {
    // Half travel must produce well under half lock, or there is no
    // resolution gained where the driving actually happens.
    expect(shapeSteer(0.5, 0, OPTIONS)).toBeLessThan(0.3);
    expect(shapeSteer(0.25, 0, OPTIONS)).toBeLessThan(0.06);
  });

  it('rises monotonically, so more travel is never less steering', () => {
    let previous = -1;
    for (let v = 0; v <= 1.0001; v += 0.05) {
      const out = shapeSteer(v, 120, OPTIONS);
      expect(out).toBeGreaterThan(previous);
      previous = out;
    }
  });

  it('falls off with speed and then holds', () => {
    const still = shapeSteer(1, 0, OPTIONS);
    const fast = shapeSteer(1, 220, OPTIONS);
    const faster = shapeSteer(1, 340, OPTIONS);

    expect(fast).toBeLessThan(still);
    expect(fast).toBeCloseTo(OPTIONS.steerHighSpeed, 6);
    // Clamped: beyond the falloff speed it must not keep shrinking
    // towards zero, or the car would become unsteerable on a straight.
    expect(faster).toBeCloseTo(fast, 6);
  });

  it('never exceeds full lock, whatever it is handed', () => {
    for (const v of [1, 1.5, -2, 4]) {
      expect(Math.abs(shapeSteer(v, 0, OPTIONS))).toBeLessThanOrEqual(1 + 1e-9);
    }
  });
});
