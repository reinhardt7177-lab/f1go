using System;
using NUnit.Framework;

namespace MumuF1.Tests
{
    /// <summary>
    /// The automatic gearbox both sets of controls now share.
    /// </summary>
    public class GearboxTests
    {
        private const int Top = 8;

        /// <summary>
        /// Run the box at a fixed speed until it stops changing its mind, and
        /// report how many shifts that took.
        /// </summary>
        /// <remarks>
        /// One shift per pass, because that is what <c>Drivetrain</c> allows:
        /// its shift timer swallows every request until the last one has
        /// finished, so a gearbox several ratios adrift walks there rather
        /// than jumping. Modelled here so a rule that only settles by
        /// jumping two at once would fail.
        /// </remarks>
        private static int Settle(ref int gear, double kmh, int passes = 200)
        {
            int shifts = 0;

            for (int i = 0; i < passes; i++)
            {
                Gearbox.Choose(gear, kmh / MathUtil.Kmh, out bool up, out bool down);

                if (up && gear < Top) { gear++; shifts++; }
                else if (down && gear > 1) { gear--; shifts++; }
            }

            return shifts;
        }

        [Test]
        public void ClimbsThroughTheGearsWithSpeed()
        {
            foreach (var pair in new[]
            {
                new[] { 20.0, 1 }, new[] { 50.0, 2 }, new[] { 90.0, 3 },
                new[] { 130.0, 4 }, new[] { 180.0, 5 }, new[] { 220.0, 6 },
                new[] { 260.0, 7 }, new[] { 330.0, 8 }
            })
            {
                int gear = 1;
                Settle(ref gear, pair[0]);
                Assert.AreEqual((int)pair[1], gear, "at " + pair[0] + " km/h");
            }
        }

        /// <summary>
        /// And comes back down, which the keyboard never did. A lap that
        /// braked for a hairpin used to arrive in whatever gear the straight
        /// had left, and stay there.
        /// </summary>
        [Test]
        public void ComesBackDownWhenTheCarSlows()
        {
            int gear = 8;
            Settle(ref gear, 40.0);
            Assert.AreEqual(2, gear, "should have dropped to second");

            Settle(ref gear, 10.0);
            Assert.AreEqual(1, gear, "and then to first");
        }

        /// <summary>
        /// The failure that took the latch out. A car that arrives several
        /// gears adrift — landed from a jump, or reset back onto the circuit
        /// at speed — has to be able to catch up. The latch armed only while
        /// the car was below its gear's threshold, so a car above it shifted
        /// exactly once and then held first gear at ninety km/h for ever.
        /// </summary>
        [Test]
        public void CatchesUpWhenItArrivesSeveralGearsAdrift()
        {
            int gear = 1;
            int shifts = Settle(ref gear, 330.0);

            Assert.AreEqual(Top, gear, "should have reached top");
            Assert.AreEqual(Top - 1, shifts, "and taken one shift per gear");
        }

        /// <summary>
        /// The one the margin exists for, and the only thing standing between
        /// the box and a hunt now nothing latches it. Park the car on a shift
        /// boundary and hold it: with the thresholds meeting it would shift
        /// up, find itself under the downshift line, shift down, and keep
        /// doing that for as long as the throttle stayed put.
        /// </summary>
        [Test]
        public void DoesNotHuntOnAThreshold()
        {
            for (int g = 1; g < Top; g++)
            {
                double edge = g * Gearbox.ShiftUpPerGear;

                foreach (double kmh in new[] { edge - 0.01, edge, edge + 0.01 })
                {
                    int gear = g;
                    int shifts = Settle(ref gear, kmh, 400);

                    Assert.LessOrEqual(shifts, 1,
                        "gear " + g + " at " + kmh.ToString("F2") + " km/h shifted "
                        + shifts + " times in four hundred passes");
                }
            }
        }

        /// <summary>
        /// And does not hunt anywhere else either. Every gear, every speed a
        /// car reaches, in one km/h steps: whatever it settles on, it stays
        /// on. This is the sweep the boundary test above is a spot check of.
        /// </summary>
        [Test]
        public void SettlesEverywhereOnTheSpeedRange()
        {
            for (int start = 1; start <= Top; start++)
            {
                for (double kmh = 0; kmh <= 360; kmh += 1.0)
                {
                    int gear = start;
                    Settle(ref gear, kmh, 60);

                    // Settled means: one more look changes nothing.
                    Gearbox.Choose(gear, kmh / MathUtil.Kmh,
                        out bool up, out bool down);

                    bool stuck = (up && gear >= Top) || (down && gear <= 1);
                    Assert.IsTrue(!(up || down) || stuck,
                        "from " + start + " at " + kmh + " km/h it settled on "
                        + gear + " and still wants up=" + up + " down=" + down);
                }
            }
        }

        /// <summary>
        /// Never below first, and this is not tidiness. The drivetrain reads
        /// a downshift out of first as a request for <i>reverse</i> whenever
        /// the wheels are slow enough — which is exactly when a car is slow
        /// enough for this to fire.
        /// </summary>
        [Test]
        public void NeverAsksToGoBelowFirst()
        {
            foreach (double kmh in new[] { 0.0, 0.5, 5.0, 20.0, 41.0 })
            {
                Gearbox.Choose(1, kmh / MathUtil.Kmh, out bool _, out bool down);
                Assert.IsFalse(down, "asked to leave first at " + kmh + " km/h");
            }
        }

        /// <summary>
        /// Speed is a magnitude here: a car rolling backwards at thirty km/h
        /// is not in sixth.
        /// </summary>
        [Test]
        public void TreatsBackwardsTheSameAsForwards()
        {
            Gearbox.Choose(3, 100.0 / MathUtil.Kmh, out bool upF, out bool downF);
            Gearbox.Choose(3, -100.0 / MathUtil.Kmh, out bool upB, out bool downB);

            Assert.AreEqual(upF, upB);
            Assert.AreEqual(downF, downB);
        }

        /// <summary>
        /// A start stays in first until the car is actually moving — the
        /// whole reason this is on road speed and not rpm. On the limiter
        /// with the wheels spinning and the car stationary, an rpm trigger
        /// runs through all eight in half a second.
        /// </summary>
        [Test]
        public void StaysInFirstOnALaunch()
        {
            Gearbox.Choose(1, 0.0, out bool up, out bool down);
            Assert.IsFalse(up);
            Assert.IsFalse(down);
        }
    }
}
