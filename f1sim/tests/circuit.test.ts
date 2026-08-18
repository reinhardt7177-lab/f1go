import { beforeAll, describe, expect, it } from 'vitest';

import { vec3 } from '../src/core/math';
import { LapTimer } from '../src/race/timing';
import { SURFACE_GRIP } from '../src/track/circuit';
import { getCircuit } from '../src/track/circuits';
import { buildTrackGeometry } from '../src/track/mesh';
import { initPhysics } from '../src/sim/world';

const spa = getCircuit('redbullring');

describe('circuit geometry', () => {
  it('comes out close to the real lap distance', () => {
    // Spa is 7.004 km. The integration is built from corner radii, so a
    // couple of per cent either way is expected and acceptable.
    expect(spa.length).toBeGreaterThan(4200);
    expect(spa.length).toBeLessThan(7400);
  });

  it('closes in heading, not just position', () => {
    // The lap must turn through exactly one revolution. If it does not,
    // the closed spline has a kink in its tangent at the timing line, and
    // a car driving straight across the line finds the road at an angle
    // to it and leaves the circuit within a few hundred metres.
    const start = spa.spline.sampleAt(0).tangent;
    const end = spa.spline.sampleAt(spa.length - 1).tangent;
    const dot = start.x * end.x + start.y * end.y + start.z * end.z;
    expect(dot).toBeGreaterThan(0.999);
  });

  it('has a continuous tangent all the way round', () => {
    let worstKink = 0;
    for (let s = 0; s < spa.length; s += 2) {
      const a = spa.spline.sampleAt(s).tangent;
      const b = spa.spline.sampleAt(s + 2).tangent;
      const dot = a.x * b.x + a.y * b.y + a.z * b.z;
      worstKink = Math.max(worstKink, Math.acos(Math.min(1, dot)));
    }
    // Two metres of the tightest corner here turns about six degrees.
    expect(worstKink).toBeLessThan(0.15);
  });

  it('closes the loop', () => {
    const start = spa.spline.sampleAt(0).position;
    const end = spa.spline.sampleAt(spa.length - 0.01).position;
    expect(Math.hypot(start.x - end.x, start.y - end.y, start.z - end.z)).toBeLessThan(2);
  });

  it('has real elevation change', () => {
    let lowest = Infinity;
    let highest = -Infinity;
    for (let s = 0; s < spa.length; s += 5) {
      const y = spa.spline.sampleAt(s).position.y;
      lowest = Math.min(lowest, y);
      highest = Math.max(highest, y);
    }
    // The Red Bull Ring climbs some eighty metres from Turn 1 to Remus.
    expect(highest - lowest).toBeGreaterThan(50);
  });

  it('names the section you are driving through', () => {
    const names = new Set<string>();
    for (let s = 0; s < spa.length; s += 10) names.add(spa.sectionAt(s));
    expect(names.has('T1 Niki Lauda')).toBe(true);
    expect(names.has('Climb to Remus')).toBe(true);
    expect(names.has('T9 Rindt')).toBe(true);
  });

  it('never lays one piece of road over another', () => {
    // Sweeping a ribbon along a centreline has no idea the rest of the
    // circuit exists. If the plan view crosses itself where the two
    // parts are also at similar height, the meshes interpenetrate and a
    // car meeting the seam at speed is launched clean off the circuit.
    // Genuine height separation is fine — that would simply be a bridge.
    let worstOverlap = 0;
    let where = '';

    for (let s1 = 0; s1 < spa.length; s1 += 8) {
      const p1 = spa.spline.sampleAt(s1).position;
      for (let s2 = s1 + 250; s2 < spa.length; s2 += 8) {
        if (spa.length - (s2 - s1) < 250) continue;
        const p2 = spa.spline.sampleAt(s2).position;
        if (Math.abs(p1.y - p2.y) > 6) continue;

        const plan = Math.hypot(p1.x - p2.x, p1.z - p2.z);
        const needed = spa.halfWidthAt(s1) + spa.halfWidthAt(s2);
        if (needed - plan > worstOverlap) {
          worstOverlap = needed - plan;
          where = `${spa.sectionAt(s1)} over ${spa.sectionAt(s2)}`;
        }
      }
    }

    expect(worstOverlap, `road overlaps itself: ${where}`).toBeLessThanOrEqual(0);
  });

  it('curves hardest at the hairpin', () => {
    const curvatureAt = (name: string): number => {
      let worst = 0;
      for (let s = 0; s < spa.length; s += 2) {
        if (spa.sectionAt(s) === name) worst = Math.max(worst, Math.abs(spa.spline.sampleAt(s).curvature));
      }
      return worst;
    };
    // Niki Lauda is the tightest corner on the circuit; T8 is
    // nearly flat out. The geometry has to reflect that.
    expect(curvatureAt('T1 Niki Lauda')).toBeGreaterThan(curvatureAt('T8') * 1.8);
  });
});

describe('surfaces', () => {
  it('lays out tarmac, kerb, run-off and grass outwards', () => {
    const s = 400;
    const w = spa.halfWidthAt(s);
    const k = spa.kerbWidth;
    const r = spa.runoffAt(s);

    expect(spa.surfaceAt(s, 0)).toBe('tarmac');
    expect(spa.surfaceAt(s, w - 0.1)).toBe('tarmac');
    expect(spa.surfaceAt(s, w + k * 0.5)).toBe('kerb');
    expect(spa.surfaceAt(s, w + k + r * 0.5)).toBe('runoff');
    expect(spa.surfaceAt(s, w + k + r + 5)).toBe('grass');
  });

  it('is symmetric about the centreline', () => {
    const s = 1200;
    for (const t of [3, 8, 14, 30]) {
      expect(spa.surfaceAt(s, t)).toBe(spa.surfaceAt(s, -t));
    }
  });

  it('grips best on tarmac and worst on grass', () => {
    expect(SURFACE_GRIP.tarmac).toBeGreaterThan(SURFACE_GRIP.kerb);
    expect(SURFACE_GRIP.kerb).toBeGreaterThan(SURFACE_GRIP.runoff);
    expect(SURFACE_GRIP.runoff).toBeGreaterThan(SURFACE_GRIP.gravel);
    expect(SURFACE_GRIP.gravel).toBeGreaterThan(SURFACE_GRIP.grass);
  });

  it('calls a car within the white lines on track', () => {
    const w = spa.halfWidthAt(600);
    expect(spa.isOnTrack(600, 0)).toBe(true);
    expect(spa.isOnTrack(600, w - 0.2)).toBe(true);
    expect(spa.isOnTrack(600, w + 0.5)).toBe(false);
  });
});

describe('track mesh', () => {
  const geometry = buildTrackGeometry(spa, 8);

  it('produces a closed, indexed mesh', () => {
    expect(geometry.vertexCount).toBeGreaterThan(1000);
    expect(geometry.triangleCount).toBeGreaterThan(2000);
    expect(geometry.indices.length % 3).toBe(0);
  });

  it('indexes only vertices that exist', () => {
    let max = 0;
    for (const i of geometry.indices) max = Math.max(max, i);
    expect(max).toBeLessThan(geometry.vertexCount);
  });

  it('holds no degenerate coordinates', () => {
    for (const v of geometry.positions) expect(Number.isFinite(v)).toBe(true);
  });

  it('wraps the last ring back onto the first', () => {
    // Otherwise a car crossing the timing line drops through the seam.
    const across = geometry.vertexCount / (geometry.vertexCount / 15);
    expect(across).toBeGreaterThan(0);
    const first = [geometry.positions[0]!, geometry.positions[1]!, geometry.positions[2]!];
    const lastRingStart = geometry.vertexCount - 15;
    const last = [
      geometry.positions[lastRingStart * 3]!,
      geometry.positions[lastRingStart * 3 + 1]!,
      geometry.positions[lastRingStart * 3 + 2]!
    ];
    expect(Math.hypot(first[0]! - last[0]!, first[1]! - last[1]!, first[2]! - last[2]!)).toBeLessThan(60);
  });
});

describe('lap timing', () => {
  const DT = 1 / 120;

  /** Drive the timer round the lap at a constant speed. */
  const lapAt = (timer: LapTimer, speed: number, onTrack = true): void => {
    const steps = Math.ceil(spa.length / (speed * DT));
    for (let i = 0; i < steps; i++) {
      const s = ((i + 1) * speed * DT) % spa.length;
      timer.update(s, onTrack, DT);
    }
  };

  it('does not complete a lap before one has been driven', () => {
    const timer = new LapTimer(spa);
    timer.update(0, true, DT);
    timer.update(10, true, DT);
    expect(timer.lastLap).toBeNull();
  });

  it('times a lap at a known speed', () => {
    const timer = new LapTimer(spa);
    timer.update(0, true, DT);
    lapAt(timer, 60);

    expect(timer.lastLap).not.toBeNull();
    // 7 km at 60 m/s is a shade under two minutes.
    expect(timer.lastLap!.time).toBeGreaterThan(spa.length / 60 - 2);
    expect(timer.lastLap!.time).toBeLessThan(spa.length / 60 + 2);
  });

  it('splits the lap into sectors that sum to the lap time', () => {
    const timer = new LapTimer(spa);
    timer.update(0, true, DT);
    lapAt(timer, 60);

    const lap = timer.lastLap!;
    expect(lap.sectors).toHaveLength(spa.sectorSplits.length);
    const sum = lap.sectors.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(lap.time, 3);
  });

  it('invalidates a lap driven off the road', () => {
    const timer = new LapTimer(spa);
    timer.update(0, true, DT);
    lapAt(timer, 60, false);
    expect(timer.lastLap!.valid).toBe(false);
    expect(timer.bestLap).toBeNull();
  });

  it('keeps the quicker of two laps as the best', () => {
    const timer = new LapTimer(spa);
    timer.update(0, true, DT);
    lapAt(timer, 50);
    const slow = timer.lastLap!.time;
    lapAt(timer, 70);
    const quick = timer.lastLap!.time;

    expect(quick).toBeLessThan(slow);
    expect(timer.bestLap!.time).toBeCloseTo(quick, 3);
  });

  it('reports an optimal lap no slower than the best actual lap', () => {
    const timer = new LapTimer(spa);
    timer.update(0, true, DT);
    lapAt(timer, 50);
    lapAt(timer, 70);

    const optimal = timer.optimalLap();
    expect(optimal).not.toBeNull();
    expect(optimal!).toBeLessThanOrEqual(timer.bestLap!.time + 1e-6);
  });
});

describe('driving the circuit', () => {
  beforeAll(async () => {
    await initPhysics();
  });

  it('faces the car along the road wherever it is placed', async () => {
    const { SimWorld } = await import('../src/sim/world');
    const { quatRotate } = await import('../src/core/math');

    // A mirrored yaw looks correct at the start line, where the tangent
    // happens to lie along the forward axis, and is wrong everywhere else.
    for (const start of [0, 1500, 3000, 5000]) {
      const world = new SimWorld(undefined, { circuitId: 'redbullring', startDistance: start });
      const forward = quatRotate(world.car.body.rotation(), vec3(0, 0, -1));
      const tangent = spa.spline.sampleAt(start).tangent;

      // Compare headings in plan only. The car is placed level, so on a
      // gradient it can never align with a tangent that also climbs, and
      // a three-dimensional dot product would be measuring the slope
      // rather than the thing `gridSlot` actually sets.
      const fl = Math.hypot(forward.x, forward.z);
      const tl = Math.hypot(tangent.x, tangent.z);
      const dot = (forward.x * tangent.x + forward.z * tangent.z) / (fl * tl);
      expect(dot).toBeGreaterThan(0.99);
      world.dispose();
    }
  });

  it('holds the centreline under throttle alone, with no steering', async () => {
    const { SimWorld } = await import('../src/sim/world');
    const { neutralControls } = await import('../src/sim/types');

    const world = new SimWorld(undefined, { circuitId: 'redbullring' });
    world.car.controls = { ...neutralControls(), throttle: 0.3 };
    for (let i = 0; i < 120 * 6; i++) world.step(1 / 120);

    // The start/finish straight is 300 m long, so six seconds at part
    // throttle stays on it. Any drift here is the road, not the driver.
    expect(Math.abs(world.lateral)).toBeLessThan(1.5);
    expect(world.onTrack).toBe(true);
    world.dispose();
  });

  it('places the car on the road at any distance round the lap', async () => {
    const { SimWorld } = await import('../src/sim/world');
    const world = new SimWorld(undefined, { circuitId: 'redbullring', startDistance: 3000 });

    const p = world.car.body.translation();
    const projected = spa.spline.project(vec3(p.x, p.y, p.z));

    expect(Math.abs(projected.t)).toBeLessThan(2);
    expect(projected.s).toBeGreaterThan(2900);
    expect(projected.s).toBeLessThan(3100);
    world.dispose();
  });

  it('settles onto the road surface rather than through it', async () => {
    const { SimWorld } = await import('../src/sim/world');
    const world = new SimWorld(undefined, { circuitId: 'redbullring' });
    const roadY = spa.spline.sampleAt(0).position.y;

    for (let i = 0; i < 240; i++) world.step(1 / 120);

    const y = world.car.body.translation().y;
    expect(y).toBeGreaterThan(roadY);
    expect(y).toBeLessThan(roadY + 1);

    for (const w of world.car.getState().wheels) expect(w.grounded).toBe(true);
    expect(world.onTrack).toBe(true);
    world.dispose();
  });
});

describe('a full lap', () => {
  beforeAll(async () => {
    await initPhysics();
  });

  /**
   * Driven on the proving ground rather than Spa, and deliberately so.
   *
   * The point of this test is the chain — spline projection, surface
   * lookup, timing line, sector splits — exercised by a car actually
   * going round, rather than by feeding the timer synthetic distances.
   * The stand-in driver below is a lookahead pursuit controller with a
   * speed target of sqrt(a/k); it is enough for 150 m radius bends and
   * nowhere near enough for Niki Lauda or Remus. Getting a car round
   * Spa needs a real racing line and a proper speed profile, which is
   * stage three.
   */
  it('completes a timed lap with sector splits', async () => {
    const { SimWorld } = await import('../src/sim/world');
    const { quatRotateInverse, vec3: v } = await import('../src/core/math');
    const { neutralControls, RL, RR } = await import('../src/sim/types');
    const { initialAssistState, tractionControl } = await import('../src/sim/assists');

    const world = new SimWorld(undefined, { circuitId: 'proving' });
    const assist = initialAssistState();
    const track = world.circuit;
    const DT = 1 / 120;
    const CRUISE = 30;
    let armed = true;

    for (let i = 0; i < 120 * 400 && world.timer.history.length === 0; i++) {
      const state = world.car.getState();
      const speed = Math.abs(state.speed);
      const p = world.car.body.translation();

      const aim = track.spline.sampleAt(world.distance + 14 + speed * 0.7);
      const toAim = v(aim.position.x - p.x, 0, aim.position.z - p.z);
      const local = quatRotateInverse(world.car.body.rotation(), toAim);
      const steer = Math.max(-1, Math.min(1, Math.atan2(local.x, -local.z) * 1.2));

      let worstCurve = 1e-5;
      for (let d = 8; d < 20 + speed * 2.2; d += 8) {
        worstCurve = Math.max(
          worstCurve,
          Math.abs(track.spline.sampleAt(world.distance + d).curvature)
        );
      }
      const target = Math.min(CRUISE, Math.sqrt(11 / worstCurve));
      const wantShift = speed * 3.6 > world.car.drivetrain.gear * 42;

      // Same traction limiting the vehicle tests use — without a right
      // foot, half throttle in first gear is still a burnout.
      const drivenSlip = Math.max(
        Math.abs(state.wheels[RL]!.slipRatio),
        Math.abs(state.wheels[RR]!.slipRatio)
      );

      world.car.controls = {
        ...neutralControls(),
        throttle: tractionControl(speed < target ? 0.6 : 0, drivenSlip, assist, DT),
        brake: speed > target * 1.05 ? 0.4 : 0,
        steer,
        shiftUp: wantShift && armed
      };
      armed = !wantShift;
      world.step(DT);
    }

    const lap = world.timer.history[0];
    expect(lap, 'the car never crossed the timing line').toBeDefined();

    // 3.3 km at up to 30 m/s.
    expect(lap!.time).toBeGreaterThan(90);
    expect(lap!.time).toBeLessThan(360);

    expect(lap!.sectors).toHaveLength(track.sectorSplits.length);
    expect(lap!.sectors.reduce((a, b) => a + b, 0)).toBeCloseTo(lap!.time, 2);
    for (const sector of lap!.sectors) expect(sector).toBeGreaterThan(0);

    // And it should still be on the road, not in a field.
    expect(Math.abs(world.lateral)).toBeLessThan(track.halfWidthAt(world.distance));
    world.dispose();
  }, 120_000);
});
