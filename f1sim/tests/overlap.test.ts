/**
 * The circuit must not be drawn on top of itself.
 *
 * The road is a ribbon swept along the centreline, and the ribbon is
 * much wider than the road: kerbs, run-off and a grass apron take it
 * some thirty metres either side. Any corner that doubles the lap back
 * within twice that had two sheets of scenery lying through each other
 * — grass a few centimetres above tarmac, and a car crossing the seam
 * finding whichever the raycast hit first.
 *
 * `tools/check-layout.ts` did not catch it, and could not: it compares
 * `halfWidth` alone, so the verges are outside what it measures, and it
 * skips pairs closer than 250 m along the lap, which is where a hairpin
 * puts them. This asserts the thing that actually matters — that no
 * vertex of the mesh lands on another part of the road — against the
 * built geometry rather than against the spec it came from.
 */
import { describe, expect, it } from 'vitest';
import { CIRCUIT_SPECS, getCircuit } from '../src/track/circuits';
import { buildTrackGeometry } from '../src/track/mesh';

/**
 * Two rings are different roads when the walk around the lap between
 * them is half again as long as the gap across — the same test the mesh
 * itself applies, and stated here so the assertion is about the rule
 * rather than about a distance that happens to suit one circuit.
 */
const differentRoads = (alongLap: number, plan: number): boolean =>
  alongLap >= 40 && alongLap >= plan * 1.5;



describe.each(Object.keys(CIRCUIT_SPECS))('%s', (id) => {
  it('never sweeps one part of the circuit over another', () => {
    const circuit = getCircuit(id);
    const geo = buildTrackGeometry(circuit);
    const { rings, across, positions } = geo;

    const ringSpacing = circuit.length / rings;

    /* The widest any station on a ring reaches, and where the ring is.
       Comparing extents ring to ring is the same test as comparing every
       vertex to every vertex, and it is `across` times cheaper. */
    const cx: number[] = [];
    const cy: number[] = [];
    const cz: number[] = [];
    const reach: number[] = [];

    for (let ring = 0; ring < rings; ring++) {
      const s = (ring / rings) * circuit.length;
      const centre = circuit.spline.sampleAt(s).position;
      cx.push(centre.x);
      cy.push(centre.y);
      cz.push(centre.z);

      let widest = 0;
      for (let k = 0; k < across; k++) {
        const i = (ring * across + k) * 3;
        widest = Math.max(
          widest,
          Math.hypot(positions[i]! - centre.x, positions[i + 2]! - centre.z)
        );
      }
      reach.push(widest);
    }

    let worst = -Infinity;
    let where = '';

    for (let i = 0; i < rings; i++) {
      for (let j = i + 1; j < rings; j++) {
        // One road over another with a road's worth of clearance is a
        // bridge, not two sheets in the same place. Same threshold the
        // mesh clamps by, and it has to be, or this would assert a rule
        // the builder was never asked to keep.
        if (Math.abs(cy[i]! - cy[j]!) > 4) continue;

        const plan = Math.hypot(cx[i]! - cx[j]!, cz[i]! - cz[j]!);
        const alongLap = Math.min(j - i, rings - (j - i)) * ringSpacing;
        if (!differentRoads(alongLap, plan)) continue;

        const overlap = reach[i]! + reach[j]! - plan;
        if (overlap > worst) {
          worst = overlap;
          where = `${circuit.sectionAt((i / rings) * circuit.length)} / ` +
            `${circuit.sectionAt((j / rings) * circuit.length)}`;
        }
      }
    }

    /* A shade of tolerance: the extents are measured from the ring's own
       centre and the two rings are not parallel, so a pair meeting
       exactly can read as a few centimetres of overlap. Every circuit is
       held to it — the allowance that used to sit here was Spa's, and
       Spa has been removed rather than excused. */
    expect(
      worst,
      `${id} overlaps by ${worst.toFixed(1)}m at ${where}`
    ).toBeLessThan(0.5);
  });
});
