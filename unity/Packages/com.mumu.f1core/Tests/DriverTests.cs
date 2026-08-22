using System;
using NUnit.Framework;

namespace MumuF1.Tests
{
    /// <summary>
    /// The AI driver, ported from <c>f1sim/src/ai/driver.ts</c>.
    /// </summary>
    /// <remarks>
    /// Every number here was measured against the reference on the same
    /// circuit, from the same car, before it was written down. That matters
    /// more for this file than for most: the driver reads two things the port
    /// also had to reproduce — the racing line and the speed profile — so a
    /// steering angle that matches to nine digits is evidence about all
    /// three at once, and one that does not narrows down which.
    ///
    /// The Red Bull Ring rather than the oval, because the oval is flat out
    /// from the line to the line and would exercise neither braking nor the
    /// curvature feedforward.
    /// </remarks>
    [TestFixture]
    public class DriverTests
    {
        private const double Dt = 1.0 / 120.0;

        private static readonly Circuit Track = Circuits.Get("redbullring");
        private static readonly RacingLine Line = new RacingLine(Track);
        private static readonly SpeedProfile Profile = new SpeedProfile(Line);

        private static Driver Fresh() => new Driver(Line, Profile);

        /// <summary>A car at <paramref name="speed"/>, pointed straight ahead.</summary>
        private static VehicleState Car(double speed, int gear = 4, double rearSlip = 0)
        {
            var v = new VehicleState
            {
                Rotation = Quat.Identity,
                Velocity = new Vec3(0, 0, -speed),
                Speed = speed,
                EngineRpm = 9000,
                Gear = gear
            };

            for (var i = 0; i < Wheel.Count; i++)
            {
                WheelTelemetry w = WheelTelemetry.Empty;
                w.Grounded = true;
                if (i == Wheel.Rl || i == Wheel.Rr) w.SlipRatio = rearSlip;
                v.Wheels[i] = w;
            }

            return v;
        }

        /// <summary>The car pointed along the circuit at <paramref name="s"/>.</summary>
        /// <remarks>
        /// Forward is -Z, so a heading has yaw <c>atan2(x, -z)</c>; and a
        /// rotation of φ about +Y sends (0,0,-1) to (-sin φ, 0, -cos φ),
        /// whose yaw is -φ. Hence the negation. With it the wrong way round
        /// the car faces twice the heading error, every aim angle saturates,
        /// and the test measures the clamp rather than the geometry — which
        /// is exactly what the first version of this measured.
        /// </remarks>
        private static Quat Facing(double s)
        {
            Vec3 t = Track.Spline.SampleAt(s).Tangent;
            var yaw = -Math.Atan2(t.X, -t.Z);
            return new Quat(0, Math.Sin(yaw / 2), 0, Math.Cos(yaw / 2));
        }

        private static Vec3 On(double s) => Line.PointAt(s);

        /// <summary>
        /// The circuit and line this file measures against are the ones the
        /// reference measured against.
        /// </summary>
        /// <remarks>
        /// First, because everything below is a claim about a driver on a
        /// specific piece of road. If the road is a different length or the
        /// line has a different number of stations, every other number in
        /// this file is wrong for a reason that has nothing to do with the
        /// driver.
        /// </remarks>
        [Test]
        public void IsDrivingTheCircuitTheReferenceMeasured()
        {
            Assert.That(Track.Length, Is.EqualTo(4322.958255).Within(1e-6));
            Assert.That(Line.StationCount, Is.EqualTo(865));
            Assert.That(Line.Spacing, Is.EqualTo(4.997639601).Within(1e-9));
        }

        /// <summary>
        /// From rest it asks for everything, and traction control is bypassed
        /// rather than allowed to cut — which is the difference between a car
        /// that leaves the line and one that never can.
        /// </summary>
        [Test]
        public void PullsAwayFromRestOnFullThrottle()
        {
            Driver d = Fresh();
            ControlState c = d.Drive(Car(0, 1), On(0), Facing(0), 0, Line.OffsetAt(0), 1, Dt);

            Assert.That(c.Throttle, Is.EqualTo(1).Within(0));
            Assert.That(c.Brake, Is.EqualTo(0).Within(0));
            Assert.That(c.Steer, Is.EqualTo(0.001110953).Within(1e-9));
            Assert.That(c.StraightMode, Is.False, "reclined the wings at a standstill");

            Assert.That(d.Debug.TargetSpeed, Is.EqualTo(62.422863007).Within(1e-9));
            Assert.That(d.Debug.Lookahead, Is.EqualTo(6).Within(1e-12));
            Assert.That(d.Debug.LineError, Is.EqualTo(0).Within(1e-12));
        }

        /// <summary>
        /// Round the lap at 60 m/s, on the line and pointed along it.
        /// </summary>
        /// <remarks>
        /// The four stations are chosen to be four different situations
        /// rather than four samples of one: flat out on the start straight,
        /// hard on the brakes for Turn 1, flat out again on the run to Turn 3,
        /// and braking twice more. The steering is fractions of a per cent
        /// throughout, which is the real assertion — a driver on its own line
        /// pointed along it should barely be steering at all, and a port with
        /// a sign or a frame convention wrong would be sawing at the wheel.
        /// </remarks>
        [TestCase(0.0, 0.969145203, 0.0, 0.001493486, 62.422863007, true)]
        [TestCase(500.0, 0.0, 1.0, -0.007902575, 21.626870155, false)]
        [TestCase(1200.0, 1.0, 0.0, -0.000395167, 62.626461918, true)]
        [TestCase(2000.0, 0.0, 1.0, -0.012356101, 34.281243514, false)]
        [TestCase(3000.0, 0.0, 1.0, -0.007749954, 39.843210780, false)]
        public void DrivesTheLapTheProfileAsksFor(
            double s, double throttle, double brake, double steer, double target, bool straight)
        {
            Driver d = Fresh();
            ControlState c = d.Drive(Car(60, 6), On(s), Facing(s), s, Line.OffsetAt(s), 6, Dt);

            Assert.That(c.Throttle, Is.EqualTo(throttle).Within(1e-9));
            Assert.That(c.Brake, Is.EqualTo(brake).Within(1e-9));
            Assert.That(c.Steer, Is.EqualTo(steer).Within(1e-9));
            Assert.That(c.StraightMode, Is.EqualTo(straight));
            Assert.That(d.Debug.TargetSpeed, Is.EqualTo(target).Within(1e-9));
        }

        /// <summary>
        /// A car on its own line, pointed along it, is aiming almost exactly
        /// where it is already going.
        /// </summary>
        /// <remarks>
        /// This is the test that catches a frame or sign convention being
        /// wrong, and it catches it loudly: get the heading quaternion
        /// backwards and the aim angle at Turn 3 goes from a fifth of a
        /// degree to a hundred and thirty-two.
        /// </remarks>
        [TestCase(0.0)]
        [TestCase(500.0)]
        [TestCase(1200.0)]
        [TestCase(2000.0)]
        [TestCase(3000.0)]
        public void AimsWhereItIsAlreadyPointed(double s)
        {
            Driver d = Fresh();
            d.Drive(Car(60, 6), On(s), Facing(s), s, Line.OffsetAt(s), 6, Dt);

            Assert.That(Math.Abs(d.Debug.AimAngle), Is.LessThan(5),
                $"aiming {d.Debug.AimAngle:F1} degrees off its own line at {s:F0} m");
        }

        /// <summary>
        /// Three metres off the line, the correction term pulls back towards
        /// it — and saturates, because 0.3 of the command is as much as the
        /// trim may ever ask for.
        /// </summary>
        [Test]
        public void PullsBackTowardsTheLineWhenItHasDrifted()
        {
            Driver d = Fresh();
            ControlState c = d.Drive(
                Car(60, 6), On(500), Facing(500), 500, Line.OffsetAt(500) + 3, 6, Dt);

            Assert.That(d.Debug.LineError, Is.EqualTo(3).Within(1e-9));
            Assert.That(c.Steer, Is.EqualTo(-0.049569241).Within(1e-9));
            Assert.That(c.Steer, Is.LessThan(0), "steered away from the line it had drifted off");
        }

        /// <summary>
        /// Above walking pace the driver's throttle goes through traction
        /// control like anyone else's.
        /// </summary>
        [Test]
        public void LetsTractionControlCutOnceMoving()
        {
            Driver d = Fresh();
            ControlState c = d.Drive(
                Car(10, 2, rearSlip: 0.6), On(500), Facing(500), 500, Line.OffsetAt(500), 2, Dt);

            Assert.That(c.Throttle, Is.EqualTo(0.85).Within(1e-9));
        }

        /// <summary>
        /// The bypass below walking pace, which is a deadlock fix rather than
        /// a nicety.
        /// </summary>
        /// <remarks>
        /// On a low-grip surface the throttle ceiling decays faster than it
        /// restores, so a car stopped in the grass could never restart: every
        /// attempt spun the wheels and cut the throttle further. Here the car
        /// is barely moving with the rear tyres spinning hard, and it must
        /// still be given everything.
        /// </remarks>
        [Test]
        public void NeverCutsItsOwnThrottleAtAStandstill()
        {
            Driver d = Fresh();
            for (var i = 0; i < 200; i++)
            {
                ControlState c = d.Drive(
                    Car(1, 1, rearSlip: 3), On(0), Facing(0), 0, Line.OffsetAt(0), 1, Dt);
                Assert.That(c.Throttle, Is.EqualTo(1).Within(0),
                    $"cut its own throttle to {c.Throttle:F3} on tick {i} while stationary");
            }
        }

        /// <summary>
        /// It asks to be recovered after the stated delay, and sooner off the
        /// road than on it.
        /// </summary>
        /// <remarks>
        /// Off the road there is nothing to wait for — the car has usually
        /// fallen past the end of the track mesh. On it, the same stillness
        /// might just be a slow corner, so it waits the full delay.
        /// </remarks>
        [Test]
        public void AsksToBeRecoveredOnceItIsClearlyStuck()
        {
            Assert.That(TicksUntilRecovery(true) * Dt, Is.EqualTo(2.508333333).Within(1e-9));
            Assert.That(TicksUntilRecovery(false) * Dt, Is.EqualTo(1.508333333).Within(1e-9));
        }

        private static int TicksUntilRecovery(bool onTrack)
        {
            Driver d = Fresh();
            var ticks = 0;
            while (!d.NeedsRecovery && ticks < 2000)
            {
                d.Drive(Car(0, 1), On(0), Facing(0), 0, 0, 1, Dt, onTrack);
                ticks++;
            }

            return ticks;
        }

        /// <summary>
        /// A moving car forgets it was ever stuck, so a slow corner cannot
        /// accumulate its way into a respawn.
        /// </summary>
        [Test]
        public void ForgetsBeingStuckAsSoonAsItMoves()
        {
            Driver d = Fresh();
            for (var i = 0; i < 250; i++) d.Drive(Car(0, 1), On(0), Facing(0), 0, 0, 1, Dt);
            Assert.That(d.NeedsRecovery, Is.False, "gave up before the delay was out");

            d.Drive(Car(5, 1), On(0), Facing(0), 0, 0, 1, Dt);
            for (var i = 0; i < 250; i++) d.Drive(Car(0, 1), On(0), Facing(0), 0, 0, 1, Dt);
            Assert.That(d.NeedsRecovery, Is.False, "counted from before it started moving again");
        }

        /// <summary>
        /// The steering slews rather than stepping, at the stated rate.
        /// </summary>
        /// <remarks>
        /// A first-order filter towards the wanted angle, so with the command
        /// held the error falls geometrically — which is what stops the AI
        /// from snapping the wheel between ticks and unsettling the car.
        /// </remarks>
        [Test]
        public void SlewsTheSteeringRatherThanSnappingIt()
        {
            Driver d = Fresh();
            var seen = new double[5];
            for (var i = 0; i < 5; i++)
            {
                seen[i] = d.Drive(
                    Car(60, 6), On(1200), Facing(1200), 1200, Line.OffsetAt(1200), 6, Dt).Steer;
            }

            Assert.That(seen[0], Is.EqualTo(-0.000395167).Within(1e-9));
            Assert.That(seen[1], Is.EqualTo(-0.000735449).Within(1e-9));
            Assert.That(seen[2], Is.EqualTo(-0.001028471).Within(1e-9));
            Assert.That(seen[3], Is.EqualTo(-0.001280794).Within(1e-9));
            Assert.That(seen[4], Is.EqualTo(-0.001498073).Within(1e-9));
        }

        /// <summary>
        /// A shift request fires once and then disarms, so holding the
        /// condition does not run through the whole gearbox.
        /// </summary>
        /// <remarks>
        /// And the condition is road speed rather than engine speed on
        /// purpose: during wheelspin the engine sits on the limiter while the
        /// car is barely moving, and an rpm-triggered shift would upshift
        /// through every gear in a handful of ticks.
        /// </remarks>
        [Test]
        public void ShiftsOnceRatherThanEveryTickTheConditionHolds()
        {
            Driver d = Fresh();
            Assert.That(d.Drive(Car(60, 1), On(0), Facing(0), 0, Line.OffsetAt(0), 1, Dt).ShiftUp, Is.True);
            Assert.That(d.Drive(Car(60, 1), On(0), Facing(0), 0, Line.OffsetAt(0), 1, Dt).ShiftUp, Is.False);
            Assert.That(d.Drive(Car(60, 1), On(0), Facing(0), 0, Line.OffsetAt(0), 1, Dt).ShiftUp, Is.False);
        }

        /// <summary>
        /// A reset puts it back to a driver that has just arrived.
        /// </summary>
        [Test]
        public void ForgetsEverythingOnReset()
        {
            Driver d = Fresh();
            for (var i = 0; i < 400; i++) d.Drive(Car(0, 1), On(0), Facing(0), 0, 0, 1, Dt, false);
            Assert.That(d.NeedsRecovery, Is.True);

            d.Reset();
            Assert.That(d.NeedsRecovery, Is.False);

            ControlState c = d.Drive(Car(0, 1), On(0), Facing(0), 0, Line.OffsetAt(0), 1, Dt);
            Assert.That(c.Steer, Is.EqualTo(0.001110953).Within(1e-9),
                "the steering filter kept its old position through a reset");
            Assert.That(c.ShiftUp, Is.False);
        }

        /// <summary>
        /// It never asks for more than the controls can express.
        /// </summary>
        /// <remarks>
        /// Swept right round the circuit at three speeds, from a car sitting
        /// on its own line. Out-of-range controls do not throw anywhere
        /// downstream, they simply mean something else — a steer of 1.4 is a
        /// steer of 1, and a throttle of -0.2 is a car that mysteriously will
        /// not accelerate.
        /// </remarks>
        [Test]
        public void NeverAsksForAnythingOutOfRange()
        {
            for (var speed = 10.0; speed <= 90; speed += 40)
            {
                Driver d = Fresh();
                for (var s = 0.0; s < Track.Length; s += 7)
                {
                    ControlState c = d.Drive(
                        Car(speed, 5), On(s), Facing(s), s, Line.OffsetAt(s), 5, Dt);

                    Assert.That(c.Throttle, Is.InRange(0.0, 1.0), $"throttle at {s:F0} m");
                    Assert.That(c.Brake, Is.InRange(0.0, 1.0), $"brake at {s:F0} m");
                    Assert.That(c.Steer, Is.InRange(-1.0, 1.0), $"steer at {s:F0} m");
                    Assert.That(c.Throttle * c.Brake, Is.EqualTo(0).Within(0),
                        $"asked for throttle and brake at once at {s:F0} m");
                }
            }
        }
    }
}
