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
import { driverAids, initialAssistState, sideslipOf, stabilityTorque } from '../src/sim/assists';
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
  /**
   * Get the car rolling in a straight line.
   *
   * Upshifts are driven by road speed rather than a tick counter, the
   * same way `vehicle.test.ts` does it and for the same reason: shifting
   * on a timer runs the car into eighth at walking pace, where it cannot
   * pull and simply rolls backwards. A backwards car reads as 180
   * degrees of sideslip, which looks exactly like a spin and is not one.
   */
  const rollUp = (world: SimWorld, assist: AssistState, target: number): number => {
    for (let i = 0; i < 3600; i++) {
      const state = world.car.getState();
      const kmh = Math.abs(state.speed) * KMH;
      if (kmh > target) break;

      const wantShift = kmh > world.car.drivetrain.gear * 42;
      const eased = driverAids({ ...neutralControls(), throttle: 0.8 }, state, assist, DT);
      world.car.stabilityTorque = stabilityTorque(
        sideslipOf(state), state.angularVelocity.y, state.speed
      );
      world.car.controls = { ...eased, shiftUp: wantShift };
      world.step(DT);
    }
    return Math.abs(world.car.getState().speed) * KMH;
  };

  /**
   * Full lock and full throttle, held — exactly what a ten-year-old
   * does, and exactly the complaint that started this. Returns the worst
   * sideslip reached in ten seconds.
   */
  const worstSlide = (easy: boolean): number => {
    const world = testWorld();
    if (easy) {
      world.car.gripBoost = 1.25;
      world.car.tireStartTemp = defaultThermalParams().optimalTemp;
      world.car.fitFreshTires();
    }
    const assist = initialAssistState();

    const entry = rollUp(world, assist, 110);
    // If the car never got up to speed the rest measures nothing.
    expect(entry).toBeGreaterThan(100);

    let worst = 0;
    const asked: ControlState = { ...neutralControls(), throttle: 1, steer: 1 };
    for (let i = 0; i < 1200; i++) {
      const state = world.car.getState();
      world.car.controls = easy ? driverAids(asked, state, assist, DT) : asked;
      world.car.stabilityTorque = easy
        ? stabilityTorque(sideslipOf(state), state.angularVelocity.y, state.speed)
        : 0;
      world.step(DT);
      worst = Math.max(worst, Math.abs(sideslipOf(world.car.getState())));
    }
    world.dispose();
    return worst;
  };

  it('spins the unassisted car', () => {
    // The baseline has to be a spin, or the test below proves nothing.
    expect(worstSlide(false)).toBeGreaterThan(45 * DEG);
  });

  it('does not spin the assisted one', () => {
    expect(worstSlide(true)).toBeLessThan(45 * DEG);
  });
});
