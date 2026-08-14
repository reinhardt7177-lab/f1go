import { beforeAll, describe, expect, it } from 'vitest';

import { KMH } from '../src/core/math';
import { groundEffect, solveAero, terminalSpeed } from '../src/sim/aero';
import { gearRatio, initialDrivetrainState, peakPower, stepDrivetrain } from '../src/sim/drivetrain';
import { defaultVehicleParams } from '../src/sim/vehicle';
import { neutralControls } from '../src/sim/types';
import { initPhysics } from '../src/sim/world';

const params = defaultVehicleParams();
const power = peakPower(params.drivetrain);

describe('top speed', () => {
  it('is drag-limited near the real record in straight mode', () => {
    // Bottas's 372.5 km/h at Mexico 2016 is the outright race record, and
    // that was at 2,240 m where the air is thin. A sea-level car in its
    // low-drag setting belongs just under it.
    const straight = terminalSpeed(params.aero, power.watts, 'straight') * KMH;
    expect(straight).toBeGreaterThan(355);
    expect(straight).toBeLessThan(385);
  });

  it('is meaningfully slower with the wings in corner setting', () => {
    const corner = terminalSpeed(params.aero, power.watts, 'corner') * KMH;
    const straight = terminalSpeed(params.aero, power.watts, 'straight') * KMH;

    expect(corner).toBeLessThan(straight);
    // The whole point of active aero is that this gap is worth having.
    expect(straight - corner).toBeGreaterThan(20);
    expect(straight - corner).toBeLessThan(70);
  });

  it('is geared to reach the drag limit and not much past it', () => {
    // Top gear should run out just above the drag-limited speed. Shorter
    // and the car sits on the limiter with speed still available; taller
    // and the gear is one the engine can never pull.
    const p = params.drivetrain;
    const ratio = gearRatio(p, p.gearRatios.length);
    const limiterOmega = (p.redlineRpm * 2 * Math.PI) / 60;
    const geared = (limiterOmega / ratio) * params.chassis.wheelRadius * KMH;
    const dragLimited = terminalSpeed(params.aero, power.watts, 'straight') * KMH;

    expect(geared).toBeGreaterThan(dragLimited);
    expect(geared).toBeLessThan(dragLimited * 1.08);
  });
});

describe('active aerodynamics', () => {
  const at = (speed: number, mode: 'corner' | 'straight') =>
    solveAero(params.aero, speed, mode, params.aero.optimalRideHeight, params.aero.optimalRideHeight);

  it('trades downforce for drag in straight mode', () => {
    const corner = at(80, 'corner');
    const straight = at(80, 'straight');

    expect(straight.drag).toBeLessThan(corner.drag);
    expect(straight.downforce).toBeLessThan(corner.downforce);
  });

  it('gives up more downforce than drag, which is the decision', () => {
    const corner = at(80, 'corner');
    const straight = at(80, 'straight');

    const dragSaved = 1 - straight.drag / corner.drag;
    const downforceLost = 1 - straight.downforce / corner.downforce;
    expect(downforceLost).toBeGreaterThan(dragSaved);
  });

  it('carries no proximity condition — it is not DRS', () => {
    // Nothing in the aero signature can express "within a second of the
    // car ahead", and that is the point: under the 2026 rules every car
    // may use either wing setting whenever it likes.
    expect(solveAero.length).toBeLessThanOrEqual(5);
    const alone = at(80, 'straight');
    expect(alone.drag).toBeLessThan(at(80, 'corner').drag);
  });

  it('still responds to ride height in both settings', () => {
    const low = solveAero(params.aero, 80, 'straight', params.aero.optimalRideHeight, params.aero.optimalRideHeight);
    const high = solveAero(params.aero, 80, 'straight', 0.2, 0.2);
    expect(low.downforce).toBeGreaterThan(high.downforce);
    expect(groundEffect(params.aero, params.aero.optimalRideHeight)).toBeGreaterThan(1);
  });
});

describe('Overtake Mode', () => {
  beforeAll(async () => {
    await initPhysics();
  });

  const p = params.drivetrain;
  const DT = 1 / 120;

  // A wheel speed that puts the engine mid-range rather than on the
  // limiter, where torque is cut and the comparison would be meaningless.
  const DRIVEN_OMEGA = 57;

  const deploy = (seconds: number, requested: boolean, state = initialDrivetrainState(p)) => {
    let torque: [number, number] = [0, 0];
    for (let i = 0; i < seconds / DT; i++) {
      torque = stepDrivetrain(p, state, DT, 1, false, false, requested, [DRIVEN_OMEGA, DRIVEN_OMEGA]);
    }
    return { state, torque };
  };

  it('adds power when deployed', () => {
    const off = deploy(0.5, false).torque[0] + deploy(0.5, false).torque[1];
    const on = deploy(0.5, true).torque[0] + deploy(0.5, true).torque[1];
    expect(on).toBeGreaterThan(off);
  });

  it('releases a fixed slug of energy, not an open tap', () => {
    // DRS lasted as long as you held it. This does not: one press is
    // half a megajoule and then it is gone.
    const { state } = deploy(30, true);
    expect(state.overtakeRemaining).toBe(0);
    expect(state.overtakeDeploying).toBe(false);

    const used = p.ersCapacity - state.ersStore;
    expect(used).toBeCloseTo(p.overtakeEnergyPerUse, -3);
  });

  it('needs the button released before it can be armed again', () => {
    const state = initialDrivetrainState(p);
    // Hold it down through one full slug and well past.
    for (let i = 0; i < 30 / DT; i++) stepDrivetrain(p, state, DT, 1, false, false, true, [DRIVEN_OMEGA, DRIVEN_OMEGA]);
    const afterFirst = p.ersCapacity - state.ersStore;

    for (let i = 0; i < 10 / DT; i++) stepDrivetrain(p, state, DT, 1, false, false, true, [DRIVEN_OMEGA, DRIVEN_OMEGA]);
    expect(p.ersCapacity - state.ersStore).toBeCloseTo(afterFirst, -3);

    // Release, press again: a second slug.
    stepDrivetrain(p, state, DT, 1, false, false, false, [DRIVEN_OMEGA, DRIVEN_OMEGA]);
    for (let i = 0; i < 30 / DT; i++) stepDrivetrain(p, state, DT, 1, false, false, true, [DRIVEN_OMEGA, DRIVEN_OMEGA]);
    expect(p.ersCapacity - state.ersStore).toBeGreaterThan(afterFirst * 1.8);
  });

  it('does nothing off the throttle', () => {
    const state = initialDrivetrainState(p);
    for (let i = 0; i < 2 / DT; i++) stepDrivetrain(p, state, DT, 0, false, false, true, [DRIVEN_OMEGA, DRIVEN_OMEGA]);
    expect(state.overtakeDeploying).toBe(false);
    expect(state.ersStore).toBe(p.ersCapacity);
  });
});

describe('controls', () => {
  it('no longer carries DRS or a raw ERS flag', () => {
    const c = neutralControls();
    expect('straightMode' in c).toBe(true);
    expect('overtake' in c).toBe(true);
    expect('drs' in c).toBe(false);
    expect('ers' in c).toBe(false);
  });
});
