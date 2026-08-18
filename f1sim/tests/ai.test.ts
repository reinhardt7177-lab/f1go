import { beforeAll, describe, expect, it } from 'vitest';

import { GRAVITY, KMH } from '../src/core/math';
import { RacingLine } from '../src/ai/racingline';
import { SpeedProfile, cornerLimit, defaultProfileOptions } from '../src/ai/speedprofile';
import { Driver, driveWorld } from '../src/ai/driver';
import { defaultVehicleParams } from '../src/sim/vehicle';
import { initPhysics } from '../src/sim/world';
import { getCircuit } from '../src/track/circuits';

const circuit = getCircuit('redbullring');
const params = defaultVehicleParams();
const line = new RacingLine(circuit);
const profile = new SpeedProfile(line, params);
const options = defaultProfileOptions();

describe('racing line', () => {
  it('stays inside the white lines everywhere', () => {
    for (let i = 0; i < line.stationCount; i++) {
      const s = i * line.spacing;
      expect(Math.abs(line.offsets[i]!)).toBeLessThanOrEqual(circuit.halfWidthAt(s));
    }
  });

  it('uses the width of the road rather than hugging the centre', () => {
    let widest = 0;
    for (const o of line.offsets) widest = Math.max(widest, Math.abs(o));
    expect(widest).toBeGreaterThan(3);
  });

  it('is shorter than the centreline', () => {
    // Straightening corners is the whole point; if the line is not
    // shorter than the road it is not a racing line.
    let length = 0;
    for (let i = 0; i < line.stationCount; i++) {
      const a = line.pointAt(i * line.spacing);
      const b = line.pointAt(((i + 1) % line.stationCount) * line.spacing);
      length += Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
    }
    expect(length).toBeLessThan(circuit.length);
    // But not absurdly so — it is bounded by the road.
    expect(length).toBeGreaterThan(circuit.length * 0.9);
  });

  it('curves hardest at the tightest corner on the circuit', () => {
    const peak = (name: string): number => {
      let worst = 0;
      for (let s = 0; s < circuit.length; s += 5) {
        if (circuit.sectionAt(s) === name) worst = Math.max(worst, Math.abs(line.curvatureAt(s)));
      }
      return worst;
    };

    const tightest = peak('T1 Niki Lauda');
    const sections = new Set<string>();
    for (let s = 0; s < circuit.length; s += 5) sections.add(circuit.sectionAt(s));
    for (const name of sections) {
      if (name === 'T1 Niki Lauda') continue;
      /* A five per cent margin. Niki Lauda and Remus are 42 m and
         46 m, and a racing line through the second can legitimately
         be a shade tighter than one through the first — what must
         not happen is a *straight* out-curving either. */
      expect(peak(name), `${name} out-curves the hairpin`).toBeLessThanOrEqual(tightest * 1.05);
    }
  });

  it('runs straight down the middle of a straight', () => {
    // Not at its ends — a racing line turns in before the corner starts,
    // so the last stations of a straight legitimately curve. The middle
    // of the climb to Remus has no such excuse, and a kink there means
    // the width constraint is stepping rather than the road bending.
    const inside: number[] = [];
    for (let s = 0; s < circuit.length; s += 5) {
      if (circuit.sectionAt(s) === 'Climb to Remus') inside.push(s);
    }
    expect(inside.length).toBeGreaterThan(20);

    /* The middle half of it, by station rather than by metre — a
       hard-coded distance range is a fact about one circuit, and the
       point being made here is about straights in general. */
    const from = inside[Math.floor(inside.length * 0.25)]!;
    const to = inside[Math.floor(inside.length * 0.75)]!;
    let worst = 0;
    for (let s = from; s <= to; s += 5) {
      worst = Math.max(worst, Math.abs(line.curvatureAt(s)));
    }
    expect(1 / Math.max(worst, 1e-9)).toBeGreaterThan(400);
  });
});

describe('corner limit', () => {
  it('is slow through a hairpin and flat through a fast sweep', () => {
    const hairpin = cornerLimit(1 / 20, params, options);
    const sweep = cornerLimit(1 / 330, params, options);

    // Niki Lauda is taken at about 90 km/h.
    expect(hairpin * KMH).toBeGreaterThan(50);
    expect(hairpin * KMH).toBeLessThan(110);

    // T8 is flat out, and that is not a tuned constant — the
    // downforce term outruns the corner demand and the algebra returns
    // the ceiling on its own.
    expect(sweep).toBe(options.maxSpeed);
  });

  it('rises with downforce, because grip does', () => {
    const withAero = cornerLimit(1 / 120, params, options);

    const noAero = defaultVehicleParams();
    noAero.aero.clA = 0;
    expect(cornerLimit(1 / 120, noAero, options)).toBeLessThan(withAero);
  });

  it('matches the flat-tyre physics when downforce is off', () => {
    const noAero = defaultVehicleParams();
    noAero.aero.clA = 0;
    const kappa = 1 / 100;
    const v = cornerLimit(kappa, noAero, options);

    // v^2 k = mu g, so the implied mu should be a sane tyre number.
    const impliedMu = (v * v * kappa) / GRAVITY;
    expect(impliedMu).toBeGreaterThan(0.8);
    expect(impliedMu).toBeLessThan(2.2);
  });
});

describe('speed profile', () => {
  it('never asks for more than the corner allows', () => {
    for (let i = 0; i < line.stationCount; i++) {
      const limit = cornerLimit(line.curvature[i]!, params, options);
      // The profile is stored as float32, so compare with a relative
      // tolerance rather than an absolute one.
      expect(profile.target[i]!).toBeLessThanOrEqual(limit * (1 + 1e-5));
    }
  });

  it('brakes before the corner, not at it', () => {
    // Find the slowest point of Niki Lauda, then check the profile is
    // already coming down well before it.
    let apex = 0;
    let slowest = Infinity;
    for (let s = 0; s < circuit.length; s += 5) {
      if (circuit.sectionAt(s) !== 'T1 Niki Lauda') continue;
      const v = profile.at(s);
      if (v < slowest) {
        slowest = v;
        apex = s;
      }
    }

    /* Braking for this hairpin begins about 110 m out — at 120 m the
       car is still accelerating up the straight, which is the correct
       answer and not the one this test is asking about. */
    const before = profile.at(apex - 80);
    const wayBefore = profile.at(apex - 180);
    expect(before).toBeLessThan(wayBefore);
    expect(slowest).toBeLessThan(before);
  });

  it('gets back on the power after a corner', () => {
    let apex = 0;
    let slowest = Infinity;
    for (let s = 0; s < circuit.length; s += 5) {
      if (circuit.sectionAt(s) !== 'T3 Remus') continue;
      const v = profile.at(s);
      if (v < slowest) {
        slowest = v;
        apex = s;
      }
    }
    expect(profile.at(apex + 200)).toBeGreaterThan(slowest);
  });

  it('produces a plausible lap time', () => {
    const ideal = profile.idealLapTime();
    // A real pole at the Red Bull Ring is about 64 s. This line is a
    // shortest path rather than a minimum-curvature one and the profile
    // leaves grip in hand, so slower is expected — but it has to be in
    // the right world.
    expect(ideal).toBeGreaterThan(58);
    expect(ideal).toBeLessThan(120);
  });

  it('is flat out through the fastest corner', () => {
    let slowest = Infinity;
    for (let s = 0; s < circuit.length; s += 5) {
      if (circuit.sectionAt(s) === 'T8') slowest = Math.min(slowest, profile.at(s));
    }
    expect(slowest * KMH).toBeGreaterThan(190);
  });
});

describe('the driver', () => {
  beforeAll(async () => {
    await initPhysics();
  });

  it('gets the car round the circuit', async () => {
    const { SimWorld } = await import('../src/sim/world');
    const world = new SimWorld(params, { circuitId: 'redbullring' });
    const driver = new Driver(line, profile, params);
    const DT = 1 / 120;

    let travelled = 0;
    let last = world.distance;
    let onTrackTicks = 0;
    const ticks = 120 * 150;

    for (let i = 0; i < ticks; i++) {
      world.car.controls = driveWorld(driver, world, DT);
      world.step(DT);

      let delta = world.distance - last;
      if (delta < -circuit.length / 2) delta += circuit.length;
      else if (delta > circuit.length / 2) delta -= circuit.length;
      travelled += delta;
      last = world.distance;

      if (world.onTrack) onTrackTicks++;
      if (driver.needsRecovery) {
        world.respawn();
        driver.reset();
        last = world.distance;
      }
    }

    // Two and a half minutes should cover most of a lap of Spa even
    // allowing for mistakes, and the car should spend most of it on the
    // road rather than in the scenery.
    expect(travelled).toBeGreaterThan(4000);
    expect(onTrackTicks / ticks).toBeGreaterThan(0.6);
    world.dispose();
  }, 120_000);

  it('produces controls inside their legal ranges', async () => {
    const { SimWorld } = await import('../src/sim/world');
    const world = new SimWorld(params, { circuitId: 'redbullring' });
    const driver = new Driver(line, profile, params);

    for (let i = 0; i < 120 * 30; i++) {
      const c = driveWorld(driver, world, 1 / 120);
      expect(c.throttle).toBeGreaterThanOrEqual(0);
      expect(c.throttle).toBeLessThanOrEqual(1);
      expect(c.brake).toBeGreaterThanOrEqual(0);
      expect(c.brake).toBeLessThanOrEqual(1);
      expect(Math.abs(c.steer)).toBeLessThanOrEqual(1);
      expect(Number.isFinite(c.steer)).toBe(true);
      world.step(1 / 120);
    }
    world.dispose();
  }, 60_000);

  it('asks to be recovered when it is stuck and not before', async () => {
    const { SimWorld } = await import('../src/sim/world');
    const world = new SimWorld(params, { circuitId: 'redbullring' });
    const driver = new Driver(line, profile, params);

    // Held still on the road, it should eventually give up.
    for (let i = 0; i < 120 * 2; i++) {
      driveWorld(driver, world, 1 / 120);
      world.car.holdStationary();
      world.step(1 / 120);
    }
    expect(driver.needsRecovery).toBe(false);

    for (let i = 0; i < 120 * 3; i++) {
      driveWorld(driver, world, 1 / 120);
      world.car.holdStationary();
      world.step(1 / 120);
    }
    expect(driver.needsRecovery).toBe(true);
    world.dispose();
  }, 60_000);
});
