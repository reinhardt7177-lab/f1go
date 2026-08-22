using System;
using NUnit.Framework;

namespace MumuF1.Tests
{
    /// <summary>
    /// The regime the slip curve cannot answer: a car that is not moving.
    /// </summary>
    /// <remarks>
    /// These are written as small integrations rather than single calls,
    /// because every claim being made here is about what happens over time —
    /// that a car holds still, that it holds still on a slope, that it does
    /// not ring while doing it. A single call cannot fail any of those.
    /// </remarks>
    public class StictionTests
    {
        private const double Dt = 1.0 / 50.0;
        private const double Mass = 798.0;
        private const double Load = Mass * 9.81 / 4.0;

        private static readonly TireParams Rubber = new TireParams();

        private static double Peak(double load) => Tire.PeakForce(Rubber, load);

        /// <summary>
        /// A patch that is not sliding is not pushing. Anything else would
        /// mean a car at rest with a force on it out of nowhere.
        /// </summary>
        [Test]
        public void StillPatchPushesNothing()
        {
            var p = new StictionParams();
            var s = new StictionState();

            for (int i = 0; i < 200; i++)
            {
                TireForces f = Stiction.Solve(p, ref s, 0, 0, Load, Peak(Load), Dt);
                Assert.AreEqual(0.0, f.Long, 1e-9);
                Assert.AreEqual(0.0, f.Lat, 1e-9);
            }
        }

        /// <summary>
        /// The one that matters: a car with something pushing it sideways
        /// stays where it is.
        /// </summary>
        /// <remarks>
        /// A sideways push of one and a half per cent of the car's weight —
        /// the sort of thing a banked circuit, a faceted road mesh or a
        /// resting solver produces, and which one of them it was has never
        /// been pinned down. It did not need to be: before this existed the
        /// measured answer on the grid was 1.96 m of drift in 9.2 s, because
        /// four patches were returning exactly zero whatever the push. The
        /// bar here is a centimetre over ten seconds.
        /// </remarks>
        [Test]
        public void HoldsTheCarOnACamberedRoad()
        {
            var p = new StictionParams();
            var s = new[] { new StictionState(), new StictionState(), new StictionState(), new StictionState() };

            double side = Mass * 9.81 * 0.015;   // N, sideways, and never stopping
            double v = 0, x = 0;

            for (int i = 0; i < 500; i++)       // ten seconds
            {
                double total = 0;
                for (int w = 0; w < 4; w++)
                {
                    total += Stiction.Solve(p, ref s[w], 0, v, Load, Peak(Load), Dt).Lat;
                }

                v += (side + total) / Mass * Dt;
                x += v * Dt;
            }

            Assert.Less(Math.Abs(x), 0.01, "drifted " + x.ToString("F4") + " m in ten seconds");
        }

        /// <summary>
        /// And it settles, which is the failure this shape of fix invites: a
        /// spring stiff enough to hold a car is a spring stiff enough to
        /// bounce it, and a bouncing car is the wobble that started all this.
        /// </summary>
        /// <remarks>
        /// It does cross zero a few times on the way down — nine, measured —
        /// and counting those would be measuring the wrong thing. What
        /// matters is that the whole excursion is under a centimetre and that
        /// it is over: a second in, the fastest the car is still moving is
        /// three hundredths of a millimetre a second.
        /// </remarks>
        [Test]
        public void SettlesAfterAShove()
        {
            var p = new StictionParams();
            var s = new[] { new StictionState(), new StictionState(), new StictionState(), new StictionState() };

            double v = 0.3;                     // shoved sideways
            double x = 0, worst = 0, after = 0;

            for (int i = 0; i < 250; i++)       // five seconds
            {
                double total = 0;
                for (int w = 0; w < 4; w++)
                {
                    total += Stiction.Solve(p, ref s[w], 0, v, Load, Peak(Load), Dt).Lat;
                }

                v += total / Mass * Dt;
                x += v * Dt;

                if (Math.Abs(x) > worst) worst = Math.Abs(x);
                if (i > 50 && Math.Abs(v) > after) after = Math.Abs(v);
            }

            Assert.Less(worst, 0.02, "swung " + worst.ToString("F4") + " m");
            Assert.Less(after, 0.001, "still moving at " + after.ToString("E2") + " m/s after a second");
        }

        /// <summary>
        /// Yaw is the mode with the least margin — four patches on long
        /// levers against an inertia only half again the mass — and it is
        /// also where this went wrong once. An earlier version faded the
        /// force instead of the ceiling, so the anchors banked spring while
        /// they were barely allowed to push and paid it all back the instant
        /// the car slowed: a car settling through half a degree was flicked
        /// to half a radian a second in one tick. Hence the assertion that
        /// the yaw rate never *exceeds* what it started with. A spring that
        /// gives back more than it was given fails that line and nothing
        /// else in this file catches it.
        /// </summary>
        [Test]
        public void NeverGivesBackMoreYawThanItWasGiven()
        {
            // Front axle ahead of the CG, rear behind it, as the car is built.
            double[] arm = { 1.98, 1.98, -1.62, -1.62 };
            const double Izz = 1100.0;

            foreach (double seed in new[] { 0.05, 0.15, 0.30 })
            {
                var p = new StictionParams();
                var s = new[] { new StictionState(), new StictionState(), new StictionState(), new StictionState() };

                double rate = seed, angle = 0, worst = 0;

                for (int i = 0; i < 500; i++)   // ten seconds
                {
                    double torque = 0;
                    for (int w = 0; w < 4; w++)
                    {
                        // A patch on a lever arm sees a sideways speed of r * omega.
                        double slide = arm[w] * rate;
                        torque += Stiction.Solve(p, ref s[w], 0, slide, Load, Peak(Load), Dt).Lat * arm[w];
                    }

                    rate += torque / Izz * Dt;
                    angle += rate * Dt;
                    if (Math.Abs(rate) > worst) worst = Math.Abs(rate);
                }

                Assert.LessOrEqual(worst, seed + 1e-9,
                    "seeded " + seed + " rad/s and reached " + worst.ToString("F4"));
                Assert.Less(Math.Abs(rate), 1e-3,
                    "seeded " + seed + " and still turning at " + rate.ToString("E2") + " rad/s");
                Assert.Less(Math.Abs(angle), 0.01,
                    "seeded " + seed + " and rotated " + angle.ToString("F4") + " rad");
            }
        }

        /// <summary>
        /// Push harder than the road can hold and the patch lets go. Without
        /// this the anchor would be a tow rope: infinite grip at zero speed,
        /// and a car that cannot be pushed off a kerb.
        /// </summary>
        [Test]
        public void LetsGoAtTheFrictionCircle()
        {
            var p = new StictionParams();
            var s = new StictionState();
            double peak = Peak(Load);

            TireForces f = default;
            for (int i = 0; i < 100; i++)
            {
                f = Stiction.Solve(p, ref s, 0, 0.2, Load, peak, Dt);
            }

            /* The ceiling closes with speed, so at a fifth of a metre a
               second it is not the whole friction circle but the fraction of
               it this regime still owns. Checked against that rather than
               against the circle, because the number that matters is the one
               the patch is actually pinned to. */
            double ceiling = p.Hold * peak * (1.0 - 0.2 / p.CrawlSpeed);

            Assert.IsFalse(s.Stuck, "should have let go");
            Assert.AreEqual(ceiling, Math.Abs(f.Lat), 1.0, "should be pinned at the ceiling");
            Assert.AreEqual(1.0, f.GripUsage, 1e-6, "and should say so");
        }

        /// <summary>
        /// A wheel spinning up under power slides its patch *backwards*, so
        /// the force must come out pushing the car forwards. Keyed to the
        /// chassis instead of the patch this would have been a handbrake on
        /// every start.
        /// </summary>
        [Test]
        public void PushesTheCarWhenTheWheelDrivesIt()
        {
            var p = new StictionParams();
            var s = new StictionState();

            // Wheel laying down 0.2 m/s more than the car is doing.
            TireForces f = Stiction.Solve(p, ref s, -0.2, 0, Load, Peak(Load), Dt);

            Assert.Greater(f.Long, 0.0, "should push the car forward, got " + f.Long);
        }

        /// <summary>
        /// And it is gone by the time the slip model can answer, so the two
        /// never add up into grip neither of them has.
        /// </summary>
        [Test]
        public void FadesOutByTheCrawl()
        {
            var p = new StictionParams();
            var s = new StictionState();

            for (int i = 0; i < 50; i++)
            {
                Stiction.Solve(p, ref s, 0, p.CrawlSpeed, Load, Peak(Load), Dt);
            }

            TireForces f = Stiction.Solve(p, ref s, 0, p.CrawlSpeed, Load, Peak(Load), Dt);
            Assert.AreEqual(0.0, f.Lat, 1e-9);

            TireForces past = Stiction.Solve(p, ref s, 0, p.CrawlSpeed * 3, Load, Peak(Load), Dt);
            Assert.AreEqual(0.0, past.Lat, 1e-9);
        }

        /// <summary>An airborne wheel holds nothing and remembers nothing.</summary>
        [Test]
        public void AirborneWheelForgetsItsAnchor()
        {
            var p = new StictionParams();
            var s = new StictionState();

            for (int i = 0; i < 10; i++)
            {
                Stiction.Solve(p, ref s, 0, 0.05, Load, Peak(Load), Dt);
            }
            Assert.AreNotEqual(0.0, s.StretchLat);

            TireForces f = Stiction.Solve(p, ref s, 0, 0.05, 0, 0, Dt);

            Assert.AreEqual(0.0, f.Lat, 1e-12);
            Assert.AreEqual(0.0, s.StretchLat, 1e-12);
            Assert.IsFalse(s.Stuck);
        }
    }
}
