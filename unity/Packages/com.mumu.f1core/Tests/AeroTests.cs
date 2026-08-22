using NUnit.Framework;

namespace MumuF1.Tests
{
    /// <summary>
    /// Aerodynamics: the thing that makes this an F1 car rather than a
    /// fast car. Every assertion here is one of the claims the model's
    /// own documentation makes, turned into arithmetic.
    /// </summary>
    [TestFixture]
    public class AeroTests
    {
        private readonly AeroParams _p = new AeroParams();

        [Test]
        public void DownforceGrowsWithTheSquareOfSpeed()
        {
            // The whole point: doubling speed quadruples the grip
            // available, which is why a corner that is impossible at
            // 150 km/h is flat at 250.
            double at50 = Aero.Solve(_p, 50, AeroMode.Corner).Downforce;
            double at100 = Aero.Solve(_p, 100, AeroMode.Corner).Downforce;
            Assert.That(at100 / at50, Is.EqualTo(4.0).Within(1e-9));
        }

        [Test]
        public void MakesNothingAtRest()
        {
            AeroForces f = Aero.Solve(_p, 0, AeroMode.Corner);
            Assert.That(f.Downforce, Is.EqualTo(0.0));
            Assert.That(f.Drag, Is.EqualTo(0.0));
        }

        [Test]
        public void DragsTheSameGoingBackwards()
        {
            Assert.That(Aero.Solve(_p, -40, AeroMode.Corner).Drag,
                Is.EqualTo(Aero.Solve(_p, 40, AeroMode.Corner).Drag).Within(1e-9));
        }

        [Test]
        public void StraightModeTradesDownforceForDrag()
        {
            AeroForces corner = Aero.Solve(_p, 80, AeroMode.Corner);
            AeroForces straight = Aero.Solve(_p, 80, AeroMode.Straight);

            Assert.That(straight.Drag, Is.LessThan(corner.Drag));
            Assert.That(straight.Downforce, Is.LessThan(corner.Downforce));

            // And the trade is the deliberately steep one of the 2026
            // rules — more downforce given up than drag saved, which is
            // what makes using it a decision rather than free speed.
            double dragSaved = 1 - straight.Drag / corner.Drag;
            double downforceLost = 1 - straight.Downforce / corner.Downforce;
            Assert.That(downforceLost, Is.GreaterThan(dragSaved));
        }

        [Test]
        public void SplitsDownforceAcrossTheAxles()
        {
            AeroForces f = Aero.Solve(_p, 70, AeroMode.Corner);
            Assert.That(f.DownforceFront + f.DownforceRear,
                Is.EqualTo(f.Downforce).Within(1e-9));
            // Rearward balance, as a modern car has.
            Assert.That(f.DownforceFront, Is.LessThan(f.DownforceRear));
        }

        [Test]
        public void GroundEffectPeaksAtTheOptimalHeightAndStallsBelowIt()
        {
            double faded = Aero.GroundEffect(_p, _p.GroundEffectRange + 0.05);
            double optimal = Aero.GroundEffect(_p, _p.OptimalRideHeight);
            double stalled = Aero.GroundEffect(_p, _p.StallRideHeight * 0.5);

            Assert.That(faded, Is.EqualTo(1.0));
            Assert.That(optimal, Is.EqualTo(_p.GroundEffectGain).Within(1e-9));
            Assert.That(stalled, Is.EqualTo(_p.StallLoss).Within(1e-9));

            // The collapse below the optimum is what porpoising is made
            // of, so it has to actually be there.
            Assert.That(stalled, Is.LessThan(optimal * 0.5));
        }

        [Test]
        public void GroundEffectRisesMonotonicallyDownToTheOptimum()
        {
            double last = 0;
            for (double h = _p.GroundEffectRange; h >= _p.OptimalRideHeight; h -= 0.001)
            {
                double g = Aero.GroundEffect(_p, h);
                Assert.That(g, Is.GreaterThanOrEqualTo(last - 1e-12));
                last = g;
            }
        }

        [Test]
        public void LosesFrontDownforceWhenOnlyTheFrontIsBottoming()
        {
            // A car bottoming at the front and riding high at the rear
            // must lose front downforce specifically — the balance moves
            // rearward and it understeers, as it does in reality.
            AeroForces even = Aero.Solve(_p, 80, AeroMode.Corner,
                _p.OptimalRideHeight, _p.OptimalRideHeight);
            AeroForces noseDown = Aero.Solve(_p, 80, AeroMode.Corner,
                _p.StallRideHeight * 0.5, _p.OptimalRideHeight);

            Assert.That(noseDown.DownforceFront, Is.LessThan(even.DownforceFront));
            Assert.That(noseDown.DownforceRear, Is.EqualTo(even.DownforceRear).Within(1e-9));
        }

        [Test]
        public void TerminalSpeedLandsWhereTheCarWasGearedFor()
        {
            // 797 kW is what the power unit makes. Corner mode should be
            // drag-limited around 336 km/h and straight mode around 370 —
            // the numbers the gearing was chosen against.
            double corner = Aero.TerminalSpeed(_p, 797_000, AeroMode.Corner) * MathUtil.Kmh;
            double straight = Aero.TerminalSpeed(_p, 797_000, AeroMode.Straight) * MathUtil.Kmh;

            Assert.That(corner, Is.EqualTo(336.0).Within(6.0));
            Assert.That(straight, Is.EqualTo(370.0).Within(6.0));
        }
    }
}
