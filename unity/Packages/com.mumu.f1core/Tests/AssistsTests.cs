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
        public void FreezesTheSteeringCeilingWhileTheCarIsSliding()
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


        // ---- The yaw assist -------------------------------------------

        private static readonly YawAssistParams Y2 = new YawAssistParams();

        /// <summary>
        /// Below the deadband it contributes exactly nothing — bit for bit,
        /// not approximately.
        /// </summary>
        /// <remarks>
        /// This is the number that keeps the simulator intact. A car
        /// cornering at the limit runs three to six degrees of body sideslip,
        /// and if the assist shaded the controls there the car would drive
        /// itself round every corner. The boundary itself is idle too, which
        /// is worth pinning: the reference tests <c>over &lt;= 0</c>, so seven
        /// degrees exactly is still the driver's.
        /// </remarks>
        [TestCase(0.0)]
        [TestCase(0.05)]
        [TestCase(0.119999)]
        [TestCase(0.12)]
        public void DoesNothingAtAllBelowTheDeadband(double sideslip)
        {
            YawAssistResult r = Assists.YawAssist(0.3, 0.8, sideslip, -0.5, 40, Y2);

            Assert.That(r.Steer, Is.EqualTo(0.3).Within(0));
            Assert.That(r.Throttle, Is.EqualTo(0.8).Within(0));
            Assert.That(r.Authority, Is.EqualTo(0).Within(0));
        }

        /// <summary>
        /// Authority ramps over the band and then saturates, and the steer and
        /// throttle it produces are pinned with it.
        /// </summary>
        [TestCase(0.13, 0.145625000, 0.733500000, 0.118750000)]
        [TestCase(0.16, -0.317500000, 0.534000000, 0.475000000)]
        [TestCase(0.20, -0.935000000, 0.268000000, 0.950000000)]
        [TestCase(0.30, -0.935000000, 0.268000000, 0.950000000)]
        [TestCase(0.60, -0.935000000, 0.268000000, 0.950000000)]
        public void RampsToFullAuthorityAcrossTheBandAndStopsThere(
            double slide, double steer, double throttle, double authority)
        {
            YawAssistResult r = Assists.YawAssist(0.3, 0.8, -slide, -0.5, 40, Y2);

            Assert.That(r.Authority, Is.EqualTo(authority).Within(1e-9));
            Assert.That(r.Steer, Is.EqualTo(steer).Within(1e-9));
            Assert.That(r.Throttle, Is.EqualTo(throttle).Within(1e-9));
        }

        /// <summary>
        /// It blends and never overrides — but only just, and that margin was
        /// measured rather than chosen.
        /// </summary>
        /// <remarks>
        /// With the driver holding full wrong-way lock through a
        /// twenty-seven degree slide, 0.95 of authority is the difference
        /// between reaching -0.80 of countersteer and -0.90, and the slide
        /// this was tuned against needed the latter.
        /// </remarks>
        [Test]
        public void OutSteersADriverHoldingFullWrongWayLock()
        {
            YawAssistResult r = Assists.YawAssist(1, 0.5, -0.47, -1.2, 36, Y2);

            Assert.That(r.Steer, Is.EqualTo(-0.9).Within(1e-9));
            Assert.That(r.Throttle, Is.EqualTo(0.1675).Within(1e-9));
            Assert.That(r.Authority, Is.EqualTo(0.95).Within(1e-9));
        }

        /// <summary>
        /// Sideslip means nothing at walking pace, so below the minimum speed
        /// the assist stands right down.
        /// </summary>
        /// <remarks>
        /// The angle between where a car points and where it is going is a
        /// ratio of two velocities, and at a standstill both are noise. A car
        /// being nudged in a pit lane would otherwise read as a spin.
        /// </remarks>
        [Test]
        public void IgnoresSideslipAtWalkingPace()
        {
            YawAssistResult r = Assists.YawAssist(0.3, 0.8, -0.9, -2, 5.9, Y2);

            Assert.That(r.Steer, Is.EqualTo(0.3).Within(0));
            Assert.That(r.Throttle, Is.EqualTo(0.8).Within(0));
            Assert.That(r.Authority, Is.EqualTo(0).Within(0));
        }

        /// <summary>
        /// The two terms add rather than subtract, which was once the other
        /// way round and is the difference between a damper and positive
        /// feedback.
        /// </summary>
        /// <remarks>
        /// Slide and yaw rate share a sign while a slide is opening and
        /// oppose once it is being caught. Subtracting the rate term took
        /// countersteer away exactly while the slide grew and added it while
        /// the car came back, and the measured trace oscillated between
        /// thirteen and twenty degrees instead of settling. So: a car
        /// unwinding fast enough gets <em>less</em> correction than one still
        /// going away.
        /// </remarks>
        [Test]
        public void AsksForLessOnceTheCarIsComingBack()
        {
            var opening = Assists.YawAssist(0, 1, -0.15, -0.6, 40, Y2).Steer;
            var caught = Assists.YawAssist(0, 1, -0.15, 0.6, 40, Y2).Steer;

            Assert.That(opening, Is.LessThan(caught),
                "the rate term is subtracting, which makes it positive feedback");
        }

        // ---- Reverse, without knowing there is a gearbox ---------------

        private static ControlState Pedals(double throttle = 0, double brake = 0) =>
            new ControlState { Throttle = throttle, Brake = brake };

        /// <summary>
        /// Rolling forwards, the brake is just a brake.
        /// </summary>
        [Test]
        public void LeavesTheBrakeAloneWhileTheCarIsMoving()
        {
            ControlState r = Assists.ArcadeReverse(Pedals(brake: 1), 1, 10);

            Assert.That(r.Brake, Is.EqualTo(1).Within(0));
            Assert.That(r.ShiftDown, Is.False);
        }

        /// <summary>
        /// Stopped with the key still held, it asks for reverse — which is
        /// the whole feature.
        /// </summary>
        [Test]
        public void SelectsReverseOnceTheCarHasStopped()
        {
            ControlState r = Assists.ArcadeReverse(Pedals(brake: 1), 1, 1.0);

            Assert.That(r.ShiftDown, Is.True);
            Assert.That(r.Brake, Is.EqualTo(0).Within(0));
            Assert.That(r.Throttle, Is.EqualTo(0).Within(0));
        }

        /// <summary>
        /// Both pedals at once is not a request for reverse. Someone holding
        /// the throttle against the brake is doing something deliberate, and
        /// dropping them into reverse for it would be a nasty surprise.
        /// </summary>
        [Test]
        public void DoesNotSelectReverseWhileTheThrottleIsAlsoHeld()
        {
            ControlState r = Assists.ArcadeReverse(
                new ControlState { Brake = 1, Throttle = 0.5 }, 1, 1.0);

            Assert.That(r.ShiftDown, Is.False);
            Assert.That(r.Brake, Is.EqualTo(1).Within(0));
            Assert.That(r.Throttle, Is.EqualTo(0.5).Within(0));
        }

        /// <summary>
        /// The threshold matches the gearbox's own rule for when reverse may
        /// be selected at all, so the boundary is exclusive on both sides.
        /// Asking above it would be a request the drivetrain refuses, and the
        /// car would simply sit there with nothing to explain why.
        /// </summary>
        [Test]
        public void HoldsTheSameThresholdTheGearboxDoes()
        {
            Assert.That(Assists.ArcadeReverse(Pedals(brake: 1), 1, 1.8).ShiftDown, Is.False);
            Assert.That(Assists.ArcadeReverse(Pedals(brake: 1), 1, 1.79).ShiftDown, Is.True);
        }

        /// <summary>
        /// In reverse the keys swap: the back key drives and the forward key
        /// brakes, and once it has stopped the car the same press shifts back
        /// up into first.
        /// </summary>
        [Test]
        public void SwapsThePedalsRoundOnceInReverse()
        {
            ControlState back = Assists.ArcadeReverse(Pedals(brake: 0.7), 0, -3);
            Assert.That(back.Throttle, Is.EqualTo(0.7).Within(0));
            Assert.That(back.Brake, Is.EqualTo(0).Within(0));

            ControlState slowing = Assists.ArcadeReverse(Pedals(throttle: 0.6), 0, -3);
            Assert.That(slowing.Throttle, Is.EqualTo(0).Within(0));
            Assert.That(slowing.Brake, Is.EqualTo(0.6).Within(0));
            Assert.That(slowing.ShiftUp, Is.False);

            ControlState away = Assists.ArcadeReverse(Pedals(throttle: 0.6), 0, -1.0);
            Assert.That(away.ShiftUp, Is.True);
            Assert.That(away.Throttle, Is.EqualTo(0).Within(0));
            Assert.That(away.Brake, Is.EqualTo(0).Within(0));
        }

        /// <summary>
        /// It returns a copy and never writes through to what it was handed.
        /// </summary>
        /// <remarks>
        /// The reference spreads its input rather than mutating it, and every
        /// aid downstream reads the same controls. A ControlState that aliased
        /// would make this whole file rewrite the caller's pedals, which is
        /// why it is a struct.
        /// </remarks>
        [Test]
        public void NeverWritesBackThroughItsArgument()
        {
            ControlState asked = Pedals(brake: 1);
            Assists.ArcadeReverse(asked, 1, 1.0);

            Assert.That(asked.Brake, Is.EqualTo(1).Within(0));
            Assert.That(asked.ShiftDown, Is.False);
        }

        // ---- Everything together ---------------------------------------
        //
        // The pipeline is what the game actually calls, so these are the
        // numbers that matter most. Every one was measured against the
        // TypeScript with the same car before being written here.

        /// <summary>A car pointed down -Z, travelling at <paramref name="speed"/>.</summary>
        private static VehicleState Car(
            double speed,
            double sideslip = 0,
            double yawRate = 0,
            int gear = 4,
            double rearSlip = 0,
            double frontSlipAngle = 0,
            bool grounded = true)
        {
            var v = new VehicleState
            {
                Rotation = Quat.Identity,
                /* Identity rotation, so local is world and the sideslip the
                   aids read back out is exactly the one asked for here. */
                Velocity = new Vec3(speed * Math.Sin(sideslip), 0, -speed * Math.Cos(sideslip)),
                AngularVelocity = new Vec3(0, yawRate, 0),
                Speed = speed,
                EngineRpm = 9000,
                Gear = gear
            };

            for (var i = 0; i < Wheel.Count; i++)
            {
                WheelTelemetry w = WheelTelemetry.Empty;
                w.Grounded = grounded;
                if (i == Wheel.Rl || i == Wheel.Rr) w.SlipRatio = rearSlip;
                if (i == Wheel.Fl || i == Wheel.Fr) w.SlipAngle = frontSlipAngle;
                v.Wheels[i] = w;
            }

            return v;
        }

        /// <summary>
        /// Below the bypass speed nothing runs and every controller is put
        /// back to neutral.
        /// </summary>
        /// <remarks>
        /// Not a nicety — a bug fix, and one that used to exist in only one of
        /// the two places that needed it. On a low-grip surface the throttle
        /// ceiling decays faster than it restores until the car can never pull
        /// away again, so a car stopped on the grass with traction control on
        /// was stuck there for good.
        /// </remarks>
        [Test]
        public void StandsEverythingDownAtWalkingPace()
        {
            var assist = new AssistState { ThrottleLimit = 0.3, SteerLimit = 0.4, StabilityTorque = 999 };
            ControlState result = Assists.DriverAids(
                new ControlState { Throttle = 1, Steer = 1 }, Car(2), assist, Dt);

            Assert.That(result.Throttle, Is.EqualTo(1).Within(0));
            Assert.That(result.Steer, Is.EqualTo(1).Within(0));
            Assert.That(assist.ThrottleLimit, Is.EqualTo(1).Within(0));
            Assert.That(assist.SteerLimit, Is.EqualTo(1).Within(0));
            Assert.That(assist.StabilityTorque, Is.EqualTo(0).Within(0));
        }

        /// <summary>
        /// A clean car at speed keeps all its throttle, and only the speed
        /// ceiling touches the steering.
        /// </summary>
        [Test]
        public void TakesNothingFromACleanCarButTheLockItCannotUse()
        {
            var assist = new AssistState();
            ControlState result = Assists.DriverAids(
                new ControlState { Throttle = 1, Steer = 1 }, Car(36), assist, Dt);

            Assert.That(result.Throttle, Is.EqualTo(1).Within(0));
            Assert.That(result.Steer, Is.EqualTo(0.341574166).Within(1e-9));
            Assert.That(assist.ThrottleLimit, Is.EqualTo(1).Within(1e-12));
            Assert.That(assist.SteerLimit, Is.EqualTo(1).Within(1e-12));
            Assert.That(assist.StabilityTorque, Is.EqualTo(0).Within(0));
        }

        /// <summary>Wheelspin cuts the throttle and nothing else.</summary>
        [Test]
        public void CutsTheThrottleForWheelspin()
        {
            var assist = new AssistState();
            ControlState result = Assists.DriverAids(
                new ControlState { Throttle = 1 }, Car(36, rearSlip: 0.5), assist, Dt);

            Assert.That(result.Throttle, Is.EqualTo(0.871428571).Within(1e-9));
            Assert.That(assist.ThrottleLimit, Is.EqualTo(0.871428571).Within(1e-9));
        }

        /// <summary>
        /// The case the whole file exists for: a car twenty-seven degrees
        /// sideways with the driver holding full wrong-way lock.
        /// </summary>
        /// <remarks>
        /// Three things have to be true at once, and each was wrong at some
        /// point. The steering has to end up hard the other way despite the
        /// driver. The throttle has to be a third rather than nothing, because
        /// a car with no drive cannot pull itself straight — 0.07 was measured
        /// through an entire slide before traction control learned to stand
        /// down. And the stability torque has to be saturated, because at 1.4
        /// rad/s the car is rotating several times faster than any corner at
        /// this speed could justify.
        /// </remarks>
        [Test]
        public void CatchesASlideWhileTheDriverIsMakingItWorse()
        {
            var assist = new AssistState();
            ControlState result = Assists.DriverAids(
                new ControlState { Throttle = 0.5, Steer = 1 },
                Car(36, sideslip: -0.47, yawRate: -1.4, rearSlip: 0.6, frontSlipAngle: -0.3),
                assist, Dt);

            Assert.That(result.Steer, Is.EqualTo(-0.932921292).Within(1e-9));
            Assert.That(result.Throttle, Is.EqualTo(0.1675).Within(1e-9));

            Assert.That(assist.ThrottleLimit, Is.EqualTo(1).Within(1e-12),
                "traction control cut while sliding, which takes away the drive that straightens the car");
            Assert.That(assist.SteerLimit, Is.EqualTo(1).Within(1e-12),
                "the steering limiter moved while sliding, where it cannot read the axle");
            Assert.That(assist.StabilityTorque, Is.EqualTo(11000).Within(1e-6));
        }

        /// <summary>
        /// Airborne, the limiter cannot read the front axle, so the ceiling it
        /// had is applied to the command and the integrator is left alone.
        /// </summary>
        [Test]
        public void HoldsItsCeilingWhileTheFrontWheelsAreOffTheGround()
        {
            var assist = new AssistState { SteerLimit = 0.35 };
            ControlState result = Assists.DriverAids(
                new ControlState { Steer = 1 }, Car(36, grounded: false), assist, Dt);

            Assert.That(result.Steer, Is.EqualTo(0.35).Within(1e-9));
            Assert.That(assist.SteerLimit, Is.EqualTo(0.35).Within(0));
        }

        /// <summary>
        /// Reverse survives the pipeline: the pedals are rewritten before
        /// anything else reads them, so holding the back key at a standstill
        /// asks for reverse, and holding it once reversing drives the car.
        /// </summary>
        [Test]
        public void CarriesReverseThroughTheWholePipeline()
        {
            ControlState select = Assists.DriverAids(
                new ControlState { Brake = 1 }, Car(1.0), new AssistState(), Dt);
            Assert.That(select.ShiftDown, Is.True);

            ControlState going = Assists.DriverAids(
                new ControlState { Brake = 0.8 }, Car(-2.5, gear: 0), new AssistState(), Dt);
            Assert.That(going.Throttle, Is.EqualTo(0.8).Within(1e-12));
            Assert.That(going.Brake, Is.EqualTo(0).Within(0));
        }

    }
}
