using System;

namespace MumuF1
{
    /// <summary>
    /// What the driver aids are holding between them, tick to tick.
    /// </summary>
    /// <remarks>
    /// A mutable bag rather than a return value, because these are
    /// controllers: their whole job is to remember what they did last tick
    /// and move from there. A traction controller that recomputed its
    /// ceiling from scratch every tick would be a switch, not a controller.
    /// </remarks>
    public sealed class AssistState
    {
        /// <summary>Current throttle ceiling, zero to one.</summary>
        public double ThrottleLimit = 1;

        /// <summary>Current ceiling on the magnitude of steering, zero to one.</summary>
        public double SteerLimit = 1;

        /// <summary>
        /// Yaw moment the aids want this tick (N m).
        /// </summary>
        /// <remarks>
        /// Written by the aids and read by whatever applies forces, so the
        /// sideslip, the yaw excess and the torque are all computed once
        /// from one snapshot. Computing it separately at the call site meant
        /// the aids and the torque could be handed different states.
        /// </remarks>
        public double StabilityTorque;

        public void Reset()
        {
            ThrottleLimit = 1;
            SteerLimit = 1;
            StabilityTorque = 0;
        }
    }

    public sealed class TractionControlParams
    {
        /// <summary>Slip ratio the controller aims to hold on the driven wheels.</summary>
        public double TargetSlip { get; set; } = 0.14;

        /// <summary>How fast the ceiling drops once slip is exceeded (per second).</summary>
        public double CutRate { get; set; } = 6;

        /// <summary>How fast it is handed back (per second).</summary>
        public double RestoreRate { get; set; } = 1.5;

        /// <summary>Never cut below this, or the car cannot move at all.</summary>
        public double Floor { get; set; } = 0.08;
    }

    public sealed class YawLimiterParams
    {
        /// <summary>Mechanical grip, as lateral acceleration at rest (m/s²).</summary>
        public double LatAccel { get; set; } = 16.0;

        /// <summary>Downforce's share, which grows with the square of speed.</summary>
        public double LatAccelPerV2 { get; set; } = 0.00345;

        /// <summary>Distance between axles (m).</summary>
        public double Wheelbase { get; set; } = 3.6;

        /// <summary>
        /// Yaw rate allowed past the target before anything acts (rad/s).
        /// </summary>
        /// <remarks>
        /// Additive rather than a multiplier, and that matters: a
        /// multiplicative margin gives zero tolerance in a straight line,
        /// where the target is zero, and welds the car to the road. A quarter
        /// of a radian per second is fourteen degrees a second of free
        /// rotation at any speed — enough for turn-in overshoot and for the
        /// half-metre of relaxation lag in the tyre model. A spin is three to
        /// five times over, not one point three.
        /// </remarks>
        public double Band { get; set; } = 0.25;

        /// <summary>Below this road speed yaw means nothing (m/s).</summary>
        public double MinSpeed { get; set; } = 8;

        /// <summary>Excess at which the correcting torque saturates (rad/s).</summary>
        public double Span { get; set; } = 1.0;

        /// <summary>
        /// Strongest moment the assist will ask for (N m).
        /// </summary>
        /// <remarks>
        /// 1100 kg m² of yaw inertia times ten radians per second squared.
        /// That removes the one and a half rad/s of excess measured in a real
        /// slide in 0.15 s, against the 0.53 s a fifth of it needed — and
        /// half a second is longer than the whole event. For scale the rear
        /// axle at the limit makes about 13,250 N m of yaw moment on its own,
        /// so this is below the authority the tyres themselves routinely use.
        /// </remarks>
        public double Peak { get; set; } = 11_000;
    }

    public sealed class SteerLimiterParams
    {
        /// <summary>Front slip angle the limiter holds (rad).</summary>
        /// <remarks>
        /// The tyre peaks at 0.125 rad and the top of the curve is flat — at
        /// 0.14 it still makes 99.8 per cent of peak. Holding just past the
        /// peak rather than exactly on it lets the driver feel the limit for
        /// two tenths of a per cent of grip.
        /// </remarks>
        public double TargetSlip { get; set; } = 0.14;

        /// <summary>How fast the ceiling drops past target (per second).</summary>
        /// <remarks>
        /// At twice target slip the ceiling falls in about a quarter of a
        /// second: fast enough to catch a corner-entry overshoot, slow enough
        /// that it does not snatch the wheel out of your hands.
        /// </remarks>
        public double CutRate { get; set; } = 4;

        /// <summary>How fast it is handed back (per second).</summary>
        /// <remarks>
        /// Faster than traction control's 1.5, so the steering is not dead on
        /// the way out of a corner.
        /// </remarks>
        public double RestoreRate { get; set; } = 2;

        /// <summary>Never cut below this, or slow corners become impossible.</summary>
        /// <remarks>
        /// A safety net rather than a working limit. The worst case in normal
        /// driving is 300 km/h, where the ceiling lands at 0.211 — twice the
        /// floor — so the floor can never bind on a straight.
        /// </remarks>
        public double Floor { get; set; } = 0.1;

        /* The chassis, mirrored as plain numbers so this file still depends
           on nothing from the vehicle — the same discipline the yaw limiter
           keeps. */

        /// <summary>Mechanical grip, as lateral acceleration at rest (m/s²).</summary>
        public double LatAccel { get; set; } = 16.0;

        /// <summary>How much lateral acceleration downforce adds, per (m/s)².</summary>
        public double LatAccelPerV2 { get; set; } = 0.00345;

        /// <summary>Axle to axle (m).</summary>
        public double Wheelbase { get; set; } = 3.6;

        /// <summary>Steering lock at a standstill (rad).</summary>
        public double MaxSteerAngle { get; set; } = 0.349;

        /// <summary>Fraction of lock still available at 300 km/h.</summary>
        public double SteerSpeedFactor { get; set; } = 0.45;

        /// <summary>How much more lock than the corner needs to allow.</summary>
        /// <remarks>
        /// Sixty per cent more than a grip-limited corner can use. Enough
        /// that the car can still be provoked and corrected and never feels
        /// numb; little enough that full travel stops being a request the
        /// front axle answers with drag.
        /// </remarks>
        public double SpeedHeadroom { get; set; } = 1.6;
    }

    /// <summary>
    /// Driver aids.
    /// </summary>
    /// <remarks>
    /// These sit <em>between</em> the input source and the vehicle: they read
    /// telemetry and shape the controls, but never touch the physics. That
    /// keeps the vehicle model honest and lets the same code serve the
    /// player, the test bench and the AI driver, which needs exactly this to
    /// get off the line.
    ///
    /// Worth being clear about why one is needed at all. First gear puts
    /// roughly 26 kN of thrust through rear tyres that can carry about
    /// 7.5 kN at a standstill. Full throttle from rest therefore spins the
    /// wheels, and spinning wheels have almost no lateral grip left, so the
    /// car turns around. That is not a bug — it is what the model should do,
    /// and it is why a real driver feeds the throttle in rather than mashing
    /// it.
    /// </remarks>
    public static class Assists
    {
        /// <summary>
        /// Limit throttle to keep the driven wheels near their peak-grip slip.
        /// </summary>
        /// <param name="desired">throttle the driver asked for, zero to one.</param>
        /// <param name="drivenSlip">largest absolute slip ratio across the driven wheels.</param>
        /// <param name="state">what the controller is holding.</param>
        /// <param name="dt">the step (s).</param>
        /// <param name="p">how hard it cuts and how fast it gives back.</param>
        /// <param name="sliding">whether the car is already out of shape.</param>
        /// <returns>the throttle to actually apply.</returns>
        /// <remarks>
        /// The sliding case is not a refinement, it is the difference between
        /// a car that can straighten itself and one that cannot.
        ///
        /// Slip ratio is measured against the contact patch's
        /// <em>longitudinal</em> velocity. When the car goes sideways that
        /// collapses while the wheel speed does not, so the ratio climbs even
        /// though the rear tyres are turning at exactly the speed they
        /// should. The controller then walks its ceiling down to the floor,
        /// and a car with no drive cannot pull itself straight — measured at
        /// 0.07 of throttle through an entire seventy-degree slide. So it
        /// holds its ground and lets the yaw assist's throttle trim be the
        /// only thing shaping throttle while the car is out of shape.
        /// </remarks>
        public static double TractionControl(
            double desired,
            double drivenSlip,
            AssistState state,
            double dt,
            TractionControlParams p = null,
            bool sliding = false)
        {
            if (state == null) throw new ArgumentNullException(nameof(state));
            p = p ?? new TractionControlParams();

            if (sliding) return Math.Min(desired, state.ThrottleLimit);

            if (drivenSlip > p.TargetSlip)
            {
                state.ThrottleLimit -=
                    dt * p.CutRate * MathUtil.Clamp(drivenSlip / p.TargetSlip - 1, 0, 3);
            }
            else
            {
                state.ThrottleLimit += dt * p.RestoreRate;
            }

            state.ThrottleLimit = MathUtil.Clamp(state.ThrottleLimit, p.Floor, 1);
            return Math.Min(desired, state.ThrottleLimit);
        }

        /// <summary>
        /// How much faster the car is rotating than anything could justify.
        /// </summary>
        /// <param name="yawRate">measured yaw rate about +Y (rad/s).</param>
        /// <param name="steerAngle">signed road-wheel angle (rad).</param>
        /// <param name="speed">road speed (m/s).</param>
        /// <returns>signed excess yaw rate (rad/s), zero when the car is honest.</returns>
        /// <remarks>
        /// This is the reading that stops a spin, and the reason is timing.
        /// Sideslip is a lagging indicator: in a measured slide it was still
        /// only eleven degrees — barely past the yaw assist's deadband —
        /// while the car was already rotating at 1.46 rad/s against the 0.56
        /// the grip at that speed could hold. Two and a half times over, half
        /// a second before the angle said anything was wrong.
        ///
        /// The target is the smaller of what the steering is asking for and
        /// what the tyres can deliver, so it is zero on a straight, exactly
        /// the corner's own rate through a corner, and never more than grip
        /// allows. Everything beyond it plus a band is excess, and only the
        /// excess is ever acted on — which is why this cannot resist a turn
        /// the driver genuinely asked for.
        /// </remarks>
        public static double YawExcessOf(
            double yawRate, double steerAngle, double speed, YawLimiterParams p = null)
        {
            p = p ?? new YawLimiterParams();
            if (Math.Abs(speed) < p.MinSpeed) return 0;

            /* What the steering is asking for. A positive steer is a right
               turn, and a right turn is a *negative* yaw rate about +Y —
               rotating the car's -Z nose by a positive yaw swings it towards
               -X, which is to the left. Hence the minus, and getting it wrong
               would make the assist add to every corner instead of nothing. */
            var asked = -speed * Math.Tan(steerAngle) / p.Wheelbase;
            var grip = (p.LatAccel + p.LatAccelPerV2 * speed * speed) / Math.Abs(speed);

            var target = MathUtil.Clamp(asked, -grip, grip);
            var error = yawRate - target;
            return error - MathUtil.Clamp(error, -p.Band, p.Band);
        }

        /// <summary>
        /// The moment a real stability program makes with the brakes.
        /// </summary>
        /// <remarks>
        /// Steering and throttle are not enough on their own, and the reason
        /// is worth writing down: countersteer can only produce as much yaw
        /// moment as the front tyres have grip left, and a car already
        /// sideways has very little. Held at full opposite lock with the
        /// throttle cut, the simulated car still rotated all the way round —
        /// correctly, because that is what the physics says.
        ///
        /// A real car answers this by braking individual wheels, which makes
        /// a yaw moment out of longitudinal force and needs no cornering grip
        /// at all. There is no per-wheel brake channel here, so this asks for
        /// the moment directly. It is a gameplay force and it says so — but
        /// it is the same force an electronic stability program would make,
        /// for the same reason, and it is driven by the yaw <em>excess</em>,
        /// so it is exactly zero whenever the car is doing what its steering
        /// asked.
        /// </remarks>
        public static double StabilityTorque(double yawExcess, YawLimiterParams p = null)
        {
            p = p ?? new YawLimiterParams();

            /* Guarded so an honest car reports exactly +0 rather than -0,
               which is a different number to a bitwise comparison and
               therefore to a test. */
            if (yawExcess == 0) return 0;
            return -MathUtil.Clamp(yawExcess / p.Span, -1, 1) * p.Peak;
        }

        /// <summary>
        /// The most lock worth having at this speed.
        /// </summary>
        /// <param name="speed">forward speed (m/s); the sign does not matter.</param>
        /// <param name="p">the chassis and how much headroom to leave.</param>
        /// <returns>a ceiling on the steering command, zero to one.</returns>
        /// <remarks>
        /// The integrator below is a closed loop, so it can only cut
        /// <em>after</em> the front axle has gone past its peak and the half
        /// metre of relaxation lag has already put the transient into the
        /// car. This stops the request being made at all.
        ///
        /// At 130 km/h the front axle can use 3.2 degrees and full travel
        /// asks for 15.2 — nearly five times over — and past the peak the
        /// lateral curve slopes down, so the extra lock buys drag and nothing
        /// else. That is what turned a corner into a 130-to-25 km/h scrub.
        ///
        /// Below about 63 km/h this returns exactly 1 and the driver keeps
        /// every degree. That is not a special case: under that speed the car
        /// is limited by the steering rack rather than by grip — at 50 km/h
        /// it needs 17.3 of the 18.2 degrees it has — so the ceiling falls
        /// out of the arithmetic above 1 and clamps. Slow corners are
        /// untouched.
        /// </remarks>
        public static double SpeedLockCeiling(double speed, SteerLimiterParams p = null)
        {
            p = p ?? new SteerLimiterParams();

            var v = Math.Abs(speed);

            /* Below walking pace the arithmetic divides by roughly nothing
               and the answer is meaningless as well as unnecessary. */
            if (v < 1) return 1;

            var needed = Math.Atan((p.LatAccel + p.LatAccelPerV2 * v * v) * p.Wheelbase / (v * v));
            var available = p.MaxSteerAngle *
                (1 - (1 - p.SteerSpeedFactor) * MathUtil.Clamp(v * 3.6 / 300, 0, 1));

            return MathUtil.Clamp(p.SpeedHeadroom * needed / available, p.Floor, 1);
        }

        /// <summary>
        /// Stop the driver asking the front axle for more slip than it can use.
        /// </summary>
        /// <param name="desired">steer the driver asked for, minus one to one.</param>
        /// <param name="frontSlip">mean slip angle across the front axle (rad, signed).</param>
        /// <param name="state">what the controller is holding.</param>
        /// <param name="dt">the step (s).</param>
        /// <param name="p">how hard it cuts and how fast it gives back.</param>
        /// <param name="sliding">whether the car is already out of shape.</param>
        /// <param name="speed">forward speed (m/s), for the speed ceiling.</param>
        /// <returns>the steer to actually apply.</returns>
        /// <remarks>
        /// This is the single biggest reason the car is hard. At 100 km/h the
        /// grip-limited corner radius is 39 m, which needs 5.3 degrees of
        /// steer; the lock available at that speed is 14. At 200 km/h it is
        /// 2.1 against 11.2. Full travel is therefore always a request the
        /// front axle cannot fill — and past the peak the lateral curve
        /// slopes <em>downwards</em>, so pushing harder gives less grip, the
        /// car stops answering the wheel, and when the rear joins in the yaw
        /// runs away.
        ///
        /// The loop settles with the front axle at peak slip, which is to say
        /// at maximum lateral force. The car does not turn less. It turns as
        /// hard as it physically can, and stops being asked for more.
        /// </remarks>
        public static double SteerLimiter(
            double desired,
            double frontSlip,
            AssistState state,
            double dt,
            SteerLimiterParams p = null,
            bool sliding = false,
            double speed = 0)
        {
            p = p ?? new SteerLimiterParams();

            /* The sign test is what makes this safe, and it is not obvious.
             *
             * Steering right makes the contact patch travel to the left of
             * where the wheel points, so understeer shows up as a front slip
             * angle opposite in sign to the steer command. Catching a slide
             * is the other way round: the car is already yawing, the body is
             * travelling across its own nose, and the countersteer applied
             * has the same sign as the slip.
             *
             * So cutting only on opposite signs separates "you asked for more
             * lock than the front can use" from "you are saving it", and the
             * limiter can never take away a correction. Delete this test and
             * the assist fights the driver at exactly the moment they need
             * the wheel most. */
            var beyondPeak =
                desired != 0 &&
                Math.Abs(frontSlip) > p.TargetSlip &&
                Math.Sign(frontSlip) != Math.Sign(desired);

            if (sliding)
            {
                /* Stand down — but stand down *frozen*.
                 *
                 * A yawing car carries a large front slip angle whatever the
                 * steering is doing, so the loop cannot read it. What it must
                 * not do is conclude from that silence that the lock is safe
                 * to hand back. This branch used to fall through to the
                 * restore below, and the ceiling climbed from 0.93 to 1.00
                 * during a twenty-seven degree slide — giving the player's
                 * full wrong-way lock back at the one moment it was actively
                 * wrong. Hold whatever the corner had earned and let the yaw
                 * assist do its work. */
            }
            else if (beyondPeak)
            {
                state.SteerLimit -=
                    dt * p.CutRate * MathUtil.Clamp(Math.Abs(frontSlip) / p.TargetSlip - 1, 0, 3);
            }
            else
            {
                state.SteerLimit += dt * p.RestoreRate;
            }

            state.SteerLimit = MathUtil.Clamp(state.SteerLimit, p.Floor, 1);

            /* Whichever is tighter: what the corner has earned, or what the
               speed can use. The ceiling is applied to the command and never
               written back into the state, so the integrator keeps its own
               memory. */
            var ceiling = Math.Min(state.SteerLimit, SpeedLockCeiling(speed, p));
            return MathUtil.Clamp(desired, -ceiling, ceiling);
        }
    }
}
