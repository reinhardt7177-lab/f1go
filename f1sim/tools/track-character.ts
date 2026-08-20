/*
 * What kind of circuit is this?
 *
 *   npx tsx tools/track-character.ts [id...]
 *
 * `check-layout.ts` asks whether a layout is driveable. This asks
 * whether it is worth driving, using the two measures the procedural
 * track-generation literature settled on.
 *
 * Loiacono, Cardamone and Lanzi ("Automatic Track Generation for
 * High-End Racing Games Using Evolutionary Computation", IEEE TCIAIG)
 * evolved TORCS tracks against *diversity* rather than against any
 * notion of realism, and defined it as the Shannon entropy of two
 * profiles: the curvature along the lap, and the speed a driver can
 * carry along it. A circuit that is all one radius scores near zero on
 * the first however long it is; a circuit that never changes speed
 * scores near zero on the second however many corners it has. Both
 * being high is a lap with a shape you can remember.
 *
 * That is one half of the picture and it points the wrong way on its
 * own — a maximally diverse track is a go-kart circuit. The other half
 * is Fenu et al.'s survey of F1 2020 players ("What makes a circuit
 * likeable...", Computers in Human Behavior Reports, 2021), which
 * matched stated preference against objective track features and found
 * players prefer *fast* circuits with *fewer* corners and *fewer* gear
 * shifts per lap, largely independent of length. Diversity is what
 * makes a lap interesting to learn; flow is what makes it pleasant to
 * drive. A circuit wants both, and the two are in tension, so it is
 * worth being able to see where each of ours actually sits.
 *
 * Everything here is measured off the same racing line and speed
 * profile the autopilot drives, so the numbers describe the circuit as
 * the game actually presents it rather than as its section list reads.
 */
import { CIRCUIT_SPECS, getCircuit } from '../src/track/circuits';
import { RacingLine } from '../src/ai/racingline';
import { SpeedProfile } from '../src/ai/speedprofile';
import { defaultVehicleParams } from '../src/sim/vehicle';
import { KMH } from '../src/core/math';

/** Shannon entropy of a histogram, normalised to 0..1 by log(bins). */
const entropy = (counts: number[]): number => {
  const total = counts.reduce((a, b) => a + b, 0);
  if (total === 0) return 0;
  let h = 0;
  for (const c of counts) {
    if (c === 0) continue;
    const p = c / total;
    h -= p * Math.log(p);
  }
  return h / Math.log(counts.length);
};

const histogram = (
  values: ArrayLike<number>,
  bins: number,
  lo: number,
  hi: number
): number[] => {
  const counts = new Array<number>(bins).fill(0);
  const span = hi - lo || 1;
  for (let i = 0; i < values.length; i++) {
    const v = values[i] as number;
    const b = Math.min(bins - 1, Math.max(0, Math.floor(((v - lo) / span) * bins)));
    counts[b] = (counts[b] ?? 0) + 1;
  }
  return counts;
};

const BINS = 16;
/* A corner is a place the line is bent enough to cost speed. 1/400 m is
   about the radius at which an F1 car is still flat in top gear, which
   is the line between "corner" and "kink" a driver would draw. */
const CORNER_CURVATURE = 1 / 400;

const params = defaultVehicleParams();
const ids = process.argv.slice(2);
const targets = ids.length ? ids : Object.keys(CIRCUIT_SPECS);

console.log(
  [
    'circuit'.padEnd(16),
    'len km'.padStart(7),
    'corners'.padStart(8),
    '/km'.padStart(5),
    'v avg'.padStart(6),
    'v min'.padStart(6),
    'v max'.padStart(6),
    'straight'.padStart(9),
    'H(curv)'.padStart(8),
    'H(speed)'.padStart(9),
    'lap'.padStart(8)
  ].join(' ')
);

for (const id of targets) {
  let circuit;
  try {
    circuit = getCircuit(id);
  } catch (e) {
    console.log(`${id}: FAILED — ${(e as Error).message}`);
    continue;
  }

  const line = new RacingLine(circuit);
  const profile = new SpeedProfile(line, params);

  const step = circuit.length / line.curvature.length;

  /* Curvature is signed, and it must be for the entropy to mean
     anything: a lap of left-handers and a lap that alternates have the
     same histogram once you take the absolute value, and they are not
     the same circuit to drive. */
  const curvature = line.curvature;
  let kMax = 0;
  for (let i = 0; i < curvature.length; i++) {
    kMax = Math.max(kMax, Math.abs(curvature[i] as number));
  }

  const speeds: number[] = [];
  for (let s = 0; s < circuit.length; s += step) speeds.push(profile.at(s));

  /* Corners, counted as runs rather than samples — otherwise a long
     constant-radius curve counts as two hundred corners and Monza looks
     more technical than Monaco. */
  let corners = 0;
  let inCorner = false;
  let straight = 0;
  let longestStraight = 0;
  for (let i = 0; i < curvature.length; i++) {
    const bent = Math.abs(curvature[i] as number) > CORNER_CURVATURE;
    if (bent && !inCorner) corners++;
    if (bent) {
      longestStraight = Math.max(longestStraight, straight);
      straight = 0;
    } else {
      straight += step;
    }
    inCorner = bent;
  }
  longestStraight = Math.max(longestStraight, straight);

  const vAvg = speeds.reduce((a, b) => a + b, 0) / speeds.length;
  const vMin = Math.min(...speeds);
  const vMax = Math.max(...speeds);

  const hCurv = entropy(histogram(curvature, BINS, -kMax, kMax));
  const hSpeed = entropy(histogram(speeds, BINS, vMin, vMax));

  console.log(
    [
      (circuit.spec.name ?? id).padEnd(16),
      (circuit.length / 1000).toFixed(2).padStart(7),
      String(corners).padStart(8),
      ((corners / circuit.length) * 1000).toFixed(1).padStart(5),
      (vAvg * KMH).toFixed(0).padStart(6),
      (vMin * KMH).toFixed(0).padStart(6),
      (vMax * KMH).toFixed(0).padStart(6),
      `${longestStraight.toFixed(0)}m`.padStart(9),
      hCurv.toFixed(3).padStart(8),
      hSpeed.toFixed(3).padStart(9),
      profile.idealLapTime().toFixed(2).padStart(8)
    ].join(' ')
  );
}

console.log(`
H(curv)  0 = one radius all lap, 1 = every radius equally represented
H(speed) 0 = one speed all lap,  1 = every speed equally represented
Diversity (Loiacono et al.) wants both high; likeability (Fenu et al.)
wants few corners and a high average speed. They pull against each other.`);
