/**
 * Easy mode, measured on the whole car.
 *
 * `assists.test.ts` checks the loops in isolation. This checks the two
 * claims that can only be made about a car actually driving: that the
 * dials are inert at their defaults, and that with them turned up the
 * thing a child does — hold the key down and keep it down — no longer
 * ends in a spin.
 */
import { beforeAll, describe, expect, it } from 'vitest';

import { KMH } from '../src/core/math';
import { driverAids, initialAssistState, sideslipOf } from '../src/sim/assists';
import type { AssistState } from '../src/sim/assists';
import { neutralControls } from '../src/sim/types';
import type { ControlState } from '../src/sim/types';
import { defaultVehicleParams } from '../src/sim/vehicle';
import { SimWorld, initPhysics } from '../src/sim/world';
import { conditionGrip, defaultThermalParams } from '../src/sim/tire';

const DT = 1 / 120;
const DEG = Math.PI / 180;

/** Flat, uniform, and wide enough to slide about on. */
const testWorld = (): SimWorld =>
  new SimWorld(defaultVehicleParams(), { circuitId: 'proving' });

beforeAll(async () => {
  await initPhysics();
});

describe('the dials at their defaults', () => {
  it('is the simulator, bit for bit', () => {
    /* The sharpest instrument available: `gripBoost` multiplies, and
       `x * 1.0` is exact in IEEE-754, so an untouched car must produce
       an *identical* hash rather than a close one. If this ever fails,
       something other than the multiplication changed. */
    const run = (): number => {
      const world = testWorld();
      const controls: ControlState = { ...neutralControls(), throttle: 0.6, steer: 0.3 };
      for (let i = 0; i < 360; i++) {
        world.car.controls = controls;
        world.step(DT);
      }
      const hash = world.stateHash();
      world.dispose();
      return hash;
    };

    expect(run()).toBe(run());
  });
});

describe('grip boost', () => {
  it('stops the car sooner', () => {
    const stoppingDistance = (boost: number): number => {
      const world = testWorld();
      world.car.gripBoost = boost;

      // Up to speed first, gently, so the measurement is of braking.
      for (let i = 0; i < 600; i++) {
        world.car.controls = { ...neutralControls(), throttle: 0.7, shiftUp: i % 90 === 0 };
        world.step(DT);
      }

      const from = world.car.body.translation();
      let ticks = 0;
      while (Math.abs(world.car.getState().speed) > 10 && ticks < 2400) {
        world.car.controls = { ...neutralControls(), brake: 1 };
        world.step(DT);
        ticks++;
      }
      const to = world.car.body.translation();
      world.dispose();
      return Math.hypot(to.x - from.x, to.z - from.z);
    };

    expect(stoppingDistance(1.25)).toBeLessThan(stoppingDistance(1));
  });
});

describe('the thermal model on the grid', () => {
  const heldFor = (seconds: number, frozen: boolean): number => {
    const world = testWorld();
    world.car.thermalFrozen = frozen;
    for (let i = 0; i < Math.round(seconds / DT); i++) {
      world.car.holdStationary();
      world.car.controls = neutralControls();
      world.step(DT);
    }
    const temp = world.car.getState().wheels[0].surfaceTemp;
    world.dispose();
    return temp;
  };

  it('cools a held car when it is running', () => {
    /* The bug, stated as a measurement. A minute on the title card at
       roughly 0.4 degrees a second takes a fresh 75-degree tyre well
       down towards the 62 the core will hold it at. */
    const after = heldFor(60, false);
    expect(after).toBeLessThan(70);
  });

  it('leaves a held car alone when it is frozen', () => {
    const before = defaultThermalParams().optimalTemp - defaultThermalParams().tempWindow;
    expect(heldFor(60, true)).toBeCloseTo(before, 6);
  });

  it('fits tyres at the optimum when asked', () => {
    const world = testWorld();
    const thermal = defaultThermalParams();
    world.car.tireStartTemp = thermal.optimalTemp;
    world.car.fitFreshTires();
    // Telemetry is filled in by a step, so one is needed before reading.
    world.car.thermalFrozen = true;
    world.car.controls = neutralControls();
    world.step(DT);

    // Exactly in the window: no out-lap, and every respawn returns the
    // player to a car that works.
    const [fl] = world.car.getState().wheels;
    expect(fl.surfaceTemp).toBeCloseTo(thermal.optimalTemp, 6);
    expect(conditionGrip(thermal, { surfaceTemp: thermal.optimalTemp, coreTemp: thermal.optimalTemp, wear: 0 })).toBeCloseTo(1, 6);
    world.dispose();
  });
});

describe('a child holding the keys down', () => {
  /*
   * Full lock and full throttle, held, from a rolling start — exactly
   * what a ten-year-old does and exactly the complaint that started
   * this.
   *
   * On the proving ground rather than a circuit, and that is a
   * deliberate retreat from an earlier version of this test. Pinning
   * the car to one named corner meant first driving it there, and every
   * way of doing that measured something else: steering straight put
   * the car three hundred metres into a field before the corner
   * arrived, and handing the job to the autopilot made the test depend
   * on the autopilot. The pad has no corner to leave and no barrier to
   * hit, so what is left in the numbers is the car and the aids.
   *
   * What was wrong before was not the venue but the bar. The old
   * threshold was 45 degrees of sideslip, and a car at 44 has spun. The
   * measured failure reached 78 and lost four fifths of its speed;
   * both of those are now asserted against.
   */
  const rollUp = (world: SimWorld, assist: AssistState, target: number): number => {
    for (let i = 0; i < 3600; i++) {
      const state = world.car.getState();
      const kmh = Math.abs(state.speed) * KMH;
      if (kmh > target) break;

      const eased = driverAids({ ...neutralControls(), throttle: 0.8 }, state, assist, DT);
      world.car.stabilityTorque = assist.stabilityTorque;
      world.car.controls = { ...eased, shiftUp: kmh > world.car.drivetrain.gear * 42 };
      world.step(DT);
    }
    return Math.abs(world.car.getState().speed) * KMH;
  };

  interface Run { entry: number; peak: number; lateMean: number; minSpeed: number }

  const heldAtFullLock = (easy: boolean): Run => {
    const world = testWorld();
    if (easy) {
      world.car.gripBoost = 1.25;
      world.car.tireStartTemp = defaultThermalParams().optimalTemp;
      world.car.fitFreshTires();
    }
    const assist = initialAssistState();

    const entry = rollUp(world, assist, 130);
    expect(entry).toBeGreaterThan(120);

    let peak = 0;
    let minSpeed = Infinity;
    const late: number[] = [];
    const asked: ControlState = { ...neutralControls(), throttle: 1, steer: 1 };

    for (let i = 0; i < 1200; i++) {
      const state = world.car.getState();
      world.car.controls = easy ? driverAids(asked, state, assist, DT) : asked;
      world.car.stabilityTorque = easy ? assist.stabilityTorque : 0;
      world.step(DT);

      const after = world.car.getState();
      const slip = Math.abs(sideslipOf(after));
      peak = Math.max(peak, slip);
      minSpeed = Math.min(minSpeed, Math.abs(after.speed) * KMH);
      // The last five seconds: one transient is not a slide.
      if (i > 600) late.push(slip);
    }

    world.dispose();
    return {
      entry,
      peak,
      lateMean: late.reduce((a, b) => a + b, 0) / late.length,
      minSpeed
    };
  };

  it('spins the unassisted car and takes its speed', () => {
    // The control. Without this the assertions below prove nothing.
    const plain = heldAtFullLock(false);
    expect(plain.peak).toBeGreaterThan(45 * DEG);
    expect(plain.minSpeed).toBeLessThan(0.4 * plain.entry);
  });

  it('keeps the assisted car pointing where it is going', () => {
    const eased = heldAtFullLock(true);
    /* Full authority arrives at 11.5 degrees by design, so 20 is the
       catch plus its transient — and still comfortably under the 45
       that used to pass. It is also well above the 6.6 degrees a car
       cornering at the limit legitimately runs, so a merely fast lap
       can never fail this. */
    expect(eased.peak).toBeLessThan(20 * DEG);
    // And caught, not merely bounded: ten seconds of yaw is a slide.
    expect(eased.lateMean).toBeLessThan(10 * DEG);
  });

  it('and keeps most of its speed while it does', () => {
    // The measured failure scrubbed 130 km/h to 25 — under a fifth.
    const eased = heldAtFullLock(true);
    expect(eased.minSpeed).toBeGreaterThan(0.5 * eased.entry);
  });
});

describe('driving properly', () => {
  it('is invisible in a straight line', () => {
    /*
     * The test that protects the simulator underneath, stated where it
     * can be stated exactly: rolling straight at speed, the target yaw
     * rate is zero, the excess is zero, and every aid must hand the
     * command back bit for bit.
     *
     * If any of the three mechanisms ever starts shaping honest driving
     * rather than catching mistakes, this fails on the first tick.
     */
    const world = testWorld();
    world.car.gripBoost = 1.25;
    const assist = initialAssistState();

    for (let i = 0; i < 1800; i++) {
      const state = world.car.getState();
      const kmh = Math.abs(state.speed) * KMH;
      if (kmh > 120) break;
      const eased = driverAids({ ...neutralControls(), throttle: 0.8 }, state, assist, DT);
      world.car.stabilityTorque = assist.stabilityTorque;
      world.car.controls = { ...eased, shiftUp: kmh > world.car.drivetrain.gear * 42 };
      world.step(DT);
    }

    const asked: ControlState = { ...neutralControls(), throttle: 0.4 };
    for (let i = 0; i < 240; i++) {
      const state = world.car.getState();
      const out = driverAids(asked, state, assist, DT);
      expect(out.steer).toBe(0);
      expect(out.throttle).toBe(0.4);
      expect(assist.stabilityTorque).toBe(0);
      world.car.controls = out;
      world.step(DT);
    }
    world.dispose();
  });
});
