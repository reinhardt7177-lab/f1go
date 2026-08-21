using System;
using NUnit.Framework;

namespace MumuF1.Tests
{
    /// <summary>
    /// Lap and sector timing, ported from the lap-timing block of
    /// <c>f1sim/tests/circuit.test.ts</c> with the same assertions.
    /// </summary>
    /// <remarks>
    /// A constant speed is the right way to test this, because then the lap
    /// time is arithmetic — distance over speed — and every claim can be
    /// checked against a number rather than against a previous run.
    /// </remarks>
    [TestFixture]
    public class LapTimerTests
    {
        private const double Dt = 1.0 / 120.0;

        private static Circuit Track => Circuits.Get("redbullring");

        /// <summary>Drive the timer round the lap at a constant speed.</summary>
        private static void LapAt(LapTimer timer, Circuit circuit, double speed, bool onTrack = true)
        {
            var steps = (int)Math.Ceiling(circuit.Length / (speed * Dt));
            for (var i = 0; i < steps; i++)
            {
                var s = (i + 1) * speed * Dt % circuit.Length;
                timer.Update(s, onTrack, Dt);
            }
        }

        [Test]
        public void DoesNotCompleteALapBeforeOneHasBeenDriven()
        {
            var timer = new LapTimer(Track);
            timer.Update(0, true, Dt);
            timer.Update(10, true, Dt);
            Assert.That(timer.LastLap, Is.Null);
        }

        [Test]
        public void TimesALapAtAKnownSpeed()
        {
            var circuit = Track;
            var timer = new LapTimer(circuit);
            timer.Update(0, true, Dt);
            LapAt(timer, circuit, 60);

            Assert.That(timer.LastLap, Is.Not.Null);
            Assert.That(timer.LastLap.Time, Is.EqualTo(circuit.Length / 60).Within(2));
        }

        [Test]
        public void SplitsTheLapIntoSectorsThatSumToTheLapTime()
        {
            var circuit = Track;
            var timer = new LapTimer(circuit);
            timer.Update(0, true, Dt);
            LapAt(timer, circuit, 60);

            var lap = timer.LastLap;
            Assert.That(lap.Sectors.Length, Is.EqualTo(circuit.SectorSplits.Count));

            var sum = 0.0;
            foreach (var sector in lap.Sectors) sum += sector;
            Assert.That(sum, Is.EqualTo(lap.Time).Within(1e-3));
        }

        /// <summary>
        /// Every sector has to be positive. Sector times are differences
        /// between running totals, so a split banked in the wrong order — or
        /// twice — comes out negative rather than merely wrong, and a
        /// negative sector would flatter the optimal lap forever after.
        /// </summary>
        [Test]
        public void NeverBanksASectorOfNegativeLength()
        {
            var circuit = Track;
            var timer = new LapTimer(circuit);
            timer.Update(0, true, Dt);

            for (var lap = 0; lap < 3; lap++) LapAt(timer, circuit, 55);

            foreach (var completed in timer.History)
            {
                foreach (var sector in completed.Sectors)
                {
                    Assert.That(sector, Is.GreaterThan(0),
                        $"lap {completed.Number} banked a sector of {sector:F3} s");
                }
            }
        }

        [Test]
        public void InvalidatesALapDrivenOffTheRoad()
        {
            var circuit = Track;
            var timer = new LapTimer(circuit);
            timer.Update(0, true, Dt);
            LapAt(timer, circuit, 60, onTrack: false);

            Assert.That(timer.LastLap.Valid, Is.False);
            Assert.That(timer.BestLap, Is.Null, "an invalid lap became the best one");
        }

        [Test]
        public void KeepsTheQuickerOfTwoLapsAsTheBest()
        {
            var circuit = Track;
            var timer = new LapTimer(circuit);
            timer.Update(0, true, Dt);

            LapAt(timer, circuit, 50);
            var slow = timer.LastLap.Time;
            LapAt(timer, circuit, 70);
            var quick = timer.LastLap.Time;

            Assert.That(quick, Is.LessThan(slow));
            Assert.That(timer.BestLap.Time, Is.EqualTo(quick).Within(1e-3));
        }

        /// <summary>
        /// The optimal lap is the best of each sector added up, so it can
        /// never be slower than the best lap actually driven — every sector
        /// of that lap is a candidate for its own best.
        /// </summary>
        [Test]
        public void ReportsAnOptimalLapNoSlowerThanTheBestActualLap()
        {
            var circuit = Track;
            var timer = new LapTimer(circuit);
            timer.Update(0, true, Dt);

            LapAt(timer, circuit, 50);
            LapAt(timer, circuit, 70);

            var optimal = timer.OptimalLap();
            Assert.That(optimal, Is.Not.Null);
            Assert.That(optimal.Value, Is.LessThanOrEqualTo(timer.BestLap.Time + 1e-6));
        }

        [Test]
        public void HasNoOptimalLapUntilEverySectorHasBeenDrivenCleanly()
        {
            var circuit = Track;
            var timer = new LapTimer(circuit);
            timer.Update(0, true, Dt);

            Assert.That(timer.OptimalLap(), Is.Null);

            LapAt(timer, circuit, 60, onTrack: false);
            Assert.That(timer.OptimalLap(), Is.Null, "an invalid lap set a sector record");

            LapAt(timer, circuit, 60);
            Assert.That(timer.OptimalLap(), Is.Not.Null);
        }

        /// <summary>
        /// A car rolling back and forth across a split must not bank it
        /// twice, and a car nudged backwards over the timing line must not
        /// be credited with a lap. Both are the same guard: distance
        /// travelled this lap, not merely position.
        /// </summary>
        [Test]
        public void RefusesALapTheCarDidNotDrive()
        {
            var circuit = Track;
            var timer = new LapTimer(circuit);
            timer.Update(0, true, Dt);

            // Roll backwards over the line and forwards again, repeatedly.
            for (var i = 0; i < 200; i++)
            {
                timer.Update(circuit.Length - 3, true, Dt);
                timer.Update(2, true, Dt);
            }

            Assert.That(timer.LastLap, Is.Null, "a lap was credited without driving one");
            Assert.That(timer.Sector, Is.EqualTo(0), "a sector was banked without reaching it");
        }

        /// <summary>
        /// Resetting keeps the records and forgets the lap in progress —
        /// which is what a restart on the grid has to do, or a personal best
        /// would be lost every time somebody spun.
        /// </summary>
        [Test]
        public void KeepsTheRecordsAcrossAReset()
        {
            var circuit = Track;
            var timer = new LapTimer(circuit);
            timer.Update(0, true, Dt);
            LapAt(timer, circuit, 60);

            var best = timer.BestLap.Time;
            timer.ResetLap();

            Assert.That(timer.BestLap.Time, Is.EqualTo(best).Within(0));
            Assert.That(timer.LapTime, Is.EqualTo(0).Within(0));
            Assert.That(timer.Sector, Is.EqualTo(0));
            Assert.That(timer.History.Count, Is.EqualTo(1));
        }
    }
}
