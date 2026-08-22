import { describe, it } from 'vitest';
import { appendFileSync, writeFileSync } from 'node:fs';
const OUT = '/tmp/m5.txt';
const log = (...a: unknown[]) => appendFileSync(OUT, a.join(' ') + '\n');

import { speedLockCeiling, defaultSteerLimiter } from '../src/sim/assists';
import { RacingLine } from '../src/ai/racingline';
import { SpeedProfile } from '../src/ai/speedprofile';
import { buildCircuit } from '../src/track/circuit';
import { CIRCUIT_SPECS } from '../src/track/circuits';
import { defaultVehicleParams } from '../src/sim/vehicle';

describe('m', () => {
  writeFileSync(OUT, '');

  it('where the lock ceiling actually goes', () => {
    const p = defaultSteerLimiter();
    for (const kmh of [300, 320, 321, 322, 323, 350, 400, 600, 1000, 100000]) {
      log('ceil', kmh, speedLockCeiling(kmh / 3.6, p).toFixed(12));
    }
    // The lowest it ever gets over a wide sweep.
    let lo = 1;
    for (let kmh = 0; kmh <= 2000; kmh += 0.25) lo = Math.min(lo, speedLockCeiling(kmh / 3.6, p));
    log('lowest over 0..2000 km/h', lo.toFixed(12), 'floor', p.floor);
  });

  it('why s=3000 is on a knife edge', () => {
    const circuit = buildCircuit(CIRCUIT_SPECS['redbullring']!);
    const line = new RacingLine(circuit);
    const profile = new SpeedProfile(line, defaultVehicleParams());

    // The driver's own arithmetic: stoppingDistance at 60 m/s.
    const speed = 60;
    const stopping = 12 + (speed * speed) / (2 * 22);
    log('stopping distance', stopping.toFixed(9));

    for (const s of [0, 500, 1200, 2000, 3000]) {
      // Every station in the window, so a near-tie is visible.
      const n = line.offsets.length;
      const vals: { i: number; v: number }[] = [];
      for (let d = 0; d <= stopping; d += line.spacing / 4) {
        const i = Math.round(((s + d) / line.spacing)) % n;
        vals.push({ i, v: profile.target[i]! });
      }
      vals.sort((a, b) => a.v - b.v);
      const best = vals[0]!;
      const second = vals.find((x) => x.i !== best.i)!;
      log('window', s,
        'min', best.v.toFixed(9), '@', best.i,
        'next', second.v.toFixed(9), '@', second.i,
        'gap', (second.v - best.v).toExponential(3));
    }
  });
});
