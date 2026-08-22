using System;
using NUnit.Framework;

namespace MumuF1.Tests
{
    /// <summary>
    /// The ghost, checked as a path rather than as a replay.
    /// </summary>
    /// <remarks>
    /// Everything here is about the two things that decide whether a ghost
    /// looks like a car: that it is in the right place at the right second,
    /// and that it points the right way while it gets there. The second is
    /// the one with a real trap in it — see the heading-wrap tests.
    ///
    /// Carried across case for case from the reference's own suite, because
    /// those cases were written against the behaviour rather than derived
    /// from it, and re-deriving them here would only test that this port
    /// agrees with itself.
    /// </remarks>
    [TestFixture]
    public class GhostTests
    {
        private const double Dt = 1.0 / 120.0;

        /// <summary>A straight run east at a constant speed, for exact arithmetic.</summary>
        private static GhostLap StraightLap(double seconds, double speed)
        {
            var n = (int)Math.Round(seconds * Ghost.SampleHz) + 1;
            var path = new float[n * Ghost.Stride];

            for (var i = 0; i < n; i++)
            {
                var s = (float)(i / (double)Ghost.SampleHz * speed);
                path[i * 5] = s;
                path[i * 5 + 1] = 0;
                path[i * 5 + 2] = 0;
                path[i * 5 + 3] = (float)(Math.PI / 2);
                path[i * 5 + 4] = s;   // straight east, so distance is x
            }

            return new GhostLap(seconds, path);
        }

        private static GhostSample At(double x, double distance) =>
            new GhostSample { X = (float)x, Distance = (float)distance };

        // ---- Recording a lap -------------------------------------------

        /// <summary>
        /// The simulation runs at 120 Hz and the recorder at 20. Feeding it
        /// every tick for one second must produce exactly one second of
        /// samples, and the count must not depend on the tick rate.
        /// </summary>
        [Test]
        public void TakesSamplesOnTheLapClockNotTheTickCounter()
        {
            var r = new GhostRecorder();
            for (var i = 0; i <= 120; i++)
            {
                var t = i * Dt;
                r.Record(t, At(t, t));
            }

            // Slot 0 at t=0 through slot 20 at t=1.0 — inclusive of both ends.
            Assert.That(r.Length, Is.EqualTo(Ghost.SampleHz + 1));
        }

        /// <summary>
        /// A phone that drops a frame hands the loop several ticks at once. If
        /// the recorder took at most one sample per call the recorded lap
        /// would be shorter than the lap driven, and the ghost would arrive
        /// everywhere early.
        /// </summary>
        [Test]
        public void FillsEverySlotAStalledFrameSkippedPast()
        {
            var smooth = new GhostRecorder();
            for (var i = 0; i <= 120; i++) smooth.Record(i * Dt, At(i, i));

            var stalled = new GhostRecorder();
            foreach (var t in new[] { 0.0, 0.25, 0.5, 0.75, 1.0 })
            {
                stalled.Record(t, At(t * 120, t * 120));
            }

            Assert.That(stalled.Length, Is.EqualTo(smooth.Length));
        }

        /// <summary>
        /// A lap this slow is never going to be anybody's best, so it is
        /// abandoned rather than stored — and the samples already taken go
        /// with it, which is the point: the cap exists so a player who parks
        /// on the grass and goes to lunch writes nothing at all.
        /// </summary>
        [Test]
        public void RefusesALapTooSlowToEverBeABest()
        {
            var r = new GhostRecorder();
            r.Record(0, At(0, 0));
            r.Record(Ghost.MaxLapSeconds + 1, At(1, 1));

            Assert.That(r.Abandoned, Is.True);
            Assert.That(r.Take(Ghost.MaxLapSeconds + 1), Is.Null);
            Assert.That(r.Length, Is.EqualTo(0), "kept the samples it had already taken");
        }

        /// <summary>One sample is not a path, and nothing can be drawn from it.</summary>
        [Test]
        public void GivesNothingBackFromALapWithOneSampleInIt()
        {
            var r = new GhostRecorder();
            r.Record(0, At(0, 0));
            Assert.That(r.Take(0.01), Is.Null);
        }

        [Test]
        public void StartsCleanAfterAReset()
        {
            var r = new GhostRecorder();
            for (var i = 0; i <= 120; i++) r.Record(i * Dt, At(i, i));

            r.Reset();
            Assert.That(r.Length, Is.EqualTo(0));

            r.Record(0, At(9, 9));
            Assert.That(r.Length, Is.EqualTo(1));
        }

        // ---- Playing it back -------------------------------------------

        [Test]
        public void IsWhereTheCarWasAtThatSecond()
        {
            GhostLap lap = StraightLap(10, 50);
            Assert.That(Ghost.Sample(lap, 0).X, Is.EqualTo(0).Within(1e-4));
            Assert.That(Ghost.Sample(lap, 4).X, Is.EqualTo(200).Within(1e-3));
            Assert.That(Ghost.Sample(lap, 9).X, Is.EqualTo(450).Within(1e-3));
        }

        /// <summary>
        /// Without this the ghost advances 4.25 m every 50 ms and reads as a
        /// flick-book rather than a car.
        /// </summary>
        [Test]
        public void InterpolatesBetweenSamplesRatherThanStepping()
        {
            GhostLap lap = StraightLap(10, 50);
            var half = 1.0 / Ghost.SampleHz / 2;

            var a = Ghost.Sample(lap, 1).X;
            var b = Ghost.Sample(lap, 1 + half).X;
            var c = Ghost.Sample(lap, 1 + half * 2).X;

            Assert.That(b, Is.GreaterThan(a));
            Assert.That(b, Is.LessThan(c));
            Assert.That(b, Is.EqualTo((a + c) / 2).Within(1e-3));
        }

        [TestCase(50.0)]
        [TestCase(85.0)]
        public void RecoversTheSpeedItWasDoing(double speed)
        {
            Assert.That(Ghost.Sample(StraightLap(10, speed), 5).Speed, Is.EqualTo(speed).Within(1e-2));
        }

        /// <summary>
        /// Past the end it holds its last sample and says so, which is what
        /// lets the caller stop drawing a car that has already taken the flag
        /// rather than parking it on the road.
        /// </summary>
        [Test]
        public void HoldsItsLastSampleOnceTheLapHasRunOut()
        {
            GhostLap lap = StraightLap(10, 50);
            GhostFrame end = Ghost.Sample(lap, 10);
            GhostFrame past = Ghost.Sample(lap, 30);

            Assert.That(end.Finished, Is.True);
            Assert.That(past.Finished, Is.True);
            Assert.That(past.X, Is.EqualTo(end.X).Within(1e-6));
        }

        [Test]
        public void ClampsANegativeLapTimeInsteadOfReadingOffTheFront()
        {
            GhostFrame first = Ghost.Sample(StraightLap(10, 50), -5);

            Assert.That(double.IsNaN(first.X) || double.IsInfinity(first.X), Is.False);
            Assert.That(first.X, Is.EqualTo(0).Within(1e-4));
        }

        [Test]
        public void SurvivesAnEmptyRecording()
        {
            GhostFrame frame = Ghost.Sample(new GhostLap(0, new float[0]), 3);

            Assert.That(frame.Finished, Is.True);
            Assert.That(double.IsNaN(frame.X) || double.IsInfinity(frame.X), Is.False);
        }

        // ---- Heading, which is where the bug lives ----------------------

        /// <summary>Two samples, one slot apart, at the given headings.</summary>
        private static GhostLap Turn(double from, double to) => new GhostLap(
            1.0 / Ghost.SampleHz,
            new[] { 0f, 0f, 0f, (float)from, 0f, 1f, 0f, 0f, (float)to, 1f });

        /// <summary>
        /// A car pointing at 179° and then at −179° has turned two degrees. A
        /// naive lerp sends it 358° the other way, which on screen is the
        /// ghost spinning on the spot — and it only happens on circuits whose
        /// layout puts a corner across that bearing, so it hides.
        /// </summary>
        [Test]
        public void TakesTheShortWayRoundTheWrap()
        {
            var nearlyPi = Math.PI - 0.02;
            var mid = Ghost.Sample(Turn(nearlyPi, -nearlyPi), 1.0 / Ghost.SampleHz / 2).Heading;

            // Halfway between them the short way is ±π, not 0.
            var toPi = Math.Min(Math.Abs(mid - Math.PI), Math.Abs(mid + Math.PI));
            Assert.That(toPi, Is.LessThan(0.01));
        }

        /// <summary>
        /// The general form of the same claim, swept right round the circle so
        /// no single lucky pair can pass it.
        /// </summary>
        [Test]
        public void NeverRotatesMoreThanHalfATurnBetweenTwoSamples()
        {
            for (var a = -Math.PI; a <= Math.PI; a += Math.PI / 8)
            {
                for (var b = -Math.PI; b <= Math.PI; b += Math.PI / 8)
                {
                    var mid = Ghost.Sample(Turn(a, b), 1.0 / Ghost.SampleHz / 2).Heading;
                    var swept = Math.Abs(mid - a) * 2;

                    Assert.That(swept, Is.LessThanOrEqualTo(Math.PI + 1e-6),
                        $"swept {swept:F3} rad going from {a:F3} to {b:F3}");
                }
            }
        }

        [Test]
        public void StillInterpolatesPlainlyWhenThereIsNoWrap()
        {
            var mid = Ghost.Sample(Turn(0.2, 0.6), 1.0 / Ghost.SampleHz / 2).Heading;
            Assert.That(mid, Is.EqualTo(0.4).Within(1e-5));
        }

        // ---- The codec --------------------------------------------------

        /// <summary>
        /// Exactly, not closely: these are the float values the recorder
        /// wrote, and base64 of the raw bytes is chosen over printed numbers
        /// precisely so that they come back unchanged.
        /// </summary>
        [Test]
        public void RoundTripsALapExactly()
        {
            GhostLap lap = StraightLap(5, 63.5);
            GhostLap back = Ghost.Decode(lap.Time, Ghost.Encode(lap));

            Assert.That(back, Is.Not.Null);
            Assert.That(back.Time, Is.EqualTo(lap.Time));
            Assert.That(back.Path, Is.EqualTo(lap.Path));
        }

        /// <summary>
        /// A lap long enough that the reference has to encode it in chunks.
        /// </summary>
        /// <remarks>
        /// That chunking is a workaround for a browser throwing on a
        /// thirty-thousand-argument call and has no counterpart here, which is
        /// exactly why the case is worth keeping: the port took a different
        /// route and has to arrive at the same place.
        /// </remarks>
        [Test]
        public void HandlesALapLongEnoughToNeedChunkingInTheReference()
        {
            GhostLap lap = StraightLap(150, 70);
            Assert.That(lap.Path.Length * sizeof(float), Is.GreaterThan(0x8000));

            GhostLap back = Ghost.Decode(lap.Time, Ghost.Encode(lap));

            Assert.That(back, Is.Not.Null);
            Assert.That(back.Path.Length, Is.EqualTo(lap.Path.Length));
            Assert.That(back.Path[400], Is.EqualTo(lap.Path[400]));
        }

        /// <summary>
        /// A truncated or hand-edited entry comes back as nothing rather than
        /// as an exception. A corrupt store is not worth failing a session
        /// over.
        /// </summary>
        [Test]
        public void RefusesATruncatedOrHandEditedEntryRatherThanThrowing()
        {
            var encoded = Ghost.Encode(StraightLap(5, 50));

            Assert.That(Ghost.Decode(1, encoded.Substring(0, 9)), Is.Null);
            Assert.That(Ghost.Decode(1, "not base64 at all !!"), Is.Null);
            Assert.That(Ghost.Decode(1, ""), Is.Null);
            Assert.That(Ghost.Decode(1, null), Is.Null);
        }

        /// <summary>
        /// The budget this was designed against: a 90 s lap at 20 Hz. If a
        /// change ever makes a ghost cost a quarter of a megabyte, that is
        /// worth failing a test over rather than discovering as a quota error
        /// on somebody's phone.
        /// </summary>
        [Test]
        public void StaysInsideASaneSizeForARealLap()
        {
            Assert.That(Ghost.Encode(StraightLap(90, 70)).Length, Is.LessThan(60000));
        }

        // ---- The delta readout ------------------------------------------
        //
        // A time trial is one question — am I up or down on my best, here? —
        // and it is answered by comparing times at the same *point*, never at
        // the same instant.

        [Test]
        public void SaysWhenTheGhostReachedAPointOnTheCircuit()
        {
            GhostLap lap = StraightLap(10, 50);   // 50 m/s, so 250 m is at t = 5 s

            /* Unwrapped rather than compared as a nullable, so a null here
               fails as a null reference on the line that caused it rather
               than as a tolerance mismatch three frames up. */
            Assert.That(Ghost.TimeAtDistance(lap, 0).Value, Is.EqualTo(0).Within(1e-4));
            Assert.That(Ghost.TimeAtDistance(lap, 250).Value, Is.EqualTo(5).Within(1e-3));
            Assert.That(Ghost.TimeAtDistance(lap, 500).Value, Is.EqualTo(10).Within(1e-3));
        }

        [Test]
        public void InterpolatesBetweenSamplesInTheLookupToo()
        {
            GhostLap lap = StraightLap(10, 50);

            var a = Ghost.TimeAtDistance(lap, 100);
            var b = Ghost.TimeAtDistance(lap, 101.25);

            Assert.That(a, Is.Not.Null);
            Assert.That(b, Is.Not.Null);
            Assert.That(b.Value, Is.GreaterThan(a.Value));
            Assert.That(b.Value - a.Value, Is.EqualTo(1.25 / 50).Within(1e-4));
        }

        /// <summary>
        /// Honest rather than clamped. Before the ghost's first sample or past
        /// its last there is no time to compare against, and a clamped answer
        /// would read as a delta of exactly zero — a lie in the one place a
        /// driver is looking hardest.
        /// </summary>
        [Test]
        public void RefusesAPointTheGhostNeverReached()
        {
            GhostLap lap = StraightLap(10, 50);

            Assert.That(Ghost.TimeAtDistance(lap, -1), Is.Null);
            Assert.That(Ghost.TimeAtDistance(lap, 501), Is.Null);
        }

        /// <summary>
        /// Several samples sharing one distance is a ghost that sat still — a
        /// spin, or a car in the gravel. Taking the last of them would credit
        /// the player with the whole time it stood there, as a gain that was
        /// never made.
        /// </summary>
        [Test]
        public void GivesAnEarlierTimeWhenTheGhostSatStill()
        {
            var lap = new GhostLap(0.15, new[]
            {
                0f, 0f, 0f, 0f, 0f,
                0f, 0f, 0f, 0f, 10f,
                0f, 0f, 0f, 0f, 10f,
                0f, 0f, 0f, 0f, 20f
            });

            var t = Ghost.TimeAtDistance(lap, 10);

            Assert.That(t, Is.Not.Null);
            Assert.That(t.Value, Is.EqualTo(1.0 / Ghost.SampleHz).Within(1e-5));
        }

        [Test]
        public void HasNothingToSayAboutARecordingOfOneSample()
        {
            Assert.That(
                Ghost.TimeAtDistance(new GhostLap(0, new[] { 0f, 0f, 0f, 0f, 0f }), 0),
                Is.Null);
        }

        /// <summary>
        /// The round trip that matters. If playback and the lookup disagree,
        /// the ghost is drawn in one place and the delta is computed for
        /// another.
        /// </summary>
        [TestCase(1.3)]
        [TestCase(4.7)]
        [TestCase(9.0)]
        [TestCase(15.55)]
        public void AgreesWithPlaybackAboutWhereItWasWhen(double t)
        {
            GhostLap lap = StraightLap(20, 60);

            GhostFrame frame = Ghost.Sample(lap, t);
            var back = Ghost.TimeAtDistance(lap, frame.Distance);

            Assert.That(back, Is.Not.Null);
            Assert.That(back.Value, Is.EqualTo(t).Within(1e-3));
        }

        [Test]
        public void ReportsTheSecondsARecordingCovers()
        {
            Assert.That(Ghost.Duration(StraightLap(10, 50)), Is.EqualTo(10).Within(1e-6));
            Assert.That(Ghost.Duration(new GhostLap(0, new float[0])), Is.EqualTo(0).Within(0));
        }
    }
}
