/**
 * The guardrail.
 *
 * A car that leaves the circuit used to keep going until it found the
 * catch floor eight metres below the lowest point of the track, which
 * for a ten-year-old is the end of the session. The wall they see is
 * drawn by `render/barrier.ts` and is deliberately not in the collider
 * — a thin wall in a trimesh is something a fast car goes through or
 * climbs, and one that stops a car dead flips it. This is the half that
 * actually keeps them in, and it works by leaning rather than blocking.
 */
import { beforeAll, describe, expect, it } from 'vitest';

import { defaultVehicleParams } from '../src/sim/vehicle';
import { SimWorld, defaultBarrier, initPhysics } from '../src/sim/world';
import { RL, RR, neutralControls } from '../src/sim/types';
import { initialAssistState, tractionControl } from '../src/sim/assists';
import { KMH } from '../src/core/math';

const DT = 1 / 120;

beforeAll(async () => {
  await initPhysics();
});

/**
 * Drive off the side of the circuit and report how far out the car got.
 *
 * On a real circuit rather than the proving ground: the pad is sixty
 * metres of tarmac wide, so a car at full lock simply drives round on
 * it and never reaches an edge to be held at.
 */
const strayed = (withBarrier: boolean): number => {
  const world = new SimWorld(defaultVehicleParams(), { circuitId: 'redbullring' });
  if (withBarrier) world.barrier = defaultBarrier();
  const assist = initialAssistState();

  /* Up to speed in a straight line first. Full lock from a standstill
     just spins the car on the spot, which never reaches an edge — the
     excursion this is about needs the car actually travelling. */
  for (let i = 0; i < 1800; i++) {
    const state = world.car.getState();
    const kmh = Math.abs(state.speed) * KMH;
    if (kmh > 140) break;
    const drivenSlip = Math.max(
      Math.abs(state.wheels[RL].slipRatio),
      Math.abs(state.wheels[RR].slipRatio)
    );
    world.car.controls = {
      ...neutralControls(),
      throttle: tractionControl(1, drivenSlip, assist, DT),
      shiftUp: kmh > world.car.drivetrain.gear * 42
    };
    world.step(DT);
  }

  let worst = 0;
  for (let i = 0; i < 1200; i++) {
    world.car.controls = { ...neutralControls(), throttle: 0.3, steer: 1 };
    world.step(DT);
    worst = Math.max(worst, Math.abs(world.lateral));
  }
  world.dispose();
  return worst;
};

describe('the boundary', () => {
  it('does nothing at all when there is none', () => {
    /* The default is null, which is why every other test in the suite
       is unaffected by any of this. */
    const world = new SimWorld(defaultVehicleParams(), { circuitId: 'redbullring' });
    expect(world.barrier).toBeNull();
    world.dispose();
  });

  it('keeps the car on the circuit', () => {
    const free = strayed(false);
    const held = strayed(true);

    // The unheld car has to actually leave, or the comparison is empty.
    expect(free).toBeGreaterThan(30);
    expect(held).toBeLessThan(free);
  });

  it('holds it near the edge rather than snatching it back', () => {
    /* What "soft" has to mean, stated as a number.
       The car must not get past the wall it can see. A spring alone let
       it nine metres into the grass at 140 km/h — drawn wall, car
       sailing over it. Taking the outward momentum away fast enough to
       hold it at two metres turned out to pivot the car instead: the
       velocity vector swung round while the nose stayed put, which the
       stability assist then read as a spin. So the wall is softer and
       has friction, and the car leans on it for about three metres
       before it is turned. Unheld the same car makes 242. */
    const world = new SimWorld(defaultVehicleParams(), { circuitId: 'redbullring' });
    const widest =
      world.circuit.halfWidthAt(0) + world.circuit.kerbWidth + world.circuit.runoffAt(0);
    world.dispose();

    expect(strayed(true)).toBeLessThan(widest + 4);
  });
});
