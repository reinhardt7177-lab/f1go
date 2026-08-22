using NUnit.Framework;

namespace MumuF1.Tests
{
    [TestFixture]
    public class SuspensionTests
    {
        private readonly SuspensionParams _p = new SuspensionParams();

        [Test]
        public void PushesBackAgainstCompressionAndNeverPulls()
        {
            // A spring can push the wheel down but never pull the car
            // down: a fully extended corner carries nothing.
            Assert.That(Suspension.Force(_p.StiffnessFront, 0, 0.02, 0, _p.MaxTravel),
                Is.GreaterThan(0));
            Assert.That(Suspension.Force(_p.StiffnessFront, 0, -0.02, 0, _p.MaxTravel),
                Is.EqualTo(0.0));
        }

        [Test]
        public void CarriesTheCornerLoadWithinItsTravel()
        {
            // At 300 km/h each corner has to carry about 6.6 kN without
            // running out of travel — the whole reason the rates are
            // sized against downforce rather than weight.
            double atHalfTravel = Suspension.Force(
                _p.StiffnessFront, 0, _p.MaxTravel * 0.5, 0, _p.MaxTravel);
            Assert.That(atHalfTravel, Is.GreaterThan(6_000));
        }

        [Test]
        public void BumpStopIsMuchStifferButStillBounded()
        {
            double atStop = Suspension.Force(
                _p.StiffnessFront, 0, _p.MaxTravel, 0, _p.MaxTravel);
            double past = Suspension.Force(
                _p.StiffnessFront, 0, _p.MaxTravel + 0.01, 0, _p.MaxTravel);

            Assert.That(past, Is.GreaterThan(atStop));

            // Bounded, because an unbounded stop is how the car was once
            // fired off the circuit at 300 m/s.
            Assert.That(past, Is.LessThanOrEqualTo(Suspension.MaxCornerForce));
        }

        [Test]
        public void NoCornerEverExceedsTheCeiling()
        {
            for (double c = -0.3; c <= 0.3; c += 0.005)
            {
                for (double v = -20; v <= 20; v += 1)
                {
                    double f = Suspension.Force(
                        _p.StiffnessRear, _p.DampingRear, c, v, _p.MaxTravel);
                    Assert.That(f, Is.InRange(0.0, Suspension.MaxCornerForce));
                }
            }
        }

        [Test]
        public void DampingOpposesTheDirectionOfTravel()
        {
            double still = Suspension.Force(_p.StiffnessFront, _p.DampingFront, 0.02, 0, _p.MaxTravel);
            double compressing = Suspension.Force(_p.StiffnessFront, _p.DampingFront, 0.02, 1, _p.MaxTravel);
            double extending = Suspension.Force(_p.StiffnessFront, _p.DampingFront, 0.02, -1, _p.MaxTravel);

            Assert.That(compressing, Is.GreaterThan(still));
            Assert.That(extending, Is.LessThan(still));
        }

        [Test]
        public void AntiRollBarOpposesRollAndVanishesWhenLevel()
        {
            Assert.That(Suspension.AntiRoll(_p.AntiRollFront, 0.03, 0.03), Is.EqualTo(0.0));

            // Right compressed more than left: the bar pushes the left
            // corner down, so the contribution added at the left is
            // positive and the one subtracted at the right is its mirror.
            double rolled = Suspension.AntiRoll(_p.AntiRollFront, 0.01, 0.05);
            Assert.That(rolled, Is.GreaterThan(0));
            Assert.That(Suspension.AntiRoll(_p.AntiRollFront, 0.05, 0.01),
                Is.EqualTo(-rolled).Within(1e-9));
        }

        [Test]
        public void AFrontBiasedBarIsStifferThanTheRear()
        {
            // Which is what makes the default balance the one it is: the
            // front bar carries more, so the front axle's outside tyre
            // takes more load and load sensitivity costs it grip.
            Assert.That(_p.AntiRollFront, Is.GreaterThan(_p.AntiRollRear));
        }
    }
}
