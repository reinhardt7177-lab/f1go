using NUnit.Framework;

namespace MumuF1.Tests
{
    /// <summary>
    /// Where a tyre's temperature settles, which is the only thing about
    /// this model anybody feels.
    /// </summary>
    /// <remarks>
    /// There were no tests here at all, and the model was broken in the one
    /// way that matters: at racing pace it had no stable operating point
    /// below its own guard rail. The surface climbed until it hit the
    /// 260 °C clamp and stayed there — 226 °C measured on a flat-out lap of
    /// the practice oval, grip multiplier pinned at its 0.62 floor, on every
    /// circuit and in every session. A car that slid everywhere and got
    /// worse the longer anybody drove it.
    ///
    /// It survived because the loop it runs in is not in this file. Hotter
    /// means less grip, less grip means more slide to make the same force,
    /// and more slide is more heat: the gain lives in the tyre model and the
    /// runaway lives in the interaction between the two. Which is presumably
    /// why nobody wrote a unit test — from inside <c>Step</c> there is
    /// nothing wrong to see.
    ///
    /// So these do not try to reproduce the loop. They state the friction
    /// power directly, at three paces, and check three properties of where
    /// the temperature lands — that it is set by cooling rather than by the
    /// clamp, that it does not depend on what the tyre has been through, and
    /// that it still answers to how hard the car is driven. Those three are
    /// exactly what was wrong, and none of them needs a tyre.
    ///
    /// For the record, and not asserted here because asserting it would mean
    /// pinning an approximation of the tyre model rather than the tyre
    /// model: closing the loop by hand puts the working point at 90 °C with
    /// the grip multiplier at 0.98, reached from cold and from cooked alike.
    /// </remarks>
    [TestFixture]
    public class TireThermalTests
    {
        /// <summary>Watts a driven tyre dissipates flat out at 200 km/h.</summary>
        /// <remarks>
        /// Measured, not estimated, and the difference cost a round. The
        /// first version of this file guessed 11 kW from 4.5 kN of drive at
        /// four per cent slip, which is what a *healthy* tyre does — and a
        /// number taken from the state you are trying to reach is no use for
        /// working out whether you reach it. Driving the fixed build settled
        /// at 154 °C, and reading the load back out of that plateau against
        /// the cooling in force gives 42 kW.
        /// </remarks>
        private const double RacingWatts = 42_000;

        /// <summary>And wheelspinning in first, where there is no airflow.</summary>
        /// <remarks>
        /// Less power than racing and far hotter, which is the whole point of
        /// pairing it with a speed. Cooling scales with how fast the patch is
        /// moving over fresh road, so the way to ruin a set of tyres is to
        /// sit still and spin them — not to go quickly, which is the one
        /// thing that cools them.
        /// </remarks>
        private const double SpinningWatts = 30_000;

        /// <summary>Ambling: an out-lap, or coasting to the pits.</summary>
        private const double AmblingWatts = 1_200;

        /// <summary>
        /// Surface temperature after <paramref name="seconds"/> at a steady
        /// pace.
        /// </summary>
        private static double Settle(double watts, double airspeed, double from, double seconds)
        {
            var p = new TireThermalParams();
            var c = new TireCondition { SurfaceTemp = from, CoreTemp = from };

            for (var t = 0.0; t < seconds; t += 0.02)
            {
                TireThermal.Step(p, c, watts, airspeed, 0.02, true);
            }

            return c.SurfaceTemp;
        }

        /// <summary>
        /// The clamp is a backstop, not an operating point.
        /// </summary>
        /// <remarks>
        /// This is the regression, stated as plainly as it can be. <c>Step</c>
        /// clamps the surface at 260 °C so that a bad number cannot become an
        /// infinity, and with the cooling this shipped with, that clamp was
        /// where every sustained run ended up: the guard rail doing duty as
        /// the model.
        /// </remarks>
        [Test]
        public void DoesNotRunAwayToTheClamp()
        {
            Assert.That(Settle(RacingWatts, 55, 26, 400), Is.LessThan(125),
                "racing pace alone cooks the tyre");
            Assert.That(Settle(SpinningWatts, 12, 26, 2000), Is.LessThan(255),
                "even ruined, the temperature has to be a result and not a clamp");
        }

        /// <summary>
        /// Where it ends up does not depend on where it has been.
        /// </summary>
        /// <remarks>
        /// The property the cooling constant was actually chosen for, and
        /// the reason it is not merely set just past the point where the
        /// runaway stops. In the band immediately above that point the model
        /// has two stable answers at the same pace: a tyre that starts cold
        /// settles correctly, and a tyre that has already been cooked stays
        /// cooked for ever. Losing the car once and never getting it back is
        /// worse than the runaway — at least the runaway happens to
        /// everybody equally.
        ///
        /// Given a long enough run, because the core carries most of the
        /// heat and sheds it slowly on purpose. Half an hour is far past any
        /// race here and the point is that the two answers are the same one,
        /// not how fast they get there.
        /// </remarks>
        [Test]
        public void ForgetsWhatItHasBeenThrough()
        {
            var fromCold = Settle(RacingWatts, 55, 26, 3000);
            var fromCooked = Settle(RacingWatts, 55, 240, 3000);

            Assert.That(fromCooked, Is.EqualTo(fromCold).Within(1.0),
                "an overheated tyre never comes back");
        }

        /// <summary>
        /// And it still answers to how hard the car is being driven.
        /// </summary>
        /// <remarks>
        /// The other half, and the one a fix for the first can quietly
        /// destroy: cooling generous enough to stop a runaway is cooling
        /// generous enough to stop the tyres ever warming up, and a model
        /// whose temperature does not depend on the driving is as useless as
        /// one that always ends at the clamp. An out-lap has to leave them
        /// cold and slow, and the way to warm them has to be to use them.
        /// </remarks>
        [Test]
        public void TracksHowHardItIsDriven()
        {
            var p = new TireThermalParams();

            var ambling = Settle(AmblingWatts, 30, p.AmbientTemp, 2000);
            var racing = Settle(RacingWatts, 55, p.AmbientTemp, 2000);
            var spinning = Settle(SpinningWatts, 12, p.AmbientTemp, 2000);

            Assert.That(ambling, Is.LessThan(racing));
            Assert.That(racing, Is.LessThan(spinning));

            Assert.That(ambling, Is.LessThan(p.OptimalTemp - p.TempWindow),
                "tyres reach their working range without being worked");
            Assert.That(racing, Is.InRange(p.OptimalTemp - p.TempWindow, p.OptimalTemp + p.TempWindow),
                "driving the car as it is meant to be driven does not put the "
                + "tyres in their working range");
            Assert.That(spinning, Is.GreaterThan(p.OptimalTemp + p.TempWindow),
                "sitting still spinning the wheels does not overheat them");

            Assert.That(TireThermal.ThermalGrip(p, ambling, 0), Is.LessThan(0.95),
                "cold tyres grip as well as warm ones");
            Assert.That(TireThermal.ThermalGrip(p, racing, 0), Is.GreaterThan(0.95),
                "a tyre at its working temperature has lost grip to heat");
            Assert.That(TireThermal.ThermalGrip(p, spinning, 0), Is.LessThan(0.8),
                "wrecked tyres grip much like good ones");
        }

        /// <summary>An airborne tyre cools rather than doing nothing.</summary>
        [Test]
        public void CoolsWhileItIsOffTheGround()
        {
            var p = new TireThermalParams();
            var c = new TireCondition { SurfaceTemp = 140, CoreTemp = 140 };

            for (var t = 0.0; t < 20; t += 0.02)
            {
                TireThermal.Step(p, c, 0, 60, 0.02, false);
            }

            Assert.That(c.SurfaceTemp, Is.LessThan(140));
            Assert.That(c.SurfaceTemp, Is.GreaterThan(p.AmbientTemp));
        }
    }
}
