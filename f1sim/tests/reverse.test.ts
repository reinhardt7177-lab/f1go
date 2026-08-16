/**
 * Reverse.
 *
 * A car that spins and stops facing the wrong way had no way out of it
 * except restarting the session, because the gearbox stopped at first.
 * The regulations require reverse for exactly this reason, and so does
 * anyone who has just put it in the grass.
 */
import { describe, expect, it } from 'vitest';
import {
  REVERSE,
  defaultDrivetrainParams,
  gearLabel,
  gearRatio,
  initialDrivetrainState,
  stepDrivetrain
} from '../src/sim/drivetrain';

const DT = 1 / 120;
const p = defaultDrivetrainParams();

/** Drop into reverse from first, at whatever wheel speed is given. */
const selectReverse = (omega: number) => {
  const s = initialDrivetrainState(p);
  stepDrivetrain(p, s, DT, 0, false, true, false, [omega, omega]);
  return s;
};

describe('reverse', () => {
  it('drives the wheels the other way', () => {
    const s = selectReverse(0);
    expect(s.gear).toBe(REVERSE);

    // Past the shift cut, so torque is actually being delivered.
    let torque: [number, number] = [0, 0];
    for (let i = 0; i < 0.5 / DT; i++) {
      torque = stepDrivetrain(p, s, DT, 1, false, false, false, [-1, -1]);
    }
    expect(torque[0] + torque[1]).toBeLessThan(0);
  });

  it('cannot be selected at speed', () => {
    // 60 rad/s is about 78 km/h on a 360mm tyre.
    const s = selectReverse(60);
    expect(s.gear).toBe(1);
  });

  it('is left again once the car has stopped', () => {
    const s = selectReverse(0);
    expect(s.gear).toBe(REVERSE);
    s.shiftTimer = 0;
    stepDrivetrain(p, s, DT, 0, true, false, false, [0, 0]);
    expect(s.gear).toBe(1);
  });

  it('will not let a downshift chain run into it at speed', () => {
    const s = initialDrivetrainState(p);
    s.gear = 3;
    for (let i = 0; i < 20; i++) {
      s.shiftTimer = 0;
      stepDrivetrain(p, s, DT, 0, false, true, false, [60, 60]);
    }
    expect(s.gear).toBe(1);
  });

  it('is geared shorter than first and limited well below the redline', () => {
    expect(Math.abs(gearRatio(p, REVERSE))).toBeGreaterThan(Math.abs(gearRatio(p, 1)));
    expect(p.reverseRpmLimit).toBeLessThan(p.redlineRpm);
  });

  it('reads as R on the dash', () => {
    expect(gearLabel(REVERSE)).toBe('R');
    expect(gearLabel(1)).toBe('1');
  });
});
