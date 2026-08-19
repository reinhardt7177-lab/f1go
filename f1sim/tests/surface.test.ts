/**
 * The road must not have a step in it.
 *
 * A section carries one banking angle, and that value used to be
 * written straight into the samples — a step function. On the proving
 * oval the banking goes from level to three and a half degrees between
 * one four-metre sample and the next, and the road edge is nine and a
 * half metres out, so the surface jumped by `9.5 * sin(0.06)`:
 * **424 mm**, measured.
 *
 * The mesh is the collider, so that is not a visual seam. It is a
 * half-metre kerb laid across the racing line at the entry to every
 * banked corner. Driven on the line at 264 km/h the car left the ground
 * at exactly that point and rolled to 17.7 degrees; with the banking
 * ramped it never leaves the ground and rolls 2.6.
 *
 * This measures the built mesh rather than the spec it came from, and
 * it measures the cross-section against the centreline's own rise — so
 * an honest nine per cent climb, which lifts the road 36 cm every four
 * metres, does not read as a defect. What is left is the road twisting
 * or jumping under the car.
 */
import { describe, expect, it } from 'vitest';

import { CIRCUIT_SPECS, getCircuit } from '../src/track/circuits';
import { buildTrackGeometry } from '../src/track/mesh';

/** The stations between the two kerbs — the part a car drives on. */
const FIRST_ROAD_STATION = 5;
const LAST_ROAD_STATION = 16;
/** The middle of the road, whose rise is the honest gradient. */
const CENTRE_STATION = 10;

describe.each(Object.keys(CIRCUIT_SPECS))('%s', (id) => {
  it('has no step across the road between one section and the next', () => {
    const circuit = getCircuit(id);
    const geo = buildTrackGeometry(circuit);
    const { rings, across, positions } = geo;

    const height = (ring: number, station: number): number =>
      positions[((ring % rings) * across + station) * 3 + 1]!;

    let worst = 0;
    let where = '';

    for (let ring = 0; ring < rings; ring++) {
      const centre = height(ring + 1, CENTRE_STATION) - height(ring, CENTRE_STATION);
      for (let k = FIRST_ROAD_STATION; k <= LAST_ROAD_STATION; k++) {
        const step = Math.abs(height(ring + 1, k) - height(ring, k) - centre);
        if (step > worst) {
          worst = step;
          where = `${(ring * (circuit.length / rings)).toFixed(0)} m, ` +
            `${circuit.sectionAt(ring * (circuit.length / rings))}`;
        }
      }
    }

    /* Fifty millimetres over four metres of road — a one per cent
       change in cross-slope, which is a surface a car can drive over.
       The defect this replaced was 424. */
    expect(worst * 1000, `${id}: ${(worst * 1000).toFixed(0)} mm at ${where}`)
      .toBeLessThan(50);
  });
});
