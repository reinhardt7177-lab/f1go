using NUnit.Framework;

namespace MumuF1.Tests
{
    /// <summary>
    /// The bargain the booster offers, which has to hold without being
    /// explained to anybody.
    /// </summary>
    [TestFixture]
    public class BoosterTests
    {
        private static readonly BoosterParams P = new BoosterParams();

        /// <summary>Drive it cleanly for <paramref name="seconds"/> at speed.</summary>
        private static void Drive(Booster b, double seconds,
            bool onTrack = true, double sideslip = 0, double throttle = 0)
        {
            for (var t = 0.0; t < seconds; t += 0.02)
            {
                b.Update(0.02, onTrack, sideslip, 60, throttle, P);
            }
        }

        [Test]
        public void FillsOnCleanDrivingAndArms()
        {
            var b = new Booster();
            Assert.That(b.Armed, Is.False, "it starts armed");

            Drive(b, P.ChargeSeconds * 0.5);
            Assert.That(b.Charge, Is.EqualTo(0.5).Within(0.05));
            Assert.That(b.Armed, Is.False);

            Drive(b, P.ChargeSeconds * 0.6);
            Assert.That(b.Armed, Is.True, "clean driving never armed it");
        }

        /// <summary>
        /// Standing still is not driving well.
        /// </summary>
        /// <remarks>
        /// The most obvious way to break a reward for tidy driving is to
        /// award it for not driving. A car on the grid is perfectly on track,
        /// perfectly straight, and has earned nothing.
        /// </remarks>
        [Test]
        public void EarnsNothingParkedOnTheGrid()
        {
            var b = new Booster();
            for (var t = 0.0; t < 30; t += 0.02) b.Update(0.02, true, 0, 0, 0, P);

            Assert.That(b.Charge, Is.EqualTo(0).Within(1e-9));
            Assert.That(b.Armed, Is.False);
        }

        /// <summary>Leaving the circuit costs the lot.</summary>
        [Test]
        public void LosesEverythingOffTheTrack()
        {
            var b = new Booster();
            Drive(b, P.ChargeSeconds * 0.9);
            Assert.That(b.Charge, Is.GreaterThan(0.5));

            Drive(b, 0.2, onTrack: false);
            Assert.That(b.Charge, Is.EqualTo(0).Within(1e-9),
                "running off the road kept the reward");
        }

        /// <summary>
        /// A slide drains rather than wipes.
        /// </summary>
        /// <remarks>
        /// The asymmetry is the design. Going off is something you watch
        /// yourself do and losing it all reads as fair; a twitch of oversteer
        /// is as often the car as the driver, and charging seven seconds for
        /// one would teach a child to drive slowly rather than tidily.
        /// </remarks>
        [Test]
        public void OnlyDrainsWhileSliding()
        {
            var b = new Booster();
            Drive(b, P.ChargeSeconds);
            Assert.That(b.Charge, Is.EqualTo(1).Within(1e-6));

            Drive(b, 0.5, sideslip: P.CleanSideslip * 3);

            Assert.That(b.Charge, Is.LessThan(1.0), "sliding cost nothing");
            Assert.That(b.Charge, Is.GreaterThan(0.5), "one slide wiped it out");
        }

        /// <summary>
        /// Full throttle spends it, and it runs out.
        /// </summary>
        [Test]
        public void SpendsItselfOnFullThrottleAndExpires()
        {
            var b = new Booster();
            Drive(b, P.ChargeSeconds);

            var fired = b.Update(0.02, true, 0, 60, 1.0, P);
            Assert.That(fired, Is.True, "a full booster did not fire at full throttle");
            Assert.That(b.Deploying, Is.True);
            Assert.That(b.Charge, Is.EqualTo(0).Within(1e-9), "it fired and stayed full");

            Drive(b, P.DeploySeconds * 0.5, throttle: 1.0);
            Assert.That(b.Deploying, Is.True, "it expired early");

            Drive(b, P.DeploySeconds, throttle: 1.0);
            Assert.That(b.Deploying, Is.False, "it never expired");
        }

        /// <summary>Held short of full throttle, it waits.</summary>
        [Test]
        public void WaitsUntilTheThrottleMeansIt()
        {
            var b = new Booster();
            Drive(b, P.ChargeSeconds, throttle: 0.5);

            Assert.That(b.Armed, Is.True);
            Assert.That(b.Deploying, Is.False, "it fired without being asked");
        }

        /// <summary>Nothing is charged while it is being spent.</summary>
        /// <remarks>
        /// Otherwise a clean deployment tops itself up as it runs and the
        /// boost never ends, which is the obvious way for this to become the
        /// only way anybody drives.
        /// </remarks>
        [Test]
        public void DoesNotRefillWhileDeploying()
        {
            var b = new Booster();
            Drive(b, P.ChargeSeconds);
            b.Update(0.02, true, 0, 60, 1.0, P);

            Drive(b, P.DeploySeconds * 0.5, throttle: 1.0);
            Assert.That(b.Charge, Is.EqualTo(0).Within(1e-9));
        }

        /// <summary>
        /// The meter shows one thing before it fires and another after.
        /// </summary>
        /// <remarks>
        /// It lives on the booster rather than in the read-out so it cannot
        /// drift from the rule: a bar dividing by its own idea of how long a
        /// deployment lasts stays right until somebody changes the
        /// deployment and does not know the bar exists.
        /// </remarks>
        [Test]
        public void MeterFillsThenEmpties()
        {
            var b = new Booster();
            Assert.That(b.Meter, Is.EqualTo(0).Within(1e-9));

            Drive(b, P.ChargeSeconds * 0.5);
            Assert.That(b.Meter, Is.EqualTo(0.5).Within(0.05), "it does not show the charge");

            Drive(b, P.ChargeSeconds);
            b.Update(0.02, true, 0, 60, 1.0, P);
            Assert.That(b.Meter, Is.EqualTo(1).Within(0.02), "a fresh deployment shows empty");

            Drive(b, P.DeploySeconds * 0.5, throttle: 1.0);
            Assert.That(b.Meter, Is.EqualTo(0.5).Within(0.06), "it does not run down");

            Drive(b, P.DeploySeconds, throttle: 1.0);
            Assert.That(b.Meter, Is.EqualTo(0).Within(1e-9));
        }
    }
}
