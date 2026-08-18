/**
 * Circuit definitions.
 *
 * Lengths, radii and gradients are read off track maps and elevation
 * profiles rather than survey data, then adjusted so the lap closes and
 * the total distance comes out right. The intent is that each corner
 * *drives* like its real counterpart — that the climb to Remus is
 * genuinely long and the Senna S genuinely steep — not that the
 * geometry would survive a tape measure.
 */
import { buildCircuit } from './circuit';
import type { Circuit, CircuitSpec } from './circuit';

/**
 * Two long straights joined by constant-radius bends, flat, and wide
 * enough to slide about on without leaving the tarmac.
 *
 * Not a circuit so much as an instrument. Every vehicle-dynamics test
 * runs here, because a measurement of braking distance or steady-state
 * grip is only meaningful if the surface is uniform and level — on a
 * real circuit the same test would be measuring its gradients instead.
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

/**
 * Monza. The Temple of Speed, and the opposite question to the others.
 *
 * The Red Bull Ring asks what the aerodynamic platform does over
 * elevation. Monza asks
 * what happens when you take the wings off: three-quarters of the lap is
 * full throttle, the corners that remain are two chicanes, two
 * right-handers and the Parabolica, and the whole compromise moves to
 * the straight-line end. Run the Monza trim preset here and the lap
 * comes alive; run the Monaco trim and you lose thirty km/h down every
 * straight for grip you barely use.
 *
 * Flat, deliberately — Monza's real elevation change is a couple of
 * metres and pretending otherwise would put a gradient where the
 * braking zones are.
 */
const MONZA: CircuitSpec = {
  id: 'monza',
  name: 'Monza',
  country: 'Italy',
  defaultHalfWidth: 7.7,
  defaultRunoff: 14,
  kerbWidth: 1.8,
  startLine: 0,
  sectorSplits: [2360, 4180, 5793],
  sections: [
    { name: 'Rettifilo Tribune', length: 539, halfWidth: 9.0 },
    { name: 'T1 Variante del Rettifilo', length: 46, radius: 30, halfWidth: 7.0 },
    { name: 'T2 Variante del Rettifilo', length: 46, radius: -32 },
    { name: 'Run to Curva Grande', length: 148, halfWidth: 8.3 },
    { name: 'T3 Curva Grande', length: 500, radius: 338, halfWidth: 9.0 },
    { name: 'Run to Roggia', length: 306 },
    { name: 'T4 Variante della Roggia', length: 44, radius: -28, halfWidth: 7.0 },
    { name: 'T5 Variante della Roggia', length: 44, radius: 26 },
    { name: 'Run to Lesmo', length: 461, halfWidth: 8.3 },
    { name: 'T6 Lesmo 1', length: 100, radius: 62, halfWidth: 7.7 },
    { name: 'Between the Lesmos', length: 244 },
    { name: 'T7 Lesmo 2', length: 90, radius: 58 },
    { name: 'Curva del Serraglio', length: 1112, halfWidth: 9.0 },
    { name: 'T8 Variante Ascari', length: 58, radius: -70, halfWidth: 7.0 },
    { name: 'T9 Variante Ascari', length: 62, radius: 56 },
    { name: 'T10 Variante Ascari', length: 58, radius: -78 },
    { name: 'Rettifilo Centrale', length: 787, halfWidth: 9.0 },
    { name: 'T11 Parabolica', length: 500, radius: 138, halfWidth: 8.3 },
    { name: 'Run to the line', length: 647, halfWidth: 9.0 }
  ]
};

/**
 * A banked oval, and the place to start.
 *
 * The real circuits are ones to learn. This is not — it is two straights
 * and two long left-handers, so there is nothing to memorise and the car
 * is the only thing left to pay attention to. Getting a feel for how the
 * rear steps out, what the tyres do as they come up to temperature and
 * where the braking point actually is all happen faster when the corner
 * is the same corner every time.
 *
 * Flat, and it stays flat. Every turn is the same radius and the two
 * straights are the same length, so the shape closes on its own without
 * the correction the road circuits need — the four bends sum to exactly
 * one revolution by construction rather than by adjustment.
 *
 * The banking is gentle, three and a half degrees. Enough that the car
 * leans into the corner and carries speed it could not carry flat, not
 * so much that it drives itself round — and small for a second reason:
 * banking tilts the whole cross-section, run-off and grass included, so
 * a steep oval builds a hillside forty metres out on either side.
 */
const PRACTICE_OVAL: CircuitSpec = {
  id: 'oval',
  name: 'Practice Oval',
  country: 'Anywhere',
  defaultHalfWidth: 9.5,
  defaultRunoff: 20,
  kerbWidth: 1.6,
  startLine: 0,
  sectorSplits: [1124, 2248, 3372],
  sections: [
    { name: 'Front Straight', length: 900 },
    { name: 'T1', length: 393, radius: -250, banking: -0.06 },
    { name: 'T2', length: 393, radius: -250, banking: -0.06 },
    { name: 'Back Straight', length: 900 },
    { name: 'T3', length: 393, radius: -250, banking: -0.06 },
    { name: 'T4', length: 393, radius: -250, banking: -0.06 }
  ]
};


/*
 * Five real circuits.
 *
 * Chosen for one property before anything else: none of them crosses
 * over itself. That rules out Suzuka, whose figure-of-eight is its most
 * famous feature and is exactly the thing that put a road through the
 * air over the pit straight at Spa. A lap should be a single ribbon.
 *
 * Each is a real layout reduced to the sequence a car actually feels:
 * how long the straight is, how tight the corner is, which way it goes,
 * whether it climbs. Corner radii are published nowhere, so they are
 * derived from what each corner is known for, and the section lengths
 * are then solved for closure by `tools/fit-layout.ts`.
 *
 * Every one is checked by `tests/overlap.test.ts`, which builds the
 * mesh and asserts no part of the circuit is laid over another.
 */

/** Austria. Ten corners, three long climbs, the shortest lap here. */
const RED_BULL_RING: CircuitSpec = {
  id: 'redbullring',
  name: 'Red Bull Ring',
  country: 'Austria',
  defaultHalfWidth: 8.0,
  defaultRunoff: 16,
  kerbWidth: 1.8,
  startLine: 0,
  sectorSplits: [1450, 2900, 4318],
  sections: [
    { name: 'Start / Finish', length: 518, gradient: 0.02, halfWidth: 9.2 },
    { name: 'T1 Niki Lauda', length: 60, radius: -42, gradient: 0.06, halfWidth: 7.6 },
    { name: 'Climb to Remus', length: 810, gradient: 0.09, halfWidth: 9 },
    { name: 'T3 Remus', length: 76, radius: -46, gradient: 0.02, halfWidth: 7.6 },
    { name: 'Run to Schlossgold', length: 583, gradient: -0.02, halfWidth: 9 },
    { name: 'T4 Schlossgold', length: 96, radius: -78, gradient: -0.04 },
    { name: 'Descent to Rauch', length: 422, gradient: -0.07 },
    { name: 'T5', length: 74, radius: -56, gradient: -0.05 },
    { name: 'T6 Rauch', length: 90, radius: 120, gradient: -0.03 },
    { name: 'Run to Wurth', length: 346, gradient: -0.02 },
    { name: 'T7 Wurth', length: 104, radius: -84, gradient: 0.01 },
    { name: 'T8', length: 92, radius: 110, gradient: 0.02 },
    { name: 'Run to Rindt', length: 345, gradient: 0.01, halfWidth: 9 },
    { name: 'T9 Rindt', length: 118, radius: -92, gradient: -0.01, halfWidth: 7.6 },
    { name: 'T10', length: 130, radius: -110, gradient: -0.02 },
    { name: 'Pit straight approach', length: 454, gradient: -0.01, halfWidth: 9.2 }
  ]
};

/** Brazil. Anticlockwise, and it climbs the whole last sector. */
const INTERLAGOS: CircuitSpec = {
  id: 'interlagos',
  name: 'Interlagos',
  country: 'Brazil',
  defaultHalfWidth: 7.6,
  defaultRunoff: 12,
  kerbWidth: 1.8,
  startLine: 0,
  sectorSplits: [1440, 2880, 4309],
  sections: [
    { name: 'Start / Finish', length: 197, gradient: -0.02, halfWidth: 9 },
    { name: 'T1 Senna S', length: 78, radius: 40, gradient: -0.08, halfWidth: 7.2 },
    { name: 'T2 Senna S', length: 80, radius: -54, gradient: -0.06 },
    { name: 'Run to Curva do Sol', length: 74, gradient: -0.03, halfWidth: 7.6 },
    { name: 'T3 Curva do Sol', length: 170, radius: 92, gradient: -0.01 },
    { name: 'Reta Oposta', length: 777, gradient: -0.02, halfWidth: 9 },
    { name: 'T4 Descida do Lago', length: 96, radius: 60, gradient: -0.03, halfWidth: 7.6 },
    { name: 'T5', length: 84, radius: 78, gradient: 0.01 },
    { name: 'Climb to Ferradura', length: 477, gradient: 0.05 },
    { name: 'T6 Ferradura', length: 150, radius: -64, gradient: 0.03 },
    { name: 'T7 Laranja', length: 96, radius: 89, gradient: -0.01 },
    { name: 'Run to Pinheirinho', length: 348, gradient: -0.02 },
    { name: 'T8 Pinheirinho', length: 104, radius: 56 },
    { name: 'T9 Bico de Pato', length: 90, radius: -44, halfWidth: 7.2 },
    { name: 'T10 Mergulho', length: 130, radius: 70, gradient: -0.01, halfWidth: 7.6 },
    { name: 'Run to Juncao', length: 361, gradient: -0.02 },
    { name: 'T11 Juncao', length: 100, radius: 48, gradient: 0.02, halfWidth: 7.2 },
    { name: 'Subida dos Boxes', length: 472, gradient: 0.08, halfWidth: 9 },
    { name: 'T12 Arquibancadas', length: 180, radius: -347, gradient: 0.05 },
    { name: 'Pit straight approach', length: 209, gradient: 0.02 }
  ]
};

/* The oval is first because it is where a new driver should start. */
export const CIRCUIT_SPECS: Record<string, CircuitSpec> = {
  oval: PRACTICE_OVAL,
  redbullring: RED_BULL_RING,
  interlagos: INTERLAGOS,
  monza: MONZA,
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
