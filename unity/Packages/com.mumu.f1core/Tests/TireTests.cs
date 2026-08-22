using System;
using NUnit.Framework;

namespace MumuF1.Tests
{
    /// <summary>
    /// The tyre model, ported from <c>f1sim/tests/tire.test.ts</c>.
    /// </summary>
    /// <remarks>
    /// These are the same assertions against the same numbers as the
    /// TypeScript they came from, deliberately: the point of porting the
    /// tests alongside the code is that they answer the one question a
    /// port has to answer — is it still the same car? A test that was
    /// weakened to make the port pass would be answering nothing.
    ///
    /// This file references only NUnit and MumuF1.Core, so it runs both
    /// in Unity's Test Runner and under a plain <c>dotnet test</c> with
    /// no editor and no licence.
    /// </remarks>
    [TestFixture]
    public class TireTests
    {
        private readonly TireParams _p = new TireParams();

        // ---- magic formula ------------------------------------------

        [Test]
        public void ProducesNoForceAtZeroSlip()
        {
            Assert.That(Tire.MagicFormula(0, _p.LatB, _p.LatC, _p.LatE), Is.EqualTo(0.0));
        }

        [Test]
        public void IsOddAboutZero()
        {
            double a = Tire.MagicFormula(0.08, _p.LatB, _p.LatC, _p.LatE);
            double b = Tire.MagicFormula(-0.08, _p.LatB, _p.LatC, _p.LatE);
            Assert.That(a, Is.EqualTo(-b).Within(1e-12));
        }

        [Test]
        public void PeaksNearTheDocumentedSlipAngleAndThenFallsAway()
        {
            double peakSlip = 0, peakValue = 0;
            for (double slip = 0; slip < 0.5; slip += 0.001)
            {
                double v = Tire.MagicFormula(slip, _p.LatB, _p.LatC, _p.LatE);
                if (v > peakValue) { peakValue = v; peakSlip = slip; }
            }

            // Within a degree of the constant the combined-slip maths relies on.
            Assert.That(peakSlip * MathUtil.Deg,
                Is.EqualTo(Tire.SlipAngleAtPeak * MathUtil.Deg).Within(0.5));

            // Past the peak the tyre gives up grip — this is what makes a
            // slide recoverable or not, so it must actually be modelled.
            Assert.That(Tire.MagicFormula(0.35, _p.LatB, _p.LatC, _p.LatE),
                Is.LessThan(peakValue));
        }

        // ---- load sensitivity ---------------------------------------

        [Test]
        public void ReducesTheFrictionCoefficientAsLoadRises()
        {
            double light = Tire.MuAtLoad(_p, _p.LoadReference * 0.5);
            double nominal = Tire.MuAtLoad(_p, _p.LoadReference);
            double heavy = Tire.MuAtLoad(_p, _p.LoadReference * 2);

            Assert.That(light, Is.GreaterThan(nominal));
            Assert.That(nominal, Is.GreaterThan(heavy));
            Assert.That(nominal, Is.EqualTo(_p.MuNominal).Within(1e-10));
        }

        [Test]
        public void DoublingLoadGivesLessThanDoubleTheGrip()
        {
            double single = Tire.MuAtLoad(_p, 3000) * 3000;
            double doubled = Tire.MuAtLoad(_p, 6000) * 6000;
            Assert.That(doubled, Is.LessThan(single * 2));
        }

        [Test]
        public void NeverLetsTheCoefficientCollapseToZero()
        {
            Assert.That(Tire.MuAtLoad(_p, 500_000), Is.GreaterThan(0.3));
        }

        // ---- solve ---------------------------------------------------

        [Test]
        public void ProducesNothingWithoutLoad()
        {
            TireForces f = Tire.Solve(_p, 0.1, 0.1, 0);
            Assert.That(f.Long, Is.EqualTo(0.0));
            Assert.That(f.Lat, Is.EqualTo(0.0));
        }

        [Test]
        public void OpposesLateralSlip()
        {
            // Slip to the right should generate force to the left.
            Assert.That(Tire.Solve(_p, 0, 5 * MathUtil.Rad, 3000).Lat, Is.LessThan(0));
            Assert.That(Tire.Solve(_p, 0, -5 * MathUtil.Rad, 3000).Lat, Is.GreaterThan(0));
        }

        [Test]
        public void DrivesTheCarForwardUnderPositiveSlipRatio()
        {
            Assert.That(Tire.Solve(_p, 0.1, 0, 3000).Long, Is.GreaterThan(0));
            Assert.That(Tire.Solve(_p, -0.1, 0, 3000).Long, Is.LessThan(0));
        }

        [Test]
        public void ReducesToThePureCurveOnEachAxis()
        {
            TireForces pureLat = Tire.Solve(_p, 0, Tire.SlipAngleAtPeak, 3000);
            double expected = -Tire.MagicFormula(
                    Tire.SlipAngleAtPeak, _p.LatB, _p.LatC, _p.LatE)
                * Tire.MuAtLoad(_p, 3000) * 3000;

            Assert.That(pureLat.Lat, Is.EqualTo(expected).Within(1e-6));
        }

        [Test]
        public void SharesOneGripBudgetBetweenBrakingAndCornering()
        {
            const double load = 3000;
            double pureLat = Math.Abs(Tire.Solve(_p, 0, Tire.SlipAngleAtPeak, load).Lat);
            TireForces combined = Tire.Solve(_p, -0.12, Tire.SlipAngleAtPeak, load);

            // Braking hard at peak slip angle must cost lateral grip.
            Assert.That(Math.Abs(combined.Lat), Is.LessThan(pureLat));

            // And the resultant must stay inside the friction circle.
            double resultant = MathUtil.Hypot(combined.Long, combined.Lat);
            double available = Tire.MuAtLoad(_p, load) * load;
            Assert.That(resultant, Is.LessThanOrEqualTo(available * 1.02));
        }

        [Test]
        public void NeverExceedsTheFrictionCircleAtAnySlipCombination()
        {
            const double load = 4200;
            double available = Tire.MuAtLoad(_p, load) * load;

            for (double ratio = -1; ratio <= 1; ratio += 0.05)
            {
                for (double angle = -0.6; angle <= 0.6; angle += 0.03)
                {
                    TireForces f = Tire.Solve(_p, ratio, angle, load);
                    Assert.That(MathUtil.Hypot(f.Long, f.Lat),
                        Is.LessThanOrEqualTo(available * 1.02),
                        $"ratio {ratio:F2}, angle {angle:F2}");
                }
            }
        }
    }
}
