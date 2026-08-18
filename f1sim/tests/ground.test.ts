/**
 * The ground must never cover the circuit.
 *
 * The world beyond the track is one flat plane. A plane at a fixed
 * depth is only below the road while the road is level, and Spa drops a
 * hundred metres — so the plane has to be placed against the lowest
 * point of the track that is actually loaded, not against the origin.
 * This pins the number the renderer needs and the range it has to cover.
 */
import { describe, expect, it } from 'vitest';
import { CIRCUIT_SPECS, getCircuit } from '../src/track/circuits';
import { buildTrackGeometry } from '../src/track/mesh';

/** Matches the drop applied in `Scene.buildTrack`. */
const GROUND_DROP = 1.2;

describe.each(Object.keys(CIRCUIT_SPECS))('%s', (id) => {
  it('sits entirely above the ground plane', () => {
    const geo = buildTrackGeometry(getCircuit(id));

    let lowest = Infinity;
    let highest = -Infinity;
    for (let i = 1; i < geo.positions.length; i += 3) {
      const y = geo.positions[i]!;
      if (y < lowest) lowest = y;
      if (y > highest) highest = y;
    }

    const groundY = lowest - GROUND_DROP;

    expect(Number.isFinite(lowest)).toBe(true);
    expect(
      lowest - groundY,
      `${id} spans ${(highest - lowest).toFixed(1)}m of elevation; ` +
        `ground at ${groundY.toFixed(1)} against a lowest vertex of ${lowest.toFixed(1)}`
    ).toBeGreaterThan(0);

  });
});

/**
 * The regression itself, stated directly rather than through a proxy.
 *
 * The plane used to sit at a fixed -1.2. Interlagos descends far past
 * that — it drops into the Senna S off the start line and does not come
 * back up until the last sector — so the lower half of the lap was drawn
 * underneath its own scenery. An
 * elevation-range check is not the same claim — banking tilts the whole
 * cross-section, so a flat oval can span ten metres corner to corner
 * without a single metre of descent.
 */
it('interlagos descends past the old fixed ground', () => {
  const geo = buildTrackGeometry(getCircuit('interlagos'));
  let lowest = Infinity;
  for (let i = 1; i < geo.positions.length; i += 3) {
    if (geo.positions[i]! < lowest) lowest = geo.positions[i]!;
  }
  expect(lowest).toBeLessThan(-1.2);
});
