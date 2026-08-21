/**
 * The easy-mode aids.
 *
 * These are the reason a ten-year-old can drive the car, and they are
 * also the reason someone will eventually be tempted to simplify them.
 * Two of the tests below exist specifically to stop that: one pins the
 * sign gate in the steering limiter, and one pins the deadband in the
 * yaw assist. Both look like details and both are load-bearing.
 *
 * No physics engine here — every one of these is numbers in, numbers
 * out, which is the whole point of the assist layer being separate.
 */
import { describe, expect, it } from 'vitest';

import {
  arcadeReverse,
  defaultSteerLimiter,
  defaultYawAssist,
  driverAids,
  initialAssistState,
  sideslipOf,
  steerLimiter,
  yawAssist
} from '../src/sim/assists';
import { neutralControls } from '../src/sim/types';
import type { VehicleState, WheelTelemetry } from '../src/sim/types';
import { quatIdentity, vec3 } from '../src/core/math';

const DT = 1 / 120;
const DEG = Math.PI / 180;

describe('steering limiter', () => {
  it('leaves the wheel alone below the grip peak', () => {
    const state = initialAssistState();
    // Four degrees is a car working, not a car sliding.
    for (let i = 0; i < 120; i++) {
      expect(steerLimiter(1, -4 * DEG, state, DT)).toBe(1);
    }
    expect(state.steerLimit).toBe(1);
  });

  it('cuts when the front is asked for more slip than it can use', () => {
    const state = initialAssistState();
    /* Twelve degrees of slip against a right-hand steer. The sign is
       negative because steering right sends the contact patch to the
       left of where the wheel points — that opposition is what marks
       this as understeer rather than a save. */
    for (let i = 0; i < 60; i++) steerLimiter(1, -12 * DEG, state, DT);

    expect(state.steerLimit).toBeLessThan(1);
    expect(steerLimiter(1, -12 * DEG, state, DT)).toBeLessThan(1);
  });

  it('never takes away the countersteer', () => {
    const state = initialAssistState();
    /* Twenty degrees of front slip on the *same* side as the command:
       the driver is catching a slide, not overdriving the front. The
       ceiling must rise, not fall. If this ever fails, the assist has
       started fighting the driver at the one moment the wheel matters
       most. */
    for (let i = 0; i < 60; i++) steerLimiter(-1, -20 * DEG, state, DT);

    expect(state.steerLimit).toBe(1);
    expect(steerLimiter(-1, -20 * DEG, state, DT)).toBe(-1);
  });

  it('hands the lock back as the front comes under the peak', () => {
    const state = initialAssistState();
    for (let i = 0; i < 120; i++) steerLimiter(1, -14 * DEG, state, DT);
    const cut = state.steerLimit;
    expect(cut).toBeLessThan(1);

    for (let i = 0; i < 120; i++) steerLimiter(1, -3 * DEG, state, DT);
    expect(state.steerLimit).toBeGreaterThan(cut);
  });

  it('never cuts below the floor', () => {
    const state = initialAssistState();
    // Sustained, absurd understeer — a car ploughing straight on.
    for (let i = 0; i < 1200; i++) steerLimiter(1, -45 * DEG, state, DT);
    expect(state.steerLimit).toBe(defaultSteerLimiter().floor);
  });
});

describe('yaw assist', () => {
  it('does nothing at all inside the deadband', () => {
    /* Five degrees of sideslip is a car cornering at the limit, not a
       car sliding. The command has to come back bit for bit — this is
       the test that says the simulator underneath is intact. */
    const out = yawAssist(0.6, 0.8, 5 * DEG, 0.9, 60);
    expect(out.steer).toBe(0.6);
    expect(out.throttle).toBe(0.8);
    expect(out.authority).toBe(0);
  });

  it('does nothing at walking pace, where sideslip means nothing', () => {
    const out = yawAssist(0.6, 0.8, 40 * DEG, 2, 2);
    expect(out.steer).toBe(0.6);
    expect(out.throttle).toBe(0.8);
  });

  it('steers into the slide', () => {
    /* Tail out to the left: the car is travelling to the left of its
       own nose, so sideslip is negative and the correction is a left
       lock. The driver is still asking for right. */
    const out = yawAssist(1, 1, -20 * DEG, 1.5, 60);
    expect(out.steer).toBeLessThan(1);
    expect(out.authority).toBeGreaterThan(0);
  });

  it('steers harder into a slide that is still opening', () => {
    /* Sideslip and yaw rate share a sign while a slide develops — a
       car spinning right travels to the left of its own nose, so both
       are negative — and oppose once it is coming back. The lead term
       must therefore *add*. It used to subtract, which fed the slide
       while it grew and fought the correction while it was caught, and
       this test had the two cases the wrong way round and so agreed
       with it. If it ever inverts again, this fails. */
    const opening = yawAssist(0, 1, -20 * DEG, -1.5, 60);
    const catching = yawAssist(0, 1, -20 * DEG, 1.5, 60);
    expect(Math.abs(opening.steer)).toBeGreaterThan(Math.abs(catching.steer));
  });

  it('trims the throttle in proportion to the slide', () => {
    // Both inside the ramp, which now reaches full authority at 11.5
    // degrees rather than twenty.
    const small = yawAssist(0, 1, 8 * DEG, 0, 60);
    const large = yawAssist(0, 1, 10 * DEG, 0, 60);
    expect(small.throttle).toBeLessThan(1);
    expect(large.throttle).toBeLessThan(small.throttle);

    // Never to zero: a car with no drive cannot leave a spin either.
    const full = yawAssist(0, 1, 90 * DEG, 0, 60);
    const p = defaultYawAssist();
    expect(full.throttle).toBeCloseTo(1 - p.throttleTrim * p.maxAuthority, 6);
  });

  it('never takes more than its share of the command', () => {
    const p = defaultYawAssist();
    const out = yawAssist(1, 1, 90 * DEG, 0, 60);
    expect(out.authority).toBeCloseTo(p.maxAuthority, 6);
    // Blended, not overridden — the driver keeps 30 per cent of the wheel.
    expect(out.steer).toBeGreaterThan(-1);
  });
});

/** A stationary car with everything neutral, for the composed tests. */
const restingState = (over: Partial<VehicleState> = {}): VehicleState => {
  const wheel = (): WheelTelemetry => ({
    load: 2000,
    compression: 0.03,
    slipAngle: 0,
    slipRatio: 0,
    forceLong: 0,
    forceLat: 0,
    gripUsage: 0,
    omega: 0,
    grounded: true,
    surfaceTemp: 90,
    coreTemp: 90,
    wear: 0,
    gripScale: 1,
    surfaceGrip: 1
  });
  return {
    position: vec3(),
    rotation: quatIdentity(),
    velocity: vec3(),
    angularVelocity: vec3(),
    speed: 0,
    engineRpm: 4000,
    gear: 1,
    wheels: [wheel(), wheel(), wheel(), wheel()],
    steerAngles: [0, 0, 0, 0],
    wheelSpin: [0, 0, 0, 0],
    downforce: 0,
    drag: 0,
    rideHeightFront: 0.07,
    rideHeightRear: 0.07,
    groundEffectFront: 1,
    groundEffectRear: 1,
    gLong: 0,
    gLat: 0,
    aeroMode: 'corner',
    overtakeCharge: 0,
    overtakeDeploying: false,
    ...over
  };
};

describe('sideslip', () => {
  it('is zero when the car goes where it points', () => {
    const state = restingState({ velocity: vec3(0, 0, -40), speed: 40 });
    expect(sideslipOf(state)).toBeCloseTo(0, 9);
  });

  it('is positive when the car travels right of its nose', () => {
    const state = restingState({ velocity: vec3(10, 0, -40), speed: 41 });
    expect(sideslipOf(state)).toBeGreaterThan(0);
  });
});

describe('the aids together', () => {
  it('never eats the throttle ceiling at a standstill', () => {
    /* The bug this encodes: a car stopped on the grass spins its wheels
       at any throttle, so the ceiling decays to its floor and the car
       can never pull away. `ai/driver.ts` has guarded against it for a
       while; the player's path did not. Three hundred ticks of full
       throttle against a wildly spinning rear must leave the ceiling
       untouched. */
    const assist = initialAssistState();
    const wheels = restingState().wheels;
    wheels[2].slipRatio = 3;
    wheels[3].slipRatio = 3;
    const state = restingState({ speed: 0.5, wheels });

    for (let i = 0; i < 300; i++) {
      const out = driverAids({ ...neutralControls(), throttle: 1 }, state, assist, DT);
      expect(out.throttle).toBe(1);
    }
    expect(assist.throttleLimit).toBe(1);
  });

  it('passes a tidy car through untouched', () => {
    /* Rolling straight, no slip anywhere: easy mode must be invisible.
       If this drifts, the aids have started shaping ordinary driving
       rather than catching mistakes. */
    const assist = initialAssistState();
    const state = restingState({ velocity: vec3(0, 0, -50), speed: 50 });
    const asked = { ...neutralControls(), throttle: 0.5, steer: 0.2 };

    const out = driverAids(asked, state, assist, DT);
    expect(out.throttle).toBe(0.5);
    expect(out.steer).toBe(0.2);
  });
});

describe('arcade reverse', () => {
  const asked = (over: Partial<typeof base> = {}) => ({ ...base, ...over });
  const base = { ...neutralControls() };

  it('is an ordinary brake while the car is moving', () => {
    const out = arcadeReverse(asked({ brake: 1 }), 3, 20);
    expect(out.brake).toBe(1);
    expect(out.shiftDown).toBe(false);
  });

  it('asks for reverse when the key is still held at a standstill', () => {
    /* The car has a reverse gear and it works — but reaching it means
       holding the downshift paddle through neutral, which nobody who
       has not read the controls will ever find. Holding the back key is
       what every game they have played does. */
    const out = arcadeReverse(asked({ brake: 1 }), 1, 0.2);
    expect(out.shiftDown).toBe(true);
    expect(out.brake).toBe(0);
  });

  it('does not ask for it while the throttle is also down', () => {
    // Both keys held is a driver holding the car on the brakes, not a
    // driver asking to go backwards.
    const out = arcadeReverse(asked({ brake: 1, throttle: 1 }), 1, 0.2);
    expect(out.shiftDown).toBe(false);
  });

  it('makes the back key the accelerator once reverse is engaged', () => {
    const out = arcadeReverse(asked({ brake: 1 }), 0, -3);
    expect(out.throttle).toBe(1);
    expect(out.brake).toBe(0);
  });

  it('makes the forward key the brake while reversing', () => {
    const out = arcadeReverse(asked({ throttle: 1 }), 0, -6);
    expect(out.brake).toBe(1);
    expect(out.throttle).toBe(0);
  });

  it('goes back to first once the reversing car has stopped', () => {
    /* One press to stop, and the same press to set off again — which is
       what makes it feel like a car rather than a gearbox. */
    const out = arcadeReverse(asked({ throttle: 1 }), 0, -0.3);
    expect(out.shiftUp).toBe(true);
    expect(out.brake).toBe(0);
  });
});
