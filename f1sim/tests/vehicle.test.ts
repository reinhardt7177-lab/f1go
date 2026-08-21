/**
 * Whole-vehicle behaviour, stepped headlessly.
 *
 * These are the tests that only exist because `sim/` has no rendering
 * dependency: the same code that runs in the browser runs here in node,
 * with no canvas and no WebGL.
 */
import { beforeAll, describe, expect, it } from 'vitest';

import { KMH, RAD } from '../src/core/math';
import { initialAssistState, tractionControl } from '../src/sim/assists';
import type { AssistState } from '../src/sim/assists';
import { RL, RR, neutralControls } from '../src/sim/types';
import type { ControlState } from '../src/sim/types';
import { defaultChassisParams, defaultVehicleParams } from '../src/sim/vehicle';
import { defaultSuspensionParams } from '../src/sim/suspension';
import { SimWorld, defaultBarrier, initPhysics } from '../src/sim/world';

const DT = 1 / 120;

/**
 * Every test here runs on the proving ground: flat, uniform tarmac, wide
 * enough to slide on. A braking-distance or grip measurement taken on a
 * real circuit would be measuring the circuit.
 */
const testWorld = (): SimWorld => new SimWorld(defaultVehicleParams(), { circuitId: 'proving' });

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
  world = testWorld(),
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
      Math.abs(state.wheels[RL].slipRatio),
      Math.abs(state.wheels[RR].slipRatio)
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
    const world = testWorld();
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
    const world = testWorld();
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
    const world = testWorld();
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
    const world = testWorld();
    drive(5, { throttle: 1 }, world);
    drive(2.5, { throttle: 0.45, steer: 0.5 }, world);

    const state = world.car.getState();
    expect(Math.abs(state.gLat)).toBeGreaterThan(0.4);

    // Yawing about the vertical axis is what turning actually is.
    expect(Math.abs(state.angularVelocity.y)).toBeGreaterThan(0.05);
    world.dispose();
  });

  it('builds slip angle at the front when steered', () => {
    const world = testWorld();
    drive(5, { throttle: 1 }, world);
    drive(1.2, { throttle: 0.4, steer: 0.5 }, world);

    const [fl, fr] = world.car.getState().wheels;
    expect(Math.abs(fl.slipAngle) + Math.abs(fr.slipAngle)).toBeGreaterThan(0.005);
    world.dispose();
  });
});

describe('energy', () => {
  it('does not gain energy when dropped onto the road', () => {
    // The suspension is the one place the integrator can create energy:
    // a bump stop stiff enough to be unstable at the simulation rate
    // adds a little on every contact, and a car that lands hard is then
    // fired into the sky. This is the cheapest possible detector.
    const world = testWorld();
    const start = world.car.body.translation();
    const startY = start.y;
    const dropHeight = 3;

    world.car.body.setTranslation({ x: start.x, y: startY + dropHeight, z: start.z }, true);
    world.car.body.setLinvel({ x: 0, y: 0, z: 0 }, true);

    let highestAfterLanding = -Infinity;
    let landed = false;

    for (let i = 0; i < 120 * 6; i++) {
      world.step(DT);
      const y = world.car.body.translation().y;
      if (!landed && world.car.getState().wheels.some((w) => w.grounded)) landed = true;
      if (landed) highestAfterLanding = Math.max(highestAfterLanding, y);
    }

    // A real landing dissipates energy: the rebound must be well under
    // the drop, and the car must end up back on the road.
    expect(highestAfterLanding).toBeLessThan(startY + dropHeight);
    expect(Math.abs(world.car.body.translation().y - startY)).toBeLessThan(1);
    expect(Math.abs(world.car.body.linvel().y)).toBeLessThan(5);
    world.dispose();
  });

  it('is not thrown into the air by running wide at a corner', () => {
    /* The bug this test exists for.
     *
     * The collision box used to sit 60 mm above the road at the static
     * ride height while the suspension had 80 mm of travel, so at full
     * bump it was already inside the track mesh and any lean at all
     * buried a corner of it. The solver's answer to a 798 kg box
     * overlapping a static triangle mesh is to push it out at whatever
     * speed that takes: arriving at the practice oval's banked corner
     * too fast and too far across threw the car upwards at 18 m/s.
     *
     * A metre either way along the road decided whether it happened,
     * which is why this sweeps six metres of one corner rather than
     * driving into it once — the trigger is a box corner meeting one
     * particular triangle edge, and a single start point walks straight
     * past it. The oval because it is the circuit the game opens on,
     * and because it is dead flat: nothing here can be mistaken for a
     * crest.
     *
     * The ceiling is the simulation's own. Four corners at
     * `MAX_CORNER_FORCE` lift this car at about 3.3 m/s per step, so a
     * step that gains more than that gained it somewhere unmodelled.
     */
    const world = new SimWorld(defaultVehicleParams(), { circuitId: 'oval' });
    world.barrier = defaultBarrier();

    let peak = 0;
    let jolt = 0;

    for (let n = 0; n < 30; n++) {
      const s = 2664 + n * 0.2;
      const slot = world.gridSlot(s);
      world.car.reset(slot.position, slot.heading);
      world.distance = s;

      /* Twenty degrees off the racing line at 300 km/h, pointed at the
         inside of the corner — too fast for it, which is how a player
         arrives at the edge of the road in the first place. */
      const sample = world.circuit.spline.sampleAt(s);
      const a = -20 * RAD;
      const v = 300 / KMH;
      world.car.body.setLinvel(
        {
          x: (sample.tangent.x * Math.cos(a) + sample.left.x * Math.sin(a)) * v,
          y: 0,
          z: (sample.tangent.z * Math.cos(a) + sample.left.z * Math.sin(a)) * v
        },
        true
      );

      let previous = 0;
      for (let i = 0; i < 240; i++) {
        world.car.controls = { ...neutralControls() };
        world.step(DT);
        const vy = world.car.body.linvel().y;
        peak = Math.max(peak, vy);
        jolt = Math.max(jolt, vy - previous);
        previous = vy;
      }
    }

    expect(jolt).toBeLessThan(3.3);
    expect(peak).toBeLessThan(3);
    world.dispose();
  });

  it('keeps speed bounded through a hard landing', () => {
    const world = testWorld();
    const start = world.car.body.translation();
    world.car.body.setTranslation({ x: start.x, y: start.y + 6, z: start.z }, true);

    let fastest = 0;
    for (let i = 0; i < 120 * 8; i++) {
      world.step(DT);
      const v = world.car.body.linvel();
      fastest = Math.max(fastest, Math.hypot(v.x, v.y, v.z));
    }

    // Free fall from six metres arrives at about 11 m/s. Anything much
    // beyond that came from the solver, not from gravity.
    expect(fastest).toBeLessThan(20);
    world.dispose();
  });
});

describe('the collision box', () => {
  /*
   * The box is a backstop, not a part of the car.
   *
   * The suspension is four raycasts, the wall is a force and the other
   * cars are circles — nothing on this circuit is resolved by the
   * contact solver except this one box against the track mesh. It is
   * there so a car that has ended up on its roof rests on something
   * instead of falling through the world, and it must never be what
   * the car is standing on while it is being driven. A 798 kg box
   * overlapping a static triangle mesh is pushed out at whatever speed
   * that takes, and that speed is not a number this simulation chose.
   */
  it('clears the road through the whole of suspension travel, leaning', () => {
    const c = defaultChassisParams();
    const s = defaultSuspensionParams();

    /* Height of the road under a wheel, relative to the CG: down the
       hardpoint, down the compressed spring, down the tyre. At full
       bump the spring is at its shortest, so this is the highest the
       road ever gets. */
    const road =
      c.hardpointY - (s.restLength - s.maxTravel) - c.wheelRadius;
    const underside = c.colliderOffsetY - c.halfExtents.y;

    expect(underside).toBeGreaterThan(road);

    /* And it has to survive being leaned on. The box is 1.8 m across,
       so a shallow angle is all it takes to put a corner of it into the
       road — the car runs three to seven degrees of roll through a
       corner, and the old box had none of this margin at all. */
    const lean = Math.asin((underside - road) / c.halfExtents.x) / RAD;
    expect(lean).toBeGreaterThan(5);
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
      const world = testWorld();
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
