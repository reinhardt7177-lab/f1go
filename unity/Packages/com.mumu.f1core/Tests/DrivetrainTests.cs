using NUnit.Framework;

namespace MumuF1.Tests
{
    [TestFixture]
    public class DrivetrainTests
    {
        private static Drivetrain Fresh() => new Drivetrain();

        [Test]
        public void TorqueRisesToThePeakAndFallsAwayToTheRedline()
        {
            var p = new DrivetrainParams();
            double atIdle = Drivetrain.EngineTorque(p, p.IdleRpm);
            double atPeak = Drivetrain.EngineTorque(p, p.PeakTorqueRpm);
            double atRedline = Drivetrain.EngineTorque(p, p.RedlineRpm);

            Assert.That(atPeak, Is.EqualTo(p.PeakTorque).Within(1e-9));
            Assert.That(atIdle, Is.LessThan(atPeak));
            Assert.That(atRedline, Is.LessThan(atPeak));

            // Still pulling hard at the limiter — this is a racing engine,
            // not one that falls off a cliff.
            Assert.That(atRedline,
                Is.EqualTo(p.PeakTorque * p.RedlineTorqueFraction).Within(1e-9));
        }

        [Test]
        public void MakesTheHorsepowerTheCarWasGearedFor()
        {
            // Roughly 800 kW, which is what the aero's terminal speeds
            // were solved against.
            Drivetrain.PeakPower(new DrivetrainParams(), out double watts, out double atRpm);
            Assert.That(watts / 1000.0, Is.EqualTo(797.0).Within(25.0));
            Assert.That(atRpm, Is.GreaterThan(12_000));
        }

        [Test]
        public void ShiftsUpThroughTheBoxAndStopsAtTheTop()
        {
            var d = Fresh();
            for (int i = 0; i < 20; i++)
            {
                d.Step(1, true, false, false, 200, 200, 1.0);
            }
            Assert.That(d.Gear, Is.EqualTo(d.Params.GearRatios.Length));
        }

        [Test]
        public void WillNotSelectReverseAtSpeed()
        {
            var d = Fresh();
            // Rolling fast, asking for down-shifts: it must stop at first
            // and never drop into reverse, or a downshift chain at the end
            // of a straight would be a gearbox rebuild.
            for (int i = 0; i < 20; i++) d.Step(0, false, true, false, 200, 200, 1.0);
            Assert.That(d.Gear, Is.EqualTo(1));

            // At walking pace it is allowed.
            for (int i = 0; i < 3; i++) d.Step(0, false, true, false, 0.5, 0.5, 1.0);
            Assert.That(d.Gear, Is.EqualTo(Drivetrain.Reverse));
        }

        [Test]
        public void CutsTorqueWhileTheGearboxIsMidShift()
        {
            var d = Fresh();
            DriveTorques shifting = d.Step(1, true, false, false, 150, 150, 0.001);
            Assert.That(shifting.Left + shifting.Right, Is.EqualTo(0.0).Within(1e-9));
        }

        [Test]
        public void OnePressOfOvertakeIsOneSlugOfEnergy()
        {
            var d = Fresh();
            double before = d.ErsStore;

            // Held down for a full second: it must spend one activation's
            // worth and no more, however long the button is held.
            for (int i = 0; i < 100; i++) d.Step(1, false, false, true, 300, 300, 0.01);

            double spent = before - d.ErsStore;
            Assert.That(spent, Is.LessThanOrEqualTo(d.Params.OvertakeEnergyPerUse + 1e-6));
            Assert.That(spent, Is.GreaterThan(0));
        }

        [Test]
        public void WillNotRearmOvertakeUntilTheButtonIsReleased()
        {
            var d = Fresh();
            for (int i = 0; i < 200; i++) d.Step(1, false, false, true, 300, 300, 0.01);
            double held = d.ErsStore;

            // Released, then pressed again: now a second slug is allowed.
            d.Step(1, false, false, false, 300, 300, 0.01);
            for (int i = 0; i < 100; i++) d.Step(1, false, false, true, 300, 300, 0.01);

            Assert.That(d.ErsStore, Is.LessThan(held));
        }

        [Test]
        public void BrakesAreBiasedForward()
        {
            var d = Fresh();
            d.BrakeTorques(1.0, out double front, out double rear);
            Assert.That(front, Is.GreaterThan(rear));
            Assert.That(front * 2 + rear * 2,
                Is.EqualTo(d.Params.BrakeTorqueTotal).Within(1e-9));

            d.BrakeTorques(0.0, out double noFront, out double noRear);
            Assert.That(noFront, Is.EqualTo(0.0));
            Assert.That(noRear, Is.EqualTo(0.0));
        }

        [Test]
        public void TheDifferentialSendsTorqueToTheSlowerWheel()
        {
            var d = Fresh();

            /* 60 rad/s in first is about 10,400 rpm — on the power and
               well inside the limiter. The first version of this test
               used 220, which through first gear is 38,000 rpm: the
               limiter correctly cut the torque to zero and both wheels
               got nothing, so the test failed on inputs no car could
               reach rather than on anything being wrong. */
            DriveTorques t = d.Step(1, false, false, false, 60, 55, 1.0 / 120);

            // Left spinning faster than right, so the locking diff biases
            // torque towards the right — which is what stops a rear-drive
            // car lighting up the inside tyre on corner exit.
            Assert.That(t.Left + t.Right, Is.GreaterThan(0), "should be making torque at all");
            Assert.That(t.Right, Is.GreaterThan(t.Left));
        }

        [Test]
        public void TheLimiterCutsTorqueRatherThanPullingHarder()
        {
            var d = Fresh();
            // First gear at 220 rad/s is 38,000 rpm. Nothing may come out
            // of that but zero.
            DriveTorques t = d.Step(1, false, false, false, 220, 220, 1.0 / 120);
            Assert.That(t.Left, Is.EqualTo(0.0));
            Assert.That(t.Right, Is.EqualTo(0.0));
            Assert.That(d.Rpm, Is.EqualTo(d.Params.RedlineRpm).Within(1e-9));
        }

        [Test]
        public void RecoveryFillsTheStoreButNeverOverfillsIt()
        {
            var d = Fresh();
            d.ErsStore = 0;
            d.RecoverEnergy(100_000, 1.0);
            Assert.That(d.ErsStore, Is.EqualTo(100_000 * d.Params.ErsRecoveryEfficiency).Within(1e-6));

            d.RecoverEnergy(1e12, 1.0);
            Assert.That(d.ErsStore, Is.EqualTo(d.Params.ErsCapacity).Within(1e-6));
        }
    }
}
