using System;
using NUnit.Framework;

namespace MumuF1.Tests
{
    /// <summary>
    /// Traction control, ported from <c>f1sim/src/sim/assists.ts</c>.
    /// </summary>
    /// <remarks>
    /// It exists because the model is right, not because it is wrong. First
    /// gear puts about 26 kN through rear tyres that carry about 7.5 kN at
    /// rest, so full throttle from a standstill spins them — and a spinning
    /// tyre has almost no lateral grip left, so the car turns around. A real
    /// driver feeds the throttle in. This is that, in arithmetic.
    /// </remarks>
    [TestFixture]
    public class AssistsTests
    {
        private const double Dt = 1.0 / 120.0;

        private static readonly TractionControlParams P = new TractionControlParams();

        [Test]
        public void LeavesAWellBehavedThrottleAlone()
        {
            var state = new AssistState();
            for (var i = 0; i < 600; i++)
            {
                var applied = Assists.TractionControl(0.6, 0.05, state, Dt, P);
                Assert.That(applied, Is.EqualTo(0.6).Within(1e-12));
            }
            Assert.That(state.ThrottleLimit, Is.EqualTo(1).Within(1e-12));
        }

        [Test]
        public void CutsTheThrottleWhenTheDrivenWheelsSpin()
        {
            var state = new AssistState();
            var applied = 1.0;
            for (var i = 0; i < 120; i++) applied = Assists.TractionControl(1, 0.6, state, Dt, P);

            Assert.That(applied, Is.LessThan(0.5), "a second of wheelspin barely cut the throttle");
            Assert.That(state.ThrottleLimit, Is.EqualTo(applied).Within(1e-12));
        }

        /// <summary>
        /// The floor is not a detail. A controller that cuts to zero leaves a
        /// car that cannot move, and a car that cannot move never stops
        /// slipping, so it would stay cut forever.
        /// </summary>
        [Test]
        public void NeverCutsBelowTheFloor()
        {
            var state = new AssistState();
            for (var i = 0; i < 10_000; i++) Assists.TractionControl(1, 5.0, state, Dt, P);

            Assert.That(state.ThrottleLimit, Is.EqualTo(P.Floor).Within(1e-12));
            Assert.That(Assists.TractionControl(1, 5.0, state, Dt, P),
                Is.EqualTo(P.Floor).Within(1e-12));
        }

        [Test]
        public void HandsTheThrottleBackWhenTheSpinStops()
        {
            var state = new AssistState();
            for (var i = 0; i < 600; i++) Assists.TractionControl(1, 0.9, state, Dt, P);
            var cut = state.ThrottleLimit;

            for (var i = 0; i < 600; i++) Assists.TractionControl(1, 0.0, state, Dt, P);

            Assert.That(state.ThrottleLimit, Is.GreaterThan(cut));
            Assert.That(state.ThrottleLimit, Is.EqualTo(1).Within(1e-9));
        }

        /// <summary>
        /// It gives back more slowly than it takes, which is the whole
        /// character of the thing: a controller that restored as fast as it
        /// cut would oscillate between wheelspin and lift-off.
        /// </summary>
        [Test]
        public void TakesFasterThanItGives()
        {
            Assert.That(P.CutRate, Is.GreaterThan(P.RestoreRate));

            var cutting = new AssistState();
            Assists.TractionControl(1, P.TargetSlip * 2, cutting, Dt, P);
            var takenInOneTick = 1 - cutting.ThrottleLimit;

            var giving = new AssistState { ThrottleLimit = 0.5 };
            Assists.TractionControl(1, 0, giving, Dt, P);
            var givenInOneTick = giving.ThrottleLimit - 0.5;

            Assert.That(takenInOneTick, Is.GreaterThan(givenInOneTick));
        }

        /// <summary>
        /// Cutting is proportional to how far past the target the slip is,
        /// and it saturates — otherwise a momentary spike would empty the
        /// whole ceiling in one tick.
        /// </summary>
        [Test]
        public void CutsHarderTheWorseTheSpinIsButNotWithoutLimit()
        {
            double CutFor(double slip)
            {
                var state = new AssistState();
                Assists.TractionControl(1, slip, state, Dt, P);
                return 1 - state.ThrottleLimit;
            }

            Assert.That(CutFor(0.3), Is.GreaterThan(CutFor(0.2)));
            Assert.That(CutFor(0.5), Is.GreaterThan(CutFor(0.3)));

            // clamp(slip / target - 1, 0, 3) saturates at four times target.
            Assert.That(CutFor(50.0), Is.EqualTo(CutFor(P.TargetSlip * 4)).Within(1e-12));
            Assert.That(CutFor(50.0), Is.EqualTo(Dt * P.CutRate * 3).Within(1e-12));
        }

        /// <summary>
        /// A sliding car reads as a wheelspinning one and is not, and this is
        /// the case that was measured the hard way.
        /// </summary>
        /// <remarks>
        /// Slip ratio is against the contact patch's longitudinal velocity.
        /// Sideways, that collapses while the wheel speed does not, so the
        /// ratio climbs with the rear tyres turning at exactly the speed they
        /// should. Cutting then leaves a car with no drive, and a car with no
        /// drive cannot pull itself straight — 0.07 of throttle through an
        /// entire seventy-degree slide. So while sliding it holds its ground.
        /// </remarks>
        [Test]
        public void HoldsItsGroundWhileTheCarIsSliding()
        {
            var state = new AssistState();
            for (var i = 0; i < 600; i++)
            {
                Assists.TractionControl(1, 3.0, state, Dt, P, sliding: true);
            }

            Assert.That(state.ThrottleLimit, Is.EqualTo(1).Within(1e-12),
                "the controller cut itself to nothing during a slide");
        }

        /// <summary>
        /// Sliding holds the ceiling; it does not raise one already lowered.
        /// A car that spun up, then slid, must not be handed full throttle
        /// back in the middle of the slide.
        /// </summary>
        [Test]
        public void DoesNotHandThrottleBackMidSlide()
        {
            /* Three ticks of mild spin, not three hundred of violent: the
               point is a ceiling part way down, not one already on the
               floor, because the floor would hold either way and prove
               nothing. Slip of 0.28 is twice the target, so each tick takes
               Dt * 6 * 1. */
            var state = new AssistState();
            for (var i = 0; i < 3; i++) Assists.TractionControl(1, 0.28, state, Dt, P);
            var cut = state.ThrottleLimit;

            Assert.That(cut, Is.LessThan(1));
            Assert.That(cut, Is.GreaterThan(P.Floor), "the ceiling is on the floor, which proves nothing");

            for (var i = 0; i < 600; i++)
            {
                var applied = Assists.TractionControl(1, 3.0, state, Dt, P, sliding: true);
                Assert.That(applied, Is.EqualTo(cut).Within(1e-12));
            }
            Assert.That(state.ThrottleLimit, Is.EqualTo(cut).Within(1e-12));
        }

        /// <summary>It shapes the throttle, it never invents one.</summary>
        [Test]
        public void NeverGivesMoreThrottleThanWasAskedFor()
        {
            var state = new AssistState();
            foreach (var slip in new[] { 0.0, 0.05, 0.2, 0.9, 4.0 })
            {
                foreach (var asked in new[] { 0.0, 0.25, 0.5, 1.0 })
                {
                    var applied = Assists.TractionControl(asked, slip, state, Dt, P);
                    Assert.That(applied, Is.LessThanOrEqualTo(asked + 1e-12));
                    Assert.That(applied, Is.GreaterThanOrEqualTo(0));
                }
            }
        }

        [Test]
        public void StartsAndResetsWideOpen()
        {
            var state = new AssistState();
            Assert.That(state.ThrottleLimit, Is.EqualTo(1).Within(0));
            Assert.That(state.SteerLimit, Is.EqualTo(1).Within(0));
            Assert.That(state.StabilityTorque, Is.EqualTo(0).Within(0));

            for (var i = 0; i < 240; i++) Assists.TractionControl(1, 0.9, state, Dt, P);
            state.StabilityTorque = 1234;
            state.Reset();

            Assert.That(state.ThrottleLimit, Is.EqualTo(1).Within(0));
            Assert.That(state.StabilityTorque, Is.EqualTo(0).Within(0));
        }

        // ---- the yaw limiter -------------------------------------------

        private static readonly YawLimiterParams Y = new YawLimiterParams();

        private static double Grip(double v) => (Y.LatAccel + Y.LatAccelPerV2 * v * v) / Math.Abs(v);

        /// <summary>
        /// The two-term fit is meant to reproduce what this car can actually
        /// pull, and the figures the comments quote are 18.7 m/s² at
        /// 100 km/h and 40 at 300. Worth pinning: they are cited elsewhere as
        /// the reason a 39 m radius is grip-limited, and a drift here would
        /// quietly move that.
        /// </summary>
        [Test]
        public void FitsTheLateralGripTheCarActuallyHas()
        {
            var at100 = Y.LatAccel + Y.LatAccelPerV2 * Math.Pow(100 / MathUtil.Kmh, 2);
            var at300 = Y.LatAccel + Y.LatAccelPerV2 * Math.Pow(300 / MathUtil.Kmh, 2);

            Assert.That(at100, Is.EqualTo(18.66).Within(0.01));
            Assert.That(at300, Is.EqualTo(39.96).Within(0.01));
        }

        [Test]
        public void SaysNothingAboutYawBelowWalkingPace()
        {
            Assert.That(Assists.YawExcessOf(5, 0, 4, Y), Is.EqualTo(0).Within(0));
            Assert.That(Assists.YawExcessOf(-5, 0.3, 0, Y), Is.EqualTo(0).Within(0));
        }

        /// <summary>
        /// The band is additive, and that is the point of it. A
        /// multiplicative margin gives zero tolerance in a straight line —
        /// where the target is zero — and welds the car to the road.
        /// </summary>
        [Test]
        public void LeavesAQuarterOfARadianFreeEvenInAStraightLine()
        {
            Assert.That(Assists.YawExcessOf(0, 0, 50, Y), Is.EqualTo(0).Within(0));
            Assert.That(Assists.YawExcessOf(Y.Band, 0, 50, Y), Is.EqualTo(0).Within(1e-12));
            Assert.That(Assists.YawExcessOf(-Y.Band, 0, 50, Y), Is.EqualTo(0).Within(1e-12));
            Assert.That(Assists.YawExcessOf(0.30, 0, 50, Y), Is.EqualTo(0.05).Within(1e-9));
        }

        /// <summary>
        /// A positive steer is a right turn, and a right turn is a
        /// <em>negative</em> yaw rate about +Y — the car's nose is -Z, so a
        /// positive yaw swings it towards -X, which is left. Getting this
        /// sign wrong would make the assist fight every corner instead of
        /// none of them, which is the kind of bug that feels like
        /// understeer.
        /// </summary>
        [Test]
        public void AsksForANegativeYawRateWhenTheDriverTurnsRight()
        {
            const double v = 50, steer = 0.05;
            var asked = -v * Math.Tan(steer) / Y.Wheelbase;

            Assert.That(asked, Is.LessThan(0));
            Assert.That(asked, Is.EqualTo(-0.6950).Within(0.001));

            // Rotating the way the steering asked, within grip, is honest.
            Assert.That(Assists.YawExcessOf(-Grip(v), steer, v, Y), Is.EqualTo(0).Within(0));

            // Rotating hard the other way is not.
            Assert.That(Assists.YawExcessOf(1.5, steer, v, Y), Is.EqualTo(1.7425).Within(0.001));
        }

        /// <summary>
        /// Steering cannot ask for more yaw than the tyres can hold, so a
        /// driver sawing at full lock does not licence a spin.
        /// </summary>
        [Test]
        public void NeverLetsTheSteeringAskForMoreThanGripAllows()
        {
            const double v = 50;
            Assert.That(Assists.YawExcessOf(-Grip(v), 1.2, v, Y), Is.EqualTo(0).Within(1e-9));
            Assert.That(Assists.YawExcessOf(-Grip(v) - 1.0, 1.2, v, Y), Is.LessThan(0));
        }

        /// <summary>
        /// The torque opposes the excess, saturates, and is exactly nothing
        /// when the car is honest.
        /// </summary>
        [Test]
        public void PushesBackAgainstTheExcessAndNothingElse()
        {
            Assert.That(Assists.StabilityTorque(0, Y), Is.EqualTo(0).Within(0));
            Assert.That(Assists.StabilityTorque(0.5, Y), Is.EqualTo(-5500).Within(1e-9));
            Assert.That(Assists.StabilityTorque(1.0, Y), Is.EqualTo(-Y.Peak).Within(1e-9));
            Assert.That(Assists.StabilityTorque(9.0, Y), Is.EqualTo(-Y.Peak).Within(1e-9));
            Assert.That(Assists.StabilityTorque(-1.0, Y), Is.EqualTo(Y.Peak).Within(1e-9));
            Assert.That(Assists.StabilityTorque(-9.0, Y), Is.EqualTo(Y.Peak).Within(1e-9));
        }

        /// <summary>
        /// Zero excess must report positive zero, not negative zero. They
        /// compare equal and they do not print the same, and a test that
        /// pinned the wrong one would fail for a reason nobody could see.
        /// </summary>
        [Test]
        public void ReportsPositiveZeroForAnHonestCar()
        {
            Assert.That(double.IsNegative(Assists.StabilityTorque(0, Y)), Is.False);
        }

        /// <summary>
        /// Nothing here may act on a car doing what it was asked. Swept
        /// across speed and steering, a car rotating at exactly the rate its
        /// steering implies gets no correction at all.
        /// </summary>
        [Test]
        public void NeverResistsATurnTheDriverGenuinelyAsked()
        {
            for (var v = 10.0; v <= 90; v += 5)
            {
                for (var steer = -0.30; steer <= 0.30; steer += 0.02)
                {
                    var asked = -v * Math.Tan(steer) / Y.Wheelbase;
                    var target = MathUtil.Clamp(asked, -Grip(v), Grip(v));

                    Assert.That(Assists.YawExcessOf(target, steer, v, Y), Is.EqualTo(0).Within(1e-12),
                        $"corrected an honest car at {v:F0} m/s and {steer:F2} rad");
                    Assert.That(Assists.StabilityTorque(Assists.YawExcessOf(target, steer, v, Y), Y),
                        Is.EqualTo(0).Within(0));
                }
            }
        }

        // ---- The steering limiter -------------------------------------
        //
        // Numbers below were measured against the TypeScript before they
        // were written here, which is the only way to tell a claim about
        // the model from a claim about the port.

        private static readonly SteerLimiterParams S = new SteerLimiterParams();

        /// <summary>
        /// Slow corners keep every degree, and that falls out of the
        /// arithmetic rather than being a special case: under about 63 km/h
        /// the car is limited by the steering rack rather than by grip, so
        /// the ceiling computes above one and clamps.
        /// </summary>
        [Test]
        public void LeavesSlowCornersAlone()
        {
            foreach (var kmh in new[] { 0.0, 3.5, 20, 50, 62, 63 })
            {
                Assert.That(Assists.SpeedLockCeiling(kmh / 3.6, S), Is.EqualTo(1).Within(0),
                    $"cut the lock at {kmh:F1} km/h, where grip is not the limit");
            }

            /* And the very next km/h is where it starts, which pins the knee
               rather than merely the flat part either side of it. */
            Assert.That(Assists.SpeedLockCeiling(64 / 3.6, S), Is.EqualTo(0.998616745).Within(1e-9));
        }

        /// <summary>
        /// What the ceiling actually is at speed. These are the numbers that
        /// decide whether a corner is a corner or a scrub, so they are pinned
        /// exactly rather than by inequality.
        /// </summary>
        [TestCase(80.0, 0.689562224)]
        [TestCase(100.0, 0.487553620)]
        [TestCase(130.0, 0.340264597)]
        [TestCase(200.0, 0.224924598)]
        [TestCase(300.0, 0.211004781)]
        public void HoldsTheLockAGripLimitedCornerCanUse(double kmh, double expected)
        {
            Assert.That(Assists.SpeedLockCeiling(kmh / 3.6, S), Is.EqualTo(expected).Within(1e-9));
        }

        /// <summary>
        /// The floor is a safety net, not a working limit. At the fastest the
        /// car ever goes the ceiling is still twice it, so it can never bind
        /// on a straight — which is the whole reason it is safe to have.
        /// </summary>
        [Test]
        public void NeverReachesItsFloorAtAnySpeedTheCarCanDo()
        {
            for (var kmh = 0.0; kmh <= 400; kmh += 1)
            {
                Assert.That(Assists.SpeedLockCeiling(kmh / 3.6, S), Is.GreaterThan(S.Floor * 2),
                    $"the floor bound at {kmh:F0} km/h");
            }
        }

        /// <summary>
        /// Understeer walks the ceiling down at the stated rate. At twice
        /// target slip that is one cut rate per second — a third of a
        /// hundredth per tick at 120 Hz.
        /// </summary>
        [Test]
        public void WindsTheLockOffWhenTheFrontAxleIsPastItsPeak()
        {
            var state = new AssistState();
            for (var i = 1; i <= 8; i++)
            {
                var applied = Assists.SteerLimiter(1, -0.28, state, Dt, S, false, 0);
                var expected = 1 - i * Dt * S.CutRate;
                Assert.That(state.SteerLimit, Is.EqualTo(expected).Within(1e-9));
                Assert.That(applied, Is.EqualTo(expected).Within(1e-9));
            }
        }

        /// <summary>
        /// How far past peak the axle is stops mattering at three times over.
        /// Without the clamp a big slip angle would take the whole ceiling in
        /// one tick.
        /// </summary>
        [Test]
        public void CutsNoFasterThanThreeTimesOverNoMatterHowFarPast()
        {
            var state = new AssistState();
            Assists.SteerLimiter(1, -10, state, Dt, S, false, 0);
            Assert.That(state.SteerLimit, Is.EqualTo(0.9).Within(1e-9));
        }

        /// <summary>
        /// The sign test, which is the one that makes this safe to ship.
        /// </summary>
        /// <remarks>
        /// Understeer shows up as a front slip angle opposite in sign to the
        /// steer command; a save has the same sign, because the car is
        /// already yawing and the countersteer goes with the slip. Cutting
        /// only on opposite signs is what stops the limiter taking away a
        /// correction — with this test deleted the assist fights the driver
        /// at exactly the moment they need the wheel most.
        /// </remarks>
        [Test]
        public void NeverTakesAwayACountersteer()
        {
            var state = new AssistState { SteerLimit = 0.5 };
            var applied = Assists.SteerLimiter(1, 0.28, state, Dt, S, false, 0);

            Assert.That(state.SteerLimit, Is.EqualTo(0.5 + Dt * S.RestoreRate).Within(1e-9));
            Assert.That(applied, Is.EqualTo(0.516666667).Within(1e-9));
        }

        /// <summary>
        /// While sliding the ceiling is frozen, not restored.
        /// </summary>
        /// <remarks>
        /// A yawing car carries a large front slip angle whatever the
        /// steering is doing, so the loop cannot read it — and must not
        /// conclude from that silence that the lock is safe to hand back.
        /// This branch used to fall through to the restore, and the ceiling
        /// climbed from 0.93 to 1.00 during a twenty-seven degree slide,
        /// giving the player's full wrong-way lock back at the one moment it
        /// was actively wrong.
        /// </remarks>
        [Test]
        public void HoldsItsGroundWhileTheCarIsSliding()
        {
            var state = new AssistState { SteerLimit = 0.6 };
            var applied = Assists.SteerLimiter(1, -0.9, state, Dt, S, true, 20);

            Assert.That(state.SteerLimit, Is.EqualTo(0.6).Within(0), "restored mid-slide");
            Assert.That(applied, Is.EqualTo(0.6).Within(1e-9));
        }

        /// <summary>
        /// It gives back faster than traction control does, so the steering
        /// is not dead on the way out of a corner.
        /// </summary>
        [Test]
        public void HandsTheLockBackOnceTheAxleIsBehaving()
        {
            var state = new AssistState { SteerLimit = 0.2 };
            for (var i = 1; i <= 4; i++)
            {
                Assists.SteerLimiter(1, 0, state, Dt, S, false, 0);
                Assert.That(state.SteerLimit, Is.EqualTo(0.2 + i * Dt * S.RestoreRate).Within(1e-9));
            }

            Assert.That(S.RestoreRate, Is.GreaterThan(new TractionControlParams().RestoreRate));
        }

        /// <summary>
        /// The two ceilings compose, and the speed one is not written back
        /// into the state — the integrator keeps its own memory, so a car
        /// that slows down gets its earned lock back rather than the lock the
        /// fastest part of the corner allowed.
        /// </summary>
        [Test]
        public void TakesWhicheverCeilingIsTighterWithoutForgettingTheOther()
        {
            var state = new AssistState { SteerLimit = 0.9 };
            var applied = Assists.SteerLimiter(1, 0, state, 0, S, false, 130 / 3.6);

            Assert.That(applied, Is.EqualTo(0.340264597).Within(1e-9));
            Assert.That(state.SteerLimit, Is.EqualTo(0.9).Within(0),
                "the speed ceiling leaked into the integrator");
        }

        /// <summary>
        /// It is a ceiling on magnitude, so it clamps both ways and leaves
        /// anything already inside it untouched.
        /// </summary>
        [Test]
        public void ClampsBothWaysAndPassesSmallInputsThrough()
        {
            var state = new AssistState { SteerLimit = 0.4 };
            Assert.That(Assists.SteerLimiter(-1, 0, state, 0, S, false, 0),
                Is.EqualTo(-0.4).Within(1e-12));

            state.SteerLimit = 0.4;
            Assert.That(Assists.SteerLimiter(0.25, 0, state, 0, S, false, 0),
                Is.EqualTo(0.25).Within(1e-12));
        }

    }
}
