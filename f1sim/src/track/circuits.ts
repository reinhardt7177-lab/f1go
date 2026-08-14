/**
 * Circuit definitions.
 *
 * Lengths, radii and gradients are read off track maps and elevation
 * profiles rather than survey data, then adjusted so the lap closes and
 * the total distance comes out right. The intent is that each corner
 * *drives* like its real counterpart — that Eau Rouge is genuinely
 * committed and Pouhon genuinely long — not that the geometry would
 * survive a tape measure.
 */
import { buildCircuit } from './circuit';
import type { Circuit, CircuitSpec } from './circuit';

/**
 * Spa-Francorchamps. Seven kilometres, a hundred metres of elevation,
 * and the best sequence of corners in the sport.
 *
 * The elevation is the point of this circuit and it is why it was chosen
 * for stage two: Eau Rouge compresses the suspension hard enough to push
 * the floor into its stall, so the aerodynamic platform is doing real
 * work here in a way it never can on a flat pad.
 *
 * Pouhon's radius and Stavelot's are wider than a track map would
 * suggest. A layout integrated from approximate radii is not guaranteed
 * to produce a plan view that avoids itself, and the first pass here
 * curled round far enough that the run back to Blanchimont crossed
 * both the Kemmel straight and the run to Stavelot — leaving one sheet
 * of road lying two metres above another. A car reaching that at
 * 250 km/h is launched off the circuit. These two radii are what open
 * the shape back out; `tests/circuit.test.ts` holds it open.
 */
const SPA: CircuitSpec = {
  id: 'spa',
  name: 'Spa-Francorchamps',
  country: 'Belgium',
  defaultHalfWidth: 6.5,
  defaultRunoff: 9,
  kerbWidth: 1.6,
  startLine: 0,
  sectorSplits: [2340, 4560, 7011],
  sections: [
    { name: 'Start / Finish', length: 300, gradient: -0.01, halfWidth: 7.5 },
    { name: 'T1 La Source', length: 78, radius: 20, gradient: -0.02, halfWidth: 6 },
    { name: 'Descent to Eau Rouge', length: 320, gradient: -0.075, halfWidth: 7 },
    { name: 'T2 Eau Rouge', length: 90, radius: -95, gradient: -0.02 },
    { name: 'T3 Raidillon', length: 130, radius: 105, gradient: 0.17, banking: 0.05 },
    { name: 'T4 Raidillon exit', length: 95, radius: -180, gradient: 0.15 },
    { name: 'Kemmel Straight', length: 1100, gradient: 0.03, halfWidth: 7.5 },
    { name: 'T5 Les Combes', length: 72, radius: 46, gradient: -0.005, halfWidth: 6 },
    { name: 'T6 Malmedy', length: 66, radius: -52 },
    { name: 'T7', length: 80, radius: 62, gradient: -0.02 },
    { name: 'Descent to Rivage', length: 220, gradient: -0.07 },
    { name: 'T8 Rivage', length: 84, radius: 24, gradient: -0.03 },
    { name: 'T9', length: 96, radius: -78, gradient: -0.06 },
    { name: 'Run to Pouhon', length: 330, gradient: -0.07, halfWidth: 7 },
    { name: 'T10 Pouhon', length: 240, radius: -150, gradient: -0.04, banking: -0.03 },
    { name: 'T11 Pouhon exit', length: 160, radius: -160, gradient: 0.01 },
    { name: 'Run to Fagnes', length: 320, gradient: 0.015 },
    { name: 'T12 Fagnes', length: 74, radius: 58 },
    { name: 'T13 Fagnes', length: 74, radius: -62 },
    { name: 'Run to Stavelot', length: 350, gradient: -0.01, halfWidth: 7 },
    { name: 'T14 Campus', length: 130, radius: 74 },
    { name: 'T15 Stavelot', length: 150, radius: 88, gradient: 0.01 },
    { name: 'Run to Blanchimont', length: 1020, gradient: 0.02, halfWidth: 7.5 },
    { name: 'T16 Blanchimont', length: 380, radius: -330, gradient: 0.015 },
    { name: 'T17 Blanchimont', length: 260, radius: -280 },
    { name: 'Run to Bus Stop', length: 480, gradient: -0.005 },
    { name: 'T18 Bus Stop', length: 52, radius: 26, halfWidth: 6 },
    { name: 'T19 Bus Stop', length: 60, radius: -26 },
    { name: 'Pit straight approach', length: 200, gradient: 0.01, halfWidth: 7.5 }
  ]
};

/**
 * Two long straights joined by constant-radius bends, flat, and wide
 * enough to slide about on without leaving the tarmac.
 *
 * Not a circuit so much as an instrument. Every vehicle-dynamics test
 * runs here, because a measurement of braking distance or steady-state
 * grip is only meaningful if the surface is uniform and level — on Spa
 * the same test would be measuring Eau Rouge instead.
 */
const PROVING_GROUND: CircuitSpec = {
  id: 'proving',
  name: 'Proving Ground',
  country: 'Test bench',
  defaultHalfWidth: 30,
  defaultRunoff: 40,
  kerbWidth: 1.2,
  startLine: 0,
  sectorSplits: [1200, 1671, 3342],
  sections: [
    { name: 'Main Straight', length: 1200 },
    { name: 'Radius 150 Left', length: 471, radius: -150 },
    { name: 'Return Straight', length: 1200 },
    { name: 'Radius 150 Left', length: 471, radius: -150 }
  ]
};

export const CIRCUIT_SPECS: Record<string, CircuitSpec> = {
  spa: SPA,
  proving: PROVING_GROUND
};

const cache = new Map<string, Circuit>();

export const getCircuit = (id: string): Circuit => {
  const cached = cache.get(id);
  if (cached) return cached;

  const spec = CIRCUIT_SPECS[id];
  if (!spec) throw new Error(`unknown circuit: ${id}`);

  const circuit = buildCircuit(spec);
  cache.set(id, circuit);
  return circuit;
};
