using System;

namespace MumuF1
{
    /// <summary>
    /// What the car sounds like, as numbers.
    /// </summary>
    /// <remarks>
    /// Everything here is a pure function of the simulation's own output, so
    /// it can be tested without a sound card — which matters, because the
    /// alternative is tuning an engine note by ear against a build you cannot
    /// hear on the machine you are working on. Nothing in this file knows
    /// what an <c>AudioSource</c> is.
    ///
    /// The note itself is not invented. A four-stroke engine fires each
    /// cylinder once every two revolutions, so a V6 at <c>rpm</c> produces
    /// <c>rpm / 60 × 3</c> combustion events a second, and that rate — not
    /// the crank speed — is the pitch you hear. Between the 4,000 rpm idle
    /// and the 15,000 rpm limiter this car runs, that is 200 Hz to 750 Hz: an
    /// octave and a half, ending about where a real V6 turbo ends. Getting
    /// this from the regulations rather than from a slider is why the shift
    /// points land where the ear expects them.
    /// </remarks>
    public static class EngineAudio
    {
        /// <summary>A 2026 power unit is a V6, and the count sets the pitch.</summary>
        public const int Cylinders = 6;

        /// <summary>Harmonics synthesised above the fundamental.</summary>
        public const int Harmonics = 16;

        /// <summary>
        /// Combustion events per second — the pitch of the engine (Hz).
        /// </summary>
        /// <remarks>
        /// Two revolutions per cycle is where the halving comes from: six
        /// cylinders fire three times per revolution, not six.
        /// </remarks>
        public static double FiringHz(double rpm, int cylinders = Cylinders) =>
            Math.Max(0, rpm / 60 * (cylinders / 2.0));

        /// <summary>
        /// Relative strength of each harmonic, one to <paramref name="count"/>.
        /// </summary>
        /// <param name="load">zero on a trailing throttle, one on full power.</param>
        /// <param name="count">how many harmonics to fill.</param>
        /// <remarks>
        /// An engine under load is <em>brighter</em>, not just louder: the
        /// pressure pulse in the exhaust is sharper, so there is more energy
        /// high up. On a closed throttle the same engine goes soft and hollow.
        /// One exponent moves between the two, and it is the single thing
        /// that makes lifting off audible — without it the note only changes
        /// volume, which reads as a volume knob rather than as a driver.
        ///
        /// The low odd harmonics are lifted a little on top of that rolloff.
        /// A six-cylinder's firing order leaves its own signature there, and
        /// a pure 1/n series sounds like a sawtooth from a synthesiser
        /// instead.
        ///
        /// Index zero is unused, so the array reads by harmonic number.
        /// </remarks>
        public static double[] HarmonicAmplitudes(double load, int count = Harmonics)
        {
            var l = MathUtil.Clamp(load, 0, 1);

            // 1.95 is soft and hollow; 1.15 is hard and bright.
            var rolloff = 1.95 - 0.8 * l;
            var of = new double[count + 1];

            for (var n = 1; n <= count; n++)
            {
                var a = 1 / Math.Pow(n, rolloff);
                if (n == 3 || n == 5) a *= 1.35;
                if (n == 2) a *= 0.8;
                of[n] = a;
            }

            /* Normalised so changing the timbre never changes the level. Two
               sounds that differ only in brightness must not differ in
               loudness, or every throttle movement is also a volume
               movement. */
            double peak = 0;
            for (var n = 1; n <= count; n++) peak += of[n];
            if (peak > 0)
            {
                for (var n = 1; n <= count; n++) of[n] /= peak;
            }

            return of;
        }

        /// <summary>
        /// How loud the engine is, zero to one.
        /// </summary>
        /// <remarks>
        /// Rises with revs because a real one does, and rises with throttle
        /// because that is the half a driver controls. The floor is well above
        /// zero: an engine on the overrun at 12,000 rpm is not quiet, and a
        /// car that goes silent every time you lift sounds broken.
        /// </remarks>
        public static double EngineGain(double rpm, double throttle)
        {
            var revs = MathUtil.Clamp((rpm - 3000) / 12000, 0, 1);
            var t = MathUtil.Clamp(throttle, 0, 1);
            return 0.35 + 0.35 * revs + 0.3 * t * (0.4 + 0.6 * revs);
        }

        /// <summary>
        /// Wind noise, zero to one.
        /// </summary>
        /// <remarks>
        /// Grows with the square of speed, like the drag making it. Nothing
        /// below walking pace, and it reaches full strength around 300 km/h.
        /// </remarks>
        public static double WindGain(double speedMs)
        {
            var v = Math.Max(0, Math.Abs(speedMs) - 2);
            return Math.Min(1, v * v / (83.0 * 83.0));
        }

        /// <summary>
        /// Tyre scrub, zero to one.
        /// </summary>
        /// <remarks>
        /// The same two numbers the smoke is drawn from, and deliberately the
        /// same thresholds: a tyre that is audibly complaining and a tyre that
        /// is visibly smoking should be the same tyre. Below them a tyre is
        /// working, not sliding, and working is silent.
        /// </remarks>
        public static double ScrubGain(double slipAngle, double slipRatio)
        {
            var sliding = Math.Max(0, Math.Abs(slipAngle) - 0.17) / 0.2;
            var spinning = Math.Max(0, Math.Abs(slipRatio) - 0.2) / 0.45;
            return Math.Min(1, Math.Max(sliding, spinning));
        }

        /// <summary>
        /// Kerb and grass rumble, zero to one.
        /// </summary>
        /// <param name="surfaceGrip">the multiplier under this wheel; one is clean tarmac.</param>
        /// <param name="load">vertical load through the contact patch (N).</param>
        /// <remarks>
        /// Read from the grip under the wheel rather than from a surface name,
        /// because grip is what the simulation actually hands out and it
        /// already knows the difference between tarmac, a kerb and the grass.
        /// Loaded wheels rumble harder than unloaded ones, which is what makes
        /// putting two wheels over the kerb sound different from putting four.
        /// </remarks>
        public static double RumbleGain(double surfaceGrip, double load)
        {
            var rough = MathUtil.Clamp((1 - surfaceGrip) / 0.35, 0, 1);
            var weight = MathUtil.Clamp(load / 6000, 0, 1);
            return rough * (0.25 + 0.75 * weight);
        }
    }
}
