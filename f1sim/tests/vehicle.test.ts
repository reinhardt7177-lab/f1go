/**
 * Whole-vehicle behaviour, stepped headlessly.
 *
 * These are the tests that only exist because `sim/` has no rendering
 * dependency: the same code that runs in the browser runs here in node,
 * with no canvas and no WebGL.
 */
import { beforeAll, describe, expect, it } from 'vitest';

import { KMH } from '../src/core/math';
import { initialAssistState, tractionControl } from '../src/sim/assists';
import type { AssistState } from '../src/sim/assists';
import { RL, RR, neutralControls } from '../src/sim/types';
import type { ControlState } from '../src/sim/types';
import { defaultVehicleParams } from '../src/sim/vehicle';
import { SimWorld, initPhysics } from '../src/sim/world';

const DT = 1 / 120;

beforeAll(async () => {
  await initPhysics();
});

/**
 * Run the car for `seconds` under a constant control input.
 *
 * Upshifts are driven by road speed rather than engine rpm on purpose:
 * during wheelspin the engine sits on the limiter while the car is barely
 * moving, and an rpm-triggered shift would run through all eight gears in
 * the first half second.
 */
const drive = (
  seconds: number,
  controls: Partial<ControlState>,
  world = new SimWorld(),
  assist: AssistState = initialAssistState()
): SimWorld => {
  const base: ControlState = { ...neutralControls(), ...controls };
  const steps = Math.round(seconds / DT);
  let armed = true;

  for (let i = 0; i < steps; i++) {
    const state = world.car.getState();
    const kmh = Math.abs(state.speed) * KMH;
    const wantShift = kmh > world.car.drivetrain.gear * 42;

    // Stand in for a driver's right foot. Without it, full throttle in
    // first gear is a burnout and the car spins — correct behaviour, but
    // it tells you nothing about the rest of the model.
    const drivenSlip = Math.max(
      Math.abs(state.wheels[RL]!.slipRatio),
      Math.abs(state.wheels[RR]!.slipRatio)
    );

    world.car.controls = {
      ...base,
      throttle: tractionControl(base.throttle, drivenSlip, assist, DT),
      shiftUp: wantShift && armed
    };
    armed = !wantShift;
    world.step(DT);
  }
  return world;
};

/** Fraction of the total vertical load carried by the front axle. */
const frontShare = (world: SimWorld): number => {
  const [fl, fr, rl, rr] = world.car.getState().wheels;
  const total = fl.load + fr.load + rl.load + rr.load;
  return total > 0 ? (fl.load + fr.load) / total : 0;
};

describe('settling', () => {
  it('comes to rest on its wheels without sinking or bouncing', () => {
    const world = drive(2, {});
    const y = world.car.body.translation().y;

    // Centre of mass should settle a little under the spawn height and
    // stay well clear of the road.
    expect(y).toBeGreaterThan(0.15);
    expect(y).toBeLessThan(0.6);

    const v = world.car.body.linvel();
    expect(Math.hypot(v.x, v.y, v.z)).toBeLessThan(0.15);

    const state = world.car.getState();
    for (const w of state.wheels) expect(w.grounded).toBe(true);
    world.dispose();
  });

  it('carries roughly the car weight across the four contact patches', () => {
    const world = drive(2, {});
    const state = world.car.getState();
    const total = state.wheels.reduce((sum, w) => sum + w.load, 0);
    const weight = defaultVehicleParams().chassis.mass * 9.81;

    expect(total).toBeGreaterThan(weight * 0.9);
    expect(total).toBeLessThan(weight * 1.1);
    world.dispose();
  });

  it('puts more static load on the rear axle, as the weight bias says', () => {
    const world = drive(2, {});
    const [fl, fr, rl, rr] = world.car.getState().wheels;
    const front = fl.load + fr.load;
    const rear = rl.load + rr.load;
    expect(rear).toBeGreaterThan(front);
    world.dispose();
  });
});

describe('longitudinal behaviour', () => {
  it('accelerates under throttle and reaches a sane speed', () => {
    const world = drive(6, { throttle: 1, shiftUp: false });
    const speed = world.car.getState().speed * KMH;
    // Still in a low gear after six seconds, but definitively moving.
    expect(speed).toBeGreaterThan(60);
    expect(speed).toBeLessThan(400);
    world.dispose();
  });

  it('transfers load to the rear under acceleration', () => {
    const world = drive(3, { throttle: 1 });
    const [fl, fr, rl, rr] = world.car.getState().wheels;
    expect(rl.load + rr.load).toBeGreaterThan(fl.load + fr.load);
    world.dispose();
  });

  it('transfers load to the front under braking', () => {
    const world = new SimWorld();
    drive(6, { throttle: 1 }, world);

    // Compare against coasting at the same sort of speed rather than
    // against the rear axle directly: aero balance is rear-biased, so the
    // rear can still carry the greater absolute load while braking. What
    // must change is the front's *share*.
    drive(0.3, {}, world);
    const coasting = frontShare(world);

    drive(0.5, { brake: 1 }, world);
    const braking = frontShare(world);

    expect(braking).toBeGreaterThan(coasting);
    expect(world.car.getState().gLong).toBeLessThan(0);
    world.dispose();
  });

  it('stops the car when the brakes are held', () => {
    const world = new SimWorld();
    drive(5, { throttle: 1 }, world);
    const moving = world.car.getState().speed;
    drive(6, { brake: 1 }, world);
    const stopped = world.car.getState().speed;

    expect(moving).toBeGreaterThan(10);
    expect(Math.abs(stopped)).toBeLessThan(Math.abs(moving) * 0.25);
    world.dispose();
  });
});

describe('aerodynamics', () => {
  it('generates downforce that grows with speed', () => {
    const world = new SimWorld();
    drive(2, { throttle: 1 }, world);
    const slow = world.car.getState().downforce;
    drive(6, { throttle: 1 }, world);
    const fast = world.car.getState().downforce;

    expect(fast).toBeGreaterThan(slow);
    world.dispose();
  });

  it('loads the tyres beyond static weight at speed', () => {
    const world = drive(9, { throttle: 1 });
    const state = world.car.getState();
    const total = state.wheels.reduce((sum, w) => sum + w.load, 0);
    const weight = defaultVehicleParams().chassis.mass * 9.81;

    // This is the whole point of an F1 car: at speed the tyres carry far
    // more than the car's own weight, so grip rises with speed.
    expect(total).toBeGreaterThan(weight * 1.15);
    world.dispose();
  });
});

describe('cornering', () => {
  it('turns and develops lateral acceleration', () => {
    const world = new SimWorld();
    drive(5, { throttle: 1 }, world);
    drive(2.5, { throttle: 0.45, steer: 1 }, world);

    const state = world.car.getState();
    expect(Math.abs(state.gLat)).toBeGreaterThan(0.4);

    // Yawing about the vertical axis is what turning actually is.
    expect(Math.abs(state.angularVelocity.y)).toBeGreaterThan(0.05);
    world.dispose();
  });

  it('builds slip angle at the front when steered', () => {
    const world = new SimWorld();
    drive(5, { throttle: 1 }, world);
    drive(1.2, { throttle: 0.4, steer: 1 }, world);

    const [fl, fr] = world.car.getState().wheels;
    expect(Math.abs(fl.slipAngle) + Math.abs(fr.slipAngle)).toBeGreaterThan(0.005);
    world.dispose();
  });
});

describe('determinism', () => {
  it('produces bit-identical state from identical inputs', () => {
    const script: Array<Partial<ControlState>> = [
      { throttle: 1 },
      { throttle: 1, steer: 0.6 },
      { brake: 1, steer: -0.4 },
      { throttle: 0.7, steer: 0.2 }
    ];

    const run = (): number[] => {
      const world = new SimWorld();
      const hashes: number[] = [];
      for (const controls of script) {
        world.car.controls = { ...neutralControls(), ...controls };
        for (let i = 0; i < 180; i++) world.step(DT);
        hashes.push(world.stateHash());
      }
      world.dispose();
      return hashes;
    };

    // A replay, a ghost lap and server-authoritative multiplayer all
    // depend on this holding.
    expect(run()).toEqual(run());
  });
});
