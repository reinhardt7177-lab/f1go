using System;
using NUnit.Framework;

namespace MumuF1.Tests
{
    /// <summary>
    /// What the car sounds like, checked without a sound card.
    /// </summary>
    /// <remarks>
    /// That is the point of the split. Every number the synthesiser uses is a
    /// pure function of the simulation's output, so the alternative — tuning
    /// an engine note by ear against a build you cannot hear on the machine
    /// you are working on — never has to happen.
    /// </remarks>
    [TestFixture]
    public class EngineAudioTests
    {
        /// <summary>
        /// The pitch comes from the regulations, not from a slider.
        /// </summary>
        /// <remarks>
        /// A four-stroke fires each cylinder once every two revolutions, so a
        /// V6 fires three times per revolution — not six. Between this car's
        /// 4,000 rpm idle and its 15,000 limiter that is 200 Hz to 750 Hz, an
        /// octave and a half, ending about where a real V6 turbo ends. Get
        /// the halving wrong and the whole engine is an octave high.
        /// </remarks>
        [TestCase(4000.0, 200.0)]
        [TestCase(9000.0, 450.0)]
        [TestCase(15000.0, 750.0)]
        public void PitchesTheEngineOffItsFiringRate(double rpm, double hz)
        {
            Assert.That(EngineAudio.FiringHz(rpm), Is.EqualTo(hz).Within(1e-9));
        }

        [Test]
        public void NeverGoesBelowSilence()
        {
            Assert.That(EngineAudio.FiringHz(-500), Is.EqualTo(0).Within(0));
            Assert.That(EngineAudio.FiringHz(0), Is.EqualTo(0).Within(0));
        }

        /// <summary>
        /// Load changes the timbre and not the level.
        /// </summary>
        /// <remarks>
        /// This is the one that makes lifting off audible. An engine under
        /// load is brighter, not just louder — the pressure pulse in the
        /// exhaust is sharper — and without it the note only changes volume,
        /// which reads as a volume knob rather than as a driver.
        ///
        /// And the normalisation is what keeps the two separate: two sounds
        /// that differ only in brightness must not differ in loudness, or
        /// every throttle movement is also a volume movement.
        /// </remarks>
        [Test]
        public void GetsBrighterUnderLoadWithoutGettingLouder()
        {
            double[] closed = EngineAudio.HarmonicAmplitudes(0);
            double[] open = EngineAudio.HarmonicAmplitudes(1);

            Assert.That(Sum(closed), Is.EqualTo(1).Within(1e-12));
            Assert.That(Sum(open), Is.EqualTo(1).Within(1e-12));

            /* Brightness, as the share of energy above the fourth harmonic.
               A single harmonic could move either way; the tail is the
               claim. */
            Assert.That(Above(open, 4), Is.GreaterThan(Above(closed, 4)),
                "full throttle is not brighter than a trailing throttle");
        }

        private static double Sum(double[] amps)
        {
            double total = 0;
            for (var n = 1; n < amps.Length; n++) total += amps[n];
            return total;
        }

        private static double Above(double[] amps, int from)
        {
            double total = 0;
            for (var n = from + 1; n < amps.Length; n++) total += amps[n];
            return total;
        }

        /// <summary>
        /// The fundamental is always the loudest partial.
        /// </summary>
        /// <remarks>
        /// The odd harmonics are lifted to give the six its signature, and
        /// lifting them past the fundamental would turn the engine note into
        /// a different pitch — which no amount of tuning downstream can undo.
        /// </remarks>
        [TestCase(0.0)]
        [TestCase(0.5)]
        [TestCase(1.0)]
        public void KeepsTheFundamentalOnTop(double load)
        {
            double[] amps = EngineAudio.HarmonicAmplitudes(load);
            for (var n = 2; n < amps.Length; n++)
            {
                Assert.That(amps[n], Is.LessThan(amps[1]), $"harmonic {n} outweighs the fundamental");
            }
        }

        /// <summary>
        /// An engine on the overrun is not silent.
        /// </summary>
        /// <remarks>
        /// A car that goes quiet every time you lift sounds broken. The floor
        /// is well above zero and stays there at any speed.
        /// </remarks>
        [Test]
        public void IsNeverSilentHoweverItIsDriven()
        {
            for (var rpm = 0.0; rpm <= 16000; rpm += 250)
            {
                for (var throttle = 0.0; throttle <= 1.0; throttle += 0.25)
                {
                    var gain = EngineAudio.EngineGain(rpm, throttle);
                    Assert.That(gain, Is.GreaterThanOrEqualTo(0.35), $"went quiet at {rpm} rpm");
                    Assert.That(gain, Is.LessThanOrEqualTo(1.0), $"clipped at {rpm} rpm");
                }
            }
        }

        [Test]
        public void GetsLouderWithRevsAndWithThrottle()
        {
            Assert.That(EngineAudio.EngineGain(12000, 0), Is.GreaterThan(EngineAudio.EngineGain(4000, 0)));
            Assert.That(EngineAudio.EngineGain(12000, 1), Is.GreaterThan(EngineAudio.EngineGain(12000, 0)));
        }

        /// <summary>
        /// Wind grows with the square of speed, like the drag making it, and
        /// there is none of it at a standstill.
        /// </summary>
        [Test]
        public void HearsTheAirOnlyOnceThereIsSome()
        {
            Assert.That(EngineAudio.WindGain(0), Is.EqualTo(0).Within(0));
            Assert.That(EngineAudio.WindGain(2), Is.EqualTo(0).Within(0));
            Assert.That(EngineAudio.WindGain(-60), Is.EqualTo(EngineAudio.WindGain(60)).Within(1e-12));

            /* Four times the excess speed is sixteen times the noise, until
               it saturates. */
            Assert.That(EngineAudio.WindGain(12), Is.EqualTo(EngineAudio.WindGain(7) * 4).Within(1e-9));
            Assert.That(EngineAudio.WindGain(300), Is.EqualTo(1).Within(0));
        }

        /// <summary>
        /// A tyre that is working is silent, and the thresholds are the same
        /// ones the smoke is drawn from — a tyre that is audibly complaining
        /// and a tyre that is visibly smoking should be the same tyre.
        /// </summary>
        [Test]
        public void KeepsQuietWhileTheTyresAreWorking()
        {
            Assert.That(EngineAudio.ScrubGain(0.1, 0.1), Is.EqualTo(0).Within(0));
            Assert.That(EngineAudio.ScrubGain(0.17, 0.2), Is.EqualTo(0).Within(0));

            Assert.That(EngineAudio.ScrubGain(0.30, 0), Is.GreaterThan(0));
            Assert.That(EngineAudio.ScrubGain(0, 0.40), Is.GreaterThan(0));
            Assert.That(EngineAudio.ScrubGain(2.0, 3.0), Is.EqualTo(1).Within(0));

            // Either way round, and the louder of the two wins.
            Assert.That(EngineAudio.ScrubGain(-0.30, 0),
                Is.EqualTo(EngineAudio.ScrubGain(0.30, 0)).Within(1e-12));
        }

        /// <summary>
        /// Clean tarmac does not rumble, and a loaded wheel rumbles harder
        /// than an unloaded one — which is what makes two wheels over a kerb
        /// sound different from four.
        /// </summary>
        [Test]
        public void RumblesOnlyOffTheRoadAndHarderUnderLoad()
        {
            Assert.That(EngineAudio.RumbleGain(1.0, 5000), Is.EqualTo(0).Within(0));

            var light = EngineAudio.RumbleGain(0.7, 500);
            var heavy = EngineAudio.RumbleGain(0.7, 6000);

            Assert.That(light, Is.GreaterThan(0));
            Assert.That(heavy, Is.GreaterThan(light));

            // An airborne wheel still ticks over rather than going silent.
            Assert.That(EngineAudio.RumbleGain(0.5, 0), Is.GreaterThan(0));
            Assert.That(EngineAudio.RumbleGain(0.0, 9000), Is.EqualTo(1).Within(1e-12));
        }
    }
}
