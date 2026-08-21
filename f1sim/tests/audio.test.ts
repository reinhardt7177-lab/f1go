/**
 * What the car sounds like, as numbers.
 *
 * The sound cannot be checked by listening to it here, so the half that
 * decides what is heard is written as pure functions and checked
 * arithmetically. The other half — that the graph really does emit a
 * note at the frequency these functions ask for — is measured in a
 * browser through an `OfflineAudioContext`, because node has no Web
 * Audio to render one with.
 */
import { describe, expect, it } from 'vitest';

import {
  CYLINDERS,
  HARMONICS,
  engineGain,
  firingHz,
  harmonicAmplitudes,
  rumbleGain,
  scrubGain,
  windGain
} from '../src/audio/engine';
import { defaultDrivetrainParams } from '../src/sim/drivetrain';

describe('the note', () => {
  it('is the firing rate of a V6, not the crank speed', () => {
    /* Four-stroke: every cylinder fires once per two revolutions, so six
       cylinders give three events a revolution. At 10,000 rpm that is
       500 a second. Getting this wrong by the factor of two is the
       classic mistake and it puts the whole engine an octave out. */
    expect(firingHz(10_000)).toBeCloseTo(500, 6);
    expect(firingHz(10_000, 8)).toBeCloseTo(666.67, 1);
    expect(firingHz(0)).toBe(0);
  });

  it('spans the rev range this car actually uses', () => {
    const p = defaultDrivetrainParams();
    const idle = firingHz(p.idleRpm);
    const limiter = firingHz(p.redlineRpm);

    // 200 Hz to 750 Hz: about where a real V6 turbo sits, and an octave
    // and a half of travel for the ear to read the revs from.
    expect(idle).toBeCloseTo(200, 6);
    expect(limiter).toBeCloseTo(750, 6);
    expect(limiter / idle).toBeGreaterThan(2.5);
  });

  it('rises with the revs, always', () => {
    let last = -1;
    for (let rpm = 0; rpm <= 15_000; rpm += 250) {
      const hz = firingHz(rpm);
      expect(hz).toBeGreaterThan(last);
      last = hz;
    }
  });

  it('assumes the six cylinders the regulations require', () => {
    expect(CYLINDERS).toBe(6);
  });
});

describe('the timbre', () => {
  it('gets brighter under load and softer on a trailing throttle', () => {
    const closed = harmonicAmplitudes(0);
    const open = harmonicAmplitudes(1);

    /* Energy above the eighth harmonic is what "bright" means here. If
       this ever stops being true, lifting off becomes a volume change
       and stops sounding like a driver. */
    const high = (a: Float32Array): number => {
      let sum = 0;
      for (let n = 9; n <= HARMONICS; n++) sum += a[n]!;
      return sum;
    };
    expect(high(open)).toBeGreaterThan(high(closed) * 1.5);
  });

  it('keeps the same loudness at every timbre', () => {
    /* A brightness control that is also a volume control makes every
       throttle movement lurch. */
    for (const load of [0, 0.25, 0.5, 0.75, 1]) {
      const a = harmonicAmplitudes(load);
      let sum = 0;
      for (let n = 1; n <= HARMONICS; n++) sum += a[n]!;
      expect(sum).toBeCloseTo(1, 6);
    }
  });

  it('leaves the DC term alone and falls away up the series', () => {
    const a = harmonicAmplitudes(0.5);
    expect(a[0]).toBe(0);
    expect(a[1]).toBeGreaterThan(a[HARMONICS]!);
    for (let n = 1; n <= HARMONICS; n++) {
      expect(a[n]).toBeGreaterThan(0);
      expect(Number.isFinite(a[n]!)).toBe(true);
    }
  });
});

describe('the levels', () => {
  it('never silences an engine that is running', () => {
    // An engine on the overrun at twelve thousand is not quiet, and a
    // car that goes silent on every lift sounds broken.
    expect(engineGain(12_000, 0)).toBeGreaterThan(0.5);
    expect(engineGain(4_000, 0)).toBeGreaterThan(0.3);
  });

  it('is louder with revs and louder with throttle', () => {
    expect(engineGain(14_000, 1)).toBeGreaterThan(engineGain(6_000, 1));
    expect(engineGain(10_000, 1)).toBeGreaterThan(engineGain(10_000, 0));
    expect(engineGain(15_000, 1)).toBeLessThanOrEqual(1);
  });

  it('lets the wind in with the square of speed, and not before', () => {
    expect(windGain(0)).toBe(0);
    expect(windGain(1.5)).toBe(0);
    const at100 = windGain(100 / 3.6);
    const at200 = windGain(200 / 3.6);
    // Quadrupling, near enough, for a doubling of speed.
    expect(at200 / at100).toBeGreaterThan(3.2);
    expect(windGain(400 / 3.6)).toBeLessThanOrEqual(1);
  });
});

describe('the tyres', () => {
  it('says nothing about a tyre that is merely working', () => {
    expect(scrubGain(0, 0)).toBe(0);
    expect(scrubGain(0.16, 0.19)).toBe(0);
  });

  it('complains at the same point the smoke starts', () => {
    /* Deliberately the same thresholds as `emitTyreSmoke` in
       `render/scene.ts`: a tyre that is audibly complaining and a tyre
       that is visibly smoking have to be the same tyre, or the two cues
       disagree about what the car is doing. */
    expect(scrubGain(0.18, 0)).toBeGreaterThan(0);
    expect(scrubGain(0, 0.22)).toBeGreaterThan(0);
    expect(scrubGain(0.5, 0)).toBe(1);
    expect(scrubGain(0, 2)).toBe(1);
  });

  it('takes the worse of sliding and spinning', () => {
    expect(scrubGain(0.37, 0)).toBeCloseTo(scrubGain(0.37, 0.2), 6);
    expect(scrubGain(0.37, 0.65)).toBe(1);
  });
});

describe('kerbs and grass', () => {
  it('is silent on clean tarmac at any load', () => {
    expect(rumbleGain(1, 0)).toBe(0);
    expect(rumbleGain(1, 8000)).toBe(0);
  });

  it('grows as the surface gets worse', () => {
    expect(rumbleGain(0.9, 4000)).toBeGreaterThan(0);
    expect(rumbleGain(0.7, 4000)).toBeGreaterThan(rumbleGain(0.9, 4000));
  });

  it('is harder on a loaded wheel than an unloaded one', () => {
    // Two wheels over a kerb has to sound different from four.
    expect(rumbleGain(0.7, 6000)).toBeGreaterThan(rumbleGain(0.7, 200));
  });

  it('stays inside the mix', () => {
    for (const grip of [0, 0.3, 0.6, 0.9, 1]) {
      for (const load of [0, 3000, 20_000]) {
        const g = rumbleGain(grip, load);
        expect(g).toBeGreaterThanOrEqual(0);
        expect(g).toBeLessThanOrEqual(1);
      }
    }
  });
});
