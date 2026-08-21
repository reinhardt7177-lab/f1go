/**
 * What the car sounds like, as numbers.
 *
 * Everything here is a pure function of the simulation's own output, so
 * it can be tested without a sound card — which matters, because the
 * alternative is tuning an engine note by ear against a build you cannot
 * hear on the machine you are working on.
 *
 * The note itself is not invented. A four-stroke engine fires each
 * cylinder once every two revolutions, so a V6 at `rpm` produces
 * `rpm / 60 * 3` combustion events a second, and that rate — not the
 * crank speed — is the pitch you hear. Between the 4,000 rpm idle and
 * the 15,000 rpm limiter this car runs, that is 200 Hz to 750 Hz: an
 * octave and a half, ending about where a real V6 turbo ends. Getting
 * this from the regulations rather than from a slider is why the shift
 * points land where the ear expects them.
 */

/** A 2026 power unit is a V6, and the count sets the pitch. */
export const CYLINDERS = 6;

/** Harmonics synthesised above the fundamental. */
export const HARMONICS = 16;

/**
 * Combustion events per second — the pitch of the engine (Hz).
 *
 * Two revolutions per cycle is where the halving comes from: six
 * cylinders fire three times per revolution, not six.
 */
export const firingHz = (rpm: number, cylinders: number = CYLINDERS): number =>
  Math.max(0, (rpm / 60) * (cylinders / 2));

/**
 * Relative strength of each harmonic, 1..n.
 *
 * An engine under load is *brighter*, not just louder: the pressure
 * pulse in the exhaust is sharper, so there is more energy high up. On
 * a closed throttle the same engine goes soft and hollow. One exponent
 * moves between the two, and it is the single thing that makes lifting
 * off audible — without it the note only changes volume, which reads as
 * a volume knob rather than as a driver.
 *
 * The low odd harmonics are lifted a little on top of that rolloff.
 * A six-cylinder's firing order leaves its own signature there, and a
 * pure 1/n series sounds like a sawtooth from a synthesiser instead.
 *
 * @param load 0 on a trailing throttle, 1 on full power
 */
export const harmonicAmplitudes = (
  load: number,
  count: number = HARMONICS
): Float32Array => {
  const l = Math.min(1, Math.max(0, load));
  // 1.95 is soft and hollow; 1.15 is hard and bright.
  const rolloff = 1.95 - 0.8 * l;
  const out = new Float32Array(count + 1);

  for (let n = 1; n <= count; n++) {
    let a = 1 / Math.pow(n, rolloff);
    if (n === 3 || n === 5) a *= 1.35;
    if (n === 2) a *= 0.8;
    out[n] = a;
  }

  /* Normalised so changing the timbre never changes the level. Two
     sounds that differ only in brightness must not differ in loudness,
     or every throttle movement is also a volume movement. */
  let peak = 0;
  for (let n = 1; n <= count; n++) peak += out[n]!;
  if (peak > 0) for (let n = 1; n <= count; n++) out[n]! /= peak;

  return out;
};

/**
 * How loud the engine is, 0..1.
 *
 * Rises with revs because a real one does, and rises with throttle
 * because that is the half a driver controls. The floor is well above
 * zero: an engine on the overrun at 12,000 rpm is not quiet, and a car
 * that goes silent every time you lift sounds broken.
 */
export const engineGain = (rpm: number, throttle: number): number => {
  const revs = Math.min(1, Math.max(0, (rpm - 3000) / 12000));
  const t = Math.min(1, Math.max(0, throttle));
  return 0.35 + 0.35 * revs + 0.3 * t * (0.4 + 0.6 * revs);
};

/**
 * Wind noise, 0..1.
 *
 * Grows with the square of speed, like the drag making it. Nothing
 * below walking pace, and it reaches full strength around 300 km/h.
 */
export const windGain = (speedMs: number): number => {
  const v = Math.max(0, Math.abs(speedMs) - 2);
  return Math.min(1, (v * v) / (83 * 83));
};

/**
 * Tyre scrub, 0..1.
 *
 * The same two numbers the smoke is drawn from, and deliberately the
 * same thresholds: a tyre that is audibly complaining and a tyre that
 * is visibly smoking should be the same tyre. Below them a tyre is
 * working, not sliding, and working is silent.
 */
export const scrubGain = (slipAngle: number, slipRatio: number): number => {
  const sliding = Math.max(0, Math.abs(slipAngle) - 0.17) / 0.2;
  const spinning = Math.max(0, Math.abs(slipRatio) - 0.2) / 0.45;
  return Math.min(1, Math.max(sliding, spinning));
};

/**
 * Kerb and grass rumble, 0..1.
 *
 * Read from the grip under the wheel rather than from a surface name,
 * because grip is what the simulation actually hands out and it already
 * knows the difference between tarmac, a kerb and the grass. Loaded
 * wheels rumble harder than unloaded ones, which is what makes putting
 * two wheels over the kerb sound different from putting four.
 *
 * @param surfaceGrip the multiplier under this wheel; 1 is clean tarmac
 * @param load        vertical load through the contact patch (N)
 */
export const rumbleGain = (surfaceGrip: number, load: number): number => {
  const rough = Math.min(1, Math.max(0, (1 - surfaceGrip) / 0.35));
  const weight = Math.min(1, Math.max(0, load) / 6000);
  return rough * (0.25 + 0.75 * weight);
};
