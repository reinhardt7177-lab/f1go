/**
 * The ghost, checked as a path rather than as a replay.
 *
 * Everything here is about the two things that decide whether a ghost
 * looks like a car: that it is in the right place at the right second,
 * and that it points the right way while it gets there. The second is
 * the one with a real trap in it — see the heading-wrap tests.
 */
import { describe, expect, it } from 'vitest';

import {
  GhostRecorder,
  MAX_LAP_SECONDS,
  SAMPLE_HZ,
  decodeGhost,
  encodeGhost,
  ghostDuration,
  ghostTimeAtDistance,
  sampleGhost
} from '../src/race/ghost';
import type { GhostLap } from '../src/race/ghost';

const DT = 1 / 120;

/** A straight run east at a constant speed, for exact arithmetic. */
const straightLap = (seconds: number, speed: number): GhostLap => {
  const n = Math.round(seconds * SAMPLE_HZ) + 1;
  const path = new Float32Array(n * 5);
  for (let i = 0; i < n; i++) {
    const s = (i / SAMPLE_HZ) * speed;
    path[i * 5] = s;
    path[i * 5 + 1] = 0;
    path[i * 5 + 2] = 0;
    path[i * 5 + 3] = Math.PI / 2;
    path[i * 5 + 4] = s;      // straight east, so distance is x
  }
  return { time: seconds, path };
};

describe('recording a lap', () => {
  it('takes samples on the lap clock, not on the tick counter', () => {
    /* The simulation runs at 120 Hz and the recorder at 20. Feeding it
       every tick for one second must produce exactly one second of
       samples, and the count must not depend on the tick rate. */
    const r = new GhostRecorder();
    for (let i = 0; i <= 120; i++) {
      const t = i * DT;
      r.record(t, { x: t, y: 0, z: 0, heading: 0, distance: t });
    }
    // Slot 0 at t=0 through slot 20 at t=1.0 — inclusive of both ends.
    expect(r.length).toBe(SAMPLE_HZ + 1);
  });

  it('fills every slot a stalled frame skipped past', () => {
    /* A phone that drops a frame hands the loop several ticks at once.
       If the recorder took at most one sample per call the recorded lap
       would be shorter than the lap driven, and the ghost would arrive
       everywhere early. */
    const smooth = new GhostRecorder();
    for (let i = 0; i <= 120; i++) smooth.record(i * DT, { x: i, y: 0, z: 0, heading: 0, distance: i });

    const stalled = new GhostRecorder();
    // Same second of lap, but sampled in four big jumps.
    for (const t of [0, 0.25, 0.5, 0.75, 1.0]) {
      stalled.record(t, { x: t * 120, y: 0, z: 0, heading: 0, distance: t * 120 });
    }
    expect(stalled.length).toBe(smooth.length);
  });

  it('refuses a lap too slow to ever be a best', () => {
    const r = new GhostRecorder();
    r.record(0, { x: 0, y: 0, z: 0, heading: 0, distance: 0 });
    r.record(MAX_LAP_SECONDS + 1, { x: 1, y: 0, z: 0, heading: 0, distance: 1 });
    expect(r.abandoned).toBe(true);
    expect(r.take(MAX_LAP_SECONDS + 1)).toBeNull();
    // And it must not hold the samples it already had.
    expect(r.length).toBe(0);
  });

  it('gives nothing back from a lap with one sample in it', () => {
    const r = new GhostRecorder();
    r.record(0, { x: 0, y: 0, z: 0, heading: 0, distance: 0 });
    expect(r.take(0.01)).toBeNull();
  });

  it('starts clean after a reset', () => {
    const r = new GhostRecorder();
    for (let i = 0; i <= 120; i++) r.record(i * DT, { x: i, y: 0, z: 0, heading: 0, distance: i });
    r.reset();
    expect(r.length).toBe(0);
    r.record(0, { x: 9, y: 0, z: 0, heading: 0, distance: 9 });
    expect(r.length).toBe(1);
  });
});

describe('playing it back', () => {
  it('is where the car was at that second', () => {
    const lap = straightLap(10, 50);
    expect(sampleGhost(lap, 0).x).toBeCloseTo(0, 4);
    expect(sampleGhost(lap, 4).x).toBeCloseTo(200, 3);
    expect(sampleGhost(lap, 9).x).toBeCloseTo(450, 3);
  });

  it('interpolates between samples rather than stepping', () => {
    /* Without this the ghost advances 4.25 m every 50 ms and reads as a
       flick-book rather than a car. */
    const lap = straightLap(10, 50);
    const half = 1 / SAMPLE_HZ / 2;
    const a = sampleGhost(lap, 1);
    const b = sampleGhost(lap, 1 + half);
    const c = sampleGhost(lap, 1 + half * 2);
    expect(b.x).toBeGreaterThan(a.x);
    expect(b.x).toBeLessThan(c.x);
    expect(b.x).toBeCloseTo((a.x + c.x) / 2, 3);
  });

  it('recovers the speed it was doing', () => {
    expect(sampleGhost(straightLap(10, 50), 5).speed).toBeCloseTo(50, 2);
    expect(sampleGhost(straightLap(10, 85), 5).speed).toBeCloseTo(85, 2);
  });

  it('holds its last sample once the lap has run out', () => {
    const lap = straightLap(10, 50);
    const end = sampleGhost(lap, 10);
    const past = sampleGhost(lap, 30);
    expect(end.finished).toBe(true);
    expect(past.finished).toBe(true);
    expect(past.x).toBeCloseTo(end.x, 6);
  });

  it('clamps a negative lap time instead of reading off the front', () => {
    const first = sampleGhost(straightLap(10, 50), -5);
    expect(Number.isFinite(first.x)).toBe(true);
    expect(first.x).toBeCloseTo(0, 4);
  });

  it('survives an empty recording', () => {
    const frame = sampleGhost({ time: 0, path: new Float32Array(0) }, 3);
    expect(frame.finished).toBe(true);
    expect(Number.isFinite(frame.x)).toBe(true);
  });
});

describe('heading, which is where the bug lives', () => {
  /** Two samples, half a second apart, at the given headings. */
  const turn = (from: number, to: number): GhostLap => ({
    time: 1 / SAMPLE_HZ,
    path: Float32Array.from([0, 0, 0, from, 0, 1, 0, 0, to, 1])
  });

  it('takes the short way round the ±π wrap', () => {
    /* A car pointing at 179° and then at −179° has turned two degrees.
       A naive lerp sends it 358° the other way, which on screen is the
       ghost spinning on the spot — and it only happens on circuits whose
       layout puts a corner across that bearing, so it hides. */
    const nearlyPi = Math.PI - 0.02;
    const lap = turn(nearlyPi, -nearlyPi);
    const mid = sampleGhost(lap, 1 / SAMPLE_HZ / 2).heading;

    // Halfway between them the short way is ±π, not 0.
    const distanceToPi = Math.min(
      Math.abs(mid - Math.PI),
      Math.abs(mid + Math.PI)
    );
    expect(distanceToPi).toBeLessThan(0.01);
  });

  it('never rotates more than half a turn between two samples', () => {
    /* The general form of the same claim, swept right round the circle
       so no single lucky pair can pass it. */
    for (let a = -Math.PI; a <= Math.PI; a += Math.PI / 8) {
      for (let b = -Math.PI; b <= Math.PI; b += Math.PI / 8) {
        const lap = turn(a, b);
        const mid = sampleGhost(lap, 1 / SAMPLE_HZ / 2).heading;
        const swept = Math.abs(mid - a) * 2;
        expect(swept).toBeLessThanOrEqual(Math.PI + 1e-6);
      }
    }
  });

  it('still interpolates plainly when there is no wrap', () => {
    const lap = turn(0.2, 0.6);
    expect(sampleGhost(lap, 1 / SAMPLE_HZ / 2).heading).toBeCloseTo(0.4, 5);
  });
});

describe('the codec', () => {
  it('round-trips a lap exactly', () => {
    /* Exactly, not closely: these are the float32 values the recorder
       wrote, and base64 of the raw bytes is chosen over printed numbers
       precisely so that they come back unchanged. */
    const lap = straightLap(5, 63.5);
    const back = decodeGhost(lap.time, encodeGhost(lap));
    expect(back).not.toBeNull();
    expect(back!.time).toBe(lap.time);
    expect(Array.from(back!.path)).toEqual(Array.from(lap.path));
  });

  it('handles a lap long enough to need chunking', () => {
    /* The chunk boundary is 0x8000 = 32,768 bytes, which at 16 bytes a
       sample is 2,048 samples — 102 s of lap. Interlagos and Monza are
       both under that, so the second chunk is reached only by a slow lap
       or a long circuit; it is exactly the case that would ship broken
       and then throw on somebody's first bad lap round Spa. */
    const lap = straightLap(150, 70);
    expect(lap.path.byteLength).toBeGreaterThan(0x8000);
    const back = decodeGhost(lap.time, encodeGhost(lap));
    expect(back).not.toBeNull();
    expect(back!.path.length).toBe(lap.path.length);
    expect(back!.path[400]).toBe(lap.path[400]);
  });

  it('refuses a truncated or hand-edited entry rather than throwing', () => {
    const lap = straightLap(5, 50);
    const encoded = encodeGhost(lap);
    expect(decodeGhost(1, encoded.slice(0, 9))).toBeNull();
    expect(decodeGhost(1, 'not base64 at all !!')).toBeNull();
    expect(decodeGhost(1, '')).toBeNull();
  });

  it('stays inside a sane size for a real lap', () => {
    /* The budget this file was designed against: a 90 s lap at 20 Hz.
       If a change ever makes a ghost cost a quarter of a megabyte, that
       is worth failing a test over rather than discovering as a
       localStorage quota error on somebody's phone. */
    const encoded = encodeGhost(straightLap(90, 70));
    expect(encoded.length).toBeLessThan(60_000);
  });
});

describe('the delta readout', () => {
  /* A time trial is one question — am I up or down on my best, here? —
     and it is answered by comparing times at the same *point*, never at
     the same instant. These check the lookup that makes that possible. */
  it('says when the ghost reached a point on the circuit', () => {
    const lap = straightLap(10, 50);   // 50 m/s, so 250 m is at t = 5 s
    expect(ghostTimeAtDistance(lap, 0)).toBeCloseTo(0, 4);
    expect(ghostTimeAtDistance(lap, 250)).toBeCloseTo(5, 3);
    expect(ghostTimeAtDistance(lap, 500)).toBeCloseTo(10, 3);
  });

  it('interpolates between samples', () => {
    // 4.25 m short of a sample boundary should not snap to it.
    const lap = straightLap(10, 50);
    const a = ghostTimeAtDistance(lap, 100)!;
    const b = ghostTimeAtDistance(lap, 101.25)!;
    expect(b).toBeGreaterThan(a);
    expect(b - a).toBeCloseTo(1.25 / 50, 4);
  });

  it('refuses a point the ghost never reached', () => {
    /* Honest rather than clamped. Before the ghost's first sample or
       past its last there is no time to compare against, and a clamped
       answer would read as a delta of exactly zero — which is a lie in
       the one place a driver is looking hardest. */
    const lap = straightLap(10, 50);
    expect(ghostTimeAtDistance(lap, -1)).toBeNull();
    expect(ghostTimeAtDistance(lap, 501)).toBeNull();
  });

  it('gives an earlier time when the ghost sat still', () => {
    // Two samples at the same distance: a spin, or a car in the gravel.
    const lap: GhostLap = {
      time: 0.15,
      path: Float32Array.from([
        0, 0, 0, 0, 0,
        0, 0, 0, 0, 10,
        0, 0, 0, 0, 10,
        0, 0, 0, 0, 20
      ])
    };
    const t = ghostTimeAtDistance(lap, 10);
    expect(t).not.toBeNull();
    expect(t!).toBeCloseTo(1 / SAMPLE_HZ, 5);
  });

  it('has nothing to say about a recording of one sample', () => {
    expect(ghostTimeAtDistance({ time: 0, path: Float32Array.from([0,0,0,0,0]) }, 0)).toBeNull();
  });

  it('agrees with playback: sampling at time t lands at that distance', () => {
    /* The round trip that matters. If these two disagree the ghost is
       drawn in one place and the delta is computed for another. */
    const lap = straightLap(20, 60);
    for (const t of [1.3, 4.7, 9.0, 15.55]) {
      const frame = sampleGhost(lap, t);
      const back = ghostTimeAtDistance(lap, frame.distance);
      expect(back).not.toBeNull();
      expect(back!).toBeCloseTo(t, 3);
    }
  });
});

describe('duration', () => {
  it('reports the seconds a recording covers', () => {
    expect(ghostDuration(straightLap(10, 50))).toBeCloseTo(10, 6);
    expect(ghostDuration({ time: 0, path: new Float32Array(0) })).toBe(0);
  });
});
