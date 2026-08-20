/**
 * What a device is asked to draw, and the loop that corrects the guess.
 *
 * The tier is a guess made once from what the device says about itself,
 * and the interesting property is not that any particular phone lands in
 * any particular bucket — it is that the guess errs *downward* on touch.
 * A desktop that guesses low loses some trees. A phone that guesses high
 * runs at twelve frames a second, and the scaler can claw resolution
 * back but cannot un-place a forest or un-build a shadow map.
 *
 * The scaler is a closed loop, so it is tested the way a controller is:
 * feed it a load and assert that it settles, does not oscillate, and
 * does not respond to noise.
 */
import { describe, expect, it } from 'vitest';

import {
  ResolutionScaler,
  pickTier,
  settingsFor,
  tierFromQuery
} from '../src/render/quality';
import type { DeviceProfile } from '../src/render/quality';

const device = (over: Partial<DeviceProfile> = {}): DeviceProfile => ({
  coarsePointer: true,
  deviceMemory: null,
  cores: null,
  devicePixelRatio: 3,
  viewportLongEdge: 844,
  ...over
});

describe('choosing a tier', () => {
  it('gives a desktop everything', () => {
    expect(pickTier(device({ coarsePointer: false, devicePixelRatio: 1 }))).toBe('high');
  });

  it('never gives a phone the top tier from detection alone', () => {
    /* Not even a flagship. A phone that reports 8 GiB is still a phone
       being held at arm's length, where the difference between the top
       two tiers is invisible and the difference in frame time is not.
       Measurement promotes it if it can afford it. */
    const flagship = device({ deviceMemory: 8, cores: 8, viewportLongEdge: 932 });
    expect(pickTier(flagship)).not.toBe('high');
  });

  it('reads the memory hint where there is one', () => {
    expect(pickTier(device({ deviceMemory: 2 }))).toBe('low');
    expect(pickTier(device({ deviceMemory: 4 }))).toBe('medium');
  });

  it('falls back to cores and screen size on Safari, which offers neither', () => {
    // No `deviceMemory` at all — the iOS case.
    expect(pickTier(device({ cores: 4 }))).toBe('low');
    // An iPhone SE: a small screen is a small phone is an old phone.
    expect(pickTier(device({ viewportLongEdge: 667 }))).toBe('low');
    expect(pickTier(device({ viewportLongEdge: 844 }))).toBe('medium');
  });

  it('can be pinned from the URL, which is how a bug report is made', () => {
    expect(tierFromQuery('?quality=low')).toBe('low');
    expect(tierFromQuery('?circuit=monza&quality=high')).toBe('high');
    expect(tierFromQuery('?quality=ultra')).toBeNull();
    expect(tierFromQuery('')).toBeNull();
  });
});

describe('what each tier costs', () => {
  it('spends strictly less at every step down', () => {
    const low = settingsFor('low');
    const medium = settingsFor('medium');
    const high = settingsFor('high');

    for (const [cheap, dear] of [
      [low, medium],
      [medium, high]
    ] as const) {
      expect(cheap.maxPixelRatio).toBeLessThanOrEqual(dear.maxPixelRatio);
      expect(cheap.sceneryDensity).toBeLessThan(dear.sceneryDensity);
      expect(cheap.smokePool).toBeLessThan(dear.smokePool);
    }
    expect(low.antialias).toBe(false);
    expect(low.shadows).toBe(false);
    expect(high.antialias).toBe(true);
  });

  it('hands out copies, so one caller cannot re-tune everyone else', () => {
    const a = settingsFor('high');
    a.maxPixelRatio = 0.1;
    expect(settingsFor('high').maxPixelRatio).toBe(2);
  });
});

describe('the resolution scaler', () => {
  /** Feed it `n` frames that all took `ms`, collecting every change. */
  const run = (scaler: ResolutionScaler, ms: number, n: number): number[] => {
    const moves: number[] = [];
    for (let i = 0; i < n; i++) {
      const next = scaler.sample(ms);
      if (next !== null) moves.push(next);
    }
    return moves;
  };

  it('leaves a device that is keeping up alone', () => {
    const scaler = new ResolutionScaler(0.6);
    // Comfortably inside the band: 60 Hz with headroom to spare.
    expect(run(scaler, 16, 600)).toEqual([]);
    expect(scaler.scale).toBe(1);
  });

  it('drops resolution when frames run long', () => {
    const scaler = new ResolutionScaler(0.6);
    const moves = run(scaler, 33, 600); // 30 fps
    expect(moves.length).toBeGreaterThan(0);
    expect(scaler.scale).toBeLessThan(1);
  });

  it('stops at the tier floor rather than shrinking to nothing', () => {
    const scaler = new ResolutionScaler(0.6);
    run(scaler, 200, 4000); // hopeless
    expect(scaler.scale).toBe(0.6);
  });

  it('gives resolution back when the load lifts', () => {
    const scaler = new ResolutionScaler(0.5);
    run(scaler, 33, 1200);
    const dropped = scaler.scale;
    expect(dropped).toBeLessThan(1);

    run(scaler, 8, 3000);
    expect(scaler.scale).toBeGreaterThan(dropped);
  });

  it('never climbs past full resolution', () => {
    const scaler = new ResolutionScaler(0.5);
    run(scaler, 6, 6000);
    expect(scaler.scale).toBe(1);
  });

  it('ignores a single hitch among good frames', () => {
    /* The reason the controller takes a median rather than a mean. One
       90 ms garbage collection in thirty frames moves a mean by 2.5 ms —
       enough to cross the threshold on its own — and moves a median by
       nothing, which is the right answer to one bad frame among
       twenty-nine good ones. */
    const scaler = new ResolutionScaler(0.6);
    for (let i = 0; i < 900; i++) {
      scaler.sample(i % 30 === 0 ? 90 : 15);
    }
    expect(scaler.scale).toBe(1);
  });

  it('ignores a stall outright', () => {
    // A tab coming back from the background reports one enormous frame.
    const scaler = new ResolutionScaler(0.6);
    expect(scaler.sample(4000)).toBeNull();
    expect(scaler.sample(Number.NaN)).toBeNull();
    expect(scaler.sample(0)).toBeNull();
    expect(scaler.scale).toBe(1);
  });

  it('settles instead of hunting', () => {
    /* The failure a closed loop invites: resolution visibly breathing
       because every correction over-shoots into the opposite verdict.
       Frame time is modelled as proportional to pixel count, which is
       what it actually is for a fill-bound scene. */
    const scaler = new ResolutionScaler(0.5);
    const atFullRes = 26; // a device that starts out too slow
    const seen: number[] = [];
    for (let i = 0; i < 4000; i++) {
      const next = scaler.sample(atFullRes * scaler.scale * scaler.scale);
      if (next !== null) seen.push(next);
    }
    // It found a resting point, and did not keep paying to re-find it.
    expect(seen.length).toBeLessThan(12);
    const settled = scaler.scale;
    run(scaler, atFullRes * settled * settled, 600);
    expect(scaler.scale).toBe(settled);
  });
});
