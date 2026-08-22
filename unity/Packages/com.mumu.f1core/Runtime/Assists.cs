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
        /// A safety net rather than a working limit, and one that never binds
        /// at any speed. Above 300 km/h the available lock is clamped and
        /// stops shrinking while the lock a corner needs tends to a constant,
        /// so the ceiling has a positive asymptote of about 0.1265 — above
        /// this. It is 0.211 at 300 km/h and still 0.174 at 400.
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

    public sealed class YawAssistParams
    {
        /// <summary>Sideslip below which the assist does nothing at all (rad).</summary>
        /// <remarks>
        /// Seven degrees, and this number is what keeps the simulator intact.
        /// A car cornering at the limit runs three to six degrees of body
        /// sideslip, so below the deadband this contributes exactly zero —
        /// bit for bit, not approximately. Lower than it first was, because a
        /// slide caught at eight degrees was already unrecoverable: the yaw
        /// rate had doubled by the time the assist was allowed to look at it.
        /// </remarks>
        public double Deadband { get; set; } = 0.12;

        /// <summary>Sideslip at which it has its full authority (rad).</summary>
        /// <remarks>
        /// Eleven and a half degrees, down from twenty. Sideslip grew from
        /// nothing to twenty-seven degrees in one second in the slide this
        /// was tuned against, so the old ramp needed half a second to reach
        /// full authority and the car was gone by then. This one takes
        /// 0.17 s, and it catches the car while the rear axle still has 97
        /// per cent of its peak force to straighten up with, against 90 per
        /// cent at twenty degrees.
        /// </remarks>
        public double FullBand { get; set; } = 0.2;

        /// <summary>Lock commanded per radian of slide.</summary>
        /// <remarks>
        /// Saturating at 10.4 degrees of slide, just inside the point where
        /// the assist is allowed its full authority — so it is asking for
        /// everything it has by the time it may use everything it has.
        ///
        /// One degree of slide per degree of lock turns out to be too little:
        /// at 130 km/h the rack only offers 15.2 degrees, so matching the
        /// slide angle merely points the front wheels <em>along</em> the
        /// direction of travel, and wheels pointing where the car is already
        /// going make no restoring moment at all. This asks for about 1.45
        /// times the slide, which does.
        /// </remarks>
        public double CounterGain { get; set; } = 5.5;

        /// <summary>Lock added per radian per second of yaw excess.</summary>
        /// <remarks>
        /// The lead term, and its sign is worth stating plainly because it was
        /// once wrong while the comment beside it described the right physics.
        ///
        /// Forward is -Z and right is +X, so a right turn is a
        /// <em>negative</em> yaw rate; and when the rear steps out in that
        /// turn the velocity vector sits to the left of the nose, making
        /// sideslip negative too. Slide and yaw rate therefore share a sign
        /// while a slide is opening and oppose once it is being caught.
        /// Subtracting the rate term took countersteer away exactly while the
        /// slide grew and added it while the car came back — a positive
        /// feedback term wearing a damper's clothes, and the reason the
        /// measured trace oscillated between thirteen and twenty degrees
        /// instead of settling.
        ///
        /// Driven off the yaw <em>excess</em> rather than the raw rate, so a
        /// car going round a corner at the rate that corner implies
        /// contributes nothing. Read the size as a release time: the command
        /// nulls once the car is unwinding fast enough to close the remaining
        /// slide in about three tenths of a second.
        /// </remarks>
        public double RateGain { get; set; } = 1.6;

        /// <summary>The most of the command the assist may ever take, zero to one.</summary>
        /// <remarks>
        /// Blend, never override — but only just. With the driver holding full
        /// wrong-way lock this is the difference between reaching -0.80 of
        /// countersteer and -0.90, and the measured slide needed the latter.
        /// What keeps the car from feeling like it drives itself is the
        /// deadband, not this number.
        /// </remarks>
        public double MaxAuthority { get; set; } = 0.95;

        /// <summary>Fraction of throttle removed at full authority.</summary>
        /// <remarks>
        /// Now the only thing shaping throttle while the car is sideways —
        /// traction control stands down there, because slip ratio misreads a
        /// yaw event as wheelspin. A third of throttle in fourth at 130 km/h
        /// cannot light the rears, and it is the difference between a car that
        /// drives out of a slide and the 0.07 that was measured, which is a
        /// car being dragged to a halt.
        /// </remarks>
        public double ThrottleTrim { get; set; } = 0.7;

        /// <summary>Below this road speed sideslip means nothing (m/s).</summary>
        public double MinSpeed { get; set; } = 6;
    }

    /// <summary>What the yaw assist decided this tick.</summary>
    public struct YawAssistResult
    {
        public double Steer;
        public double Throttle;

        /// <summary>How much authority the assist took, zero to one.</summary>
        public double Authority;
    }

    public sealed class ReverseParams
    {
        /// <summary>Road speed below which the car counts as stopped (m/s).</summary>
        /// <remarks>
        /// Two metres a second, matching the gearbox's own rule for when
        /// reverse may be selected at all — asking for it above that would be
        /// a request the drivetrain refuses, and the car would simply sit
        /// there.
        /// </remarks>
        public double SelectBelow { get; set; } = 1.8;
    }

    /// <summary>Every aid, and the speed below which none of them run.</summary>
    public sealed class EasyModeParams
    {
        public TractionControlParams Traction { get; set; } = new TractionControlParams();
        public SteerLimiterParams Steering { get; set; } = new SteerLimiterParams();
        public YawAssistParams Yaw { get; set; } = new YawAssistParams();
        public YawLimiterParams Limiter { get; set; } = new YawLimiterParams();
        public ReverseParams Reverse { get; set; } = new ReverseParams();

        /// <summary>Below this road speed every loop is bypassed and reset (m/s).</summary>
        public double BypassSpeed { get; set; } = 3;
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

        /// <summary>
        /// Catch the slide before it becomes a spin.
        /// </summary>
        /// <param name="desiredSteer">steer asked for, after the limiter.</param>
        /// <param name="desiredThrottle">throttle asked for, after traction control.</param>
        /// <param name="sideslip">radians, positive when the car travels to the right of its own nose.</param>
        /// <param name="yawExcess">rate beyond what steering and grip imply, from <see cref="YawExcessOf"/>.</param>
        /// <param name="speed">road speed (m/s).</param>
        /// <param name="p">deadband, gains and how much authority to allow.</param>
        /// <remarks>
        /// The signal is body sideslip — the angle between where the car
        /// points and where it is actually going. It needs no reference model
        /// and no invented understeer gradient, and its target is exactly
        /// zero, which is the whole reason to prefer it to a yaw-rate error.
        ///
        /// The yaw term is the <em>excess</em> rather than the raw rate, so a
        /// car going round a corner at the rate that corner implies
        /// contributes nothing to the correction.
        /// </remarks>
        public static YawAssistResult YawAssist(
            double desiredSteer,
            double desiredThrottle,
            double sideslip,
            double yawExcess,
            double speed,
            YawAssistParams p = null)
        {
            p = p ?? new YawAssistParams();

            var idle = new YawAssistResult
            {
                Steer = desiredSteer,
                Throttle = desiredThrottle,
                Authority = 0
            };

            if (Math.Abs(speed) < p.MinSpeed) return idle;

            var over = Math.Abs(sideslip) - p.Deadband;
            if (over <= 0) return idle;

            var authority = MathUtil.Clamp(over / (p.FullBand - p.Deadband), 0, 1) * p.MaxAuthority;

            /* A tail out to the right means the car is yawing right and
               travelling to the left of its nose: sideslip negative, yaw rate
               negative, both terms negative, and the assist steers left — into
               the slide, as it should. The two share a sign while the slide
               opens and oppose while it is caught, which is why they *add*. */
            var counter = MathUtil.Clamp(p.CounterGain * sideslip + p.RateGain * yawExcess, -1, 1);

            return new YawAssistResult
            {
                Steer = desiredSteer + authority * (counter - desiredSteer),
                Throttle = desiredThrottle * (1 - p.ThrottleTrim * authority),
                Authority = authority
            };
        }

        /// <summary>
        /// Reverse without knowing there is a gearbox.
        /// </summary>
        /// <param name="desired">what the driver is actually pressing.</param>
        /// <param name="gear">the gear engaged; zero is reverse.</param>
        /// <param name="speed">forward speed, negative when travelling backwards.</param>
        /// <param name="p">how slow counts as stopped.</param>
        /// <remarks>
        /// The car has a reverse gear and it works, but reaching it means
        /// holding the downshift paddle through neutral at walking pace — a
        /// thing a ten-year-old will never find and would not think to look
        /// for. What they do is hold the back key and wait to go backwards,
        /// because that is what every game they have played does.
        ///
        /// So the brake becomes both. Held while rolling forwards it is a
        /// brake; held once the car has stopped it selects reverse and feeds
        /// in throttle. Pressing forward again brakes the reversing car and
        /// then puts it back into first. Nothing about the gearbox changes —
        /// this presses the same paddles a driver would, just without being
        /// asked.
        /// </remarks>
        public static ControlState ArcadeReverse(
            ControlState desired,
            int gear,
            double speed,
            ReverseParams p = null)
        {
            p = p ?? new ReverseParams();

            var reversing = gear == 0;
            var stopped = Math.Abs(speed) < p.SelectBelow;

            /* Every branch below starts from a copy. ControlState is a struct
               precisely so this is a copy and not an alias — the reference
               spreads its input rather than mutating it, and an aid that
               rewrote the caller's pedals would be a very quiet bug. */
            var next = desired;

            if (reversing)
            {
                /* Backwards, and the back key is now the accelerator. The
                   forward key is the brake, and once it has stopped the car it
                   shifts up out of reverse — one press to stop, and the same
                   press to set off again. */
                if (desired.Throttle > 0)
                {
                    next.Throttle = 0;
                    if (stopped)
                    {
                        next.Brake = 0;
                        next.ShiftUp = true;
                    }
                    else
                    {
                        next.Brake = desired.Throttle;
                    }

                    return next;
                }

                next.Throttle = desired.Brake;
                next.Brake = 0;
                return next;
            }

            /* Forwards. The brake is a brake until the car is stopped and the
               key is still held, at which point it asks for reverse. */
            if (desired.Brake > 0 && stopped && desired.Throttle == 0)
            {
                next.Brake = 0;
                next.Throttle = 0;
                next.ShiftDown = true;
                return next;
            }

            return desired;
        }

        /// <summary>
        /// Every easy-mode aid, in the order they have to run.
        /// </summary>
        /// <param name="desired">what the driver or the AI is asking for.</param>
        /// <param name="state">the car this tick.</param>
        /// <param name="assist">what the controllers are holding between ticks.</param>
        /// <param name="dt">the step (s).</param>
        /// <param name="p">every aid's parameters, and the bypass speed.</param>
        /// <remarks>
        /// Traction control first, because a spinning rear tyre is what
        /// creates the slide the other two then have to deal with; the
        /// steering limiter next, on the raw command; the yaw assist last, so
        /// it has the final say on both steer and throttle when the car is
        /// genuinely sideways.
        ///
        /// The low-speed bypass at the top is not a nicety, it is a bug fix.
        /// The AI driver carried one for a while with a comment explaining the
        /// deadlock it prevents: on a low-grip surface the throttle ceiling
        /// decays faster than it restores until the car can never pull away
        /// again. The player's path never had it, so a car stopped on the
        /// grass with traction control on was stuck there for good. Putting
        /// the bypass here means there is one copy of it rather than two.
        /// </remarks>
        public static ControlState DriverAids(
            ControlState desired,
            VehicleState state,
            AssistState assist,
            double dt,
            EasyModeParams p = null)
        {
            p = p ?? new EasyModeParams();

            /* Reverse first, because it rewrites what the pedals mean and
               everything below reads them. */
            ControlState pedals = ArcadeReverse(desired, state.Gear, state.Speed, p.Reverse);

            if (Math.Abs(state.Speed) < p.BypassSpeed)
            {
                assist.Reset();
                return pedals;
            }

            var drivenSlip = Math.Max(
                Math.Abs(state.Wheels[Wheel.Rl].SlipRatio),
                Math.Abs(state.Wheels[Wheel.Rr].SlipRatio));

            var sideslip = state.Sideslip();
            var sliding = Math.Abs(sideslip) > p.Yaw.Deadband;

            var throttle = TractionControl(
                pedals.Throttle, drivenSlip, assist, dt, p.Traction, sliding);

            /* The mean of the two front wheels rather than the larger. They
               share a steer angle and sit 1.6 m apart, so they track each
               other closely — and the mean needs no decision about whose sign
               to believe. */
            var frontSlip =
                (state.Wheels[Wheel.Fl].SlipAngle + state.Wheels[Wheel.Fr].SlipAngle) / 2;
            var grounded = state.Wheels[Wheel.Fl].Grounded || state.Wheels[Wheel.Fr].Grounded;

            /* How much faster the car is turning than anything could justify.
               Computed once here and used by both the steering correction and
               the torque, so the two can never be looking at different
               states. */
            var excess = YawExcessOf(
                state.AngularVelocity.Y, state.SteerAngles[Wheel.Fl], state.Speed, p.Limiter);
            assist.StabilityTorque = StabilityTorque(excess, p.Limiter);

            var steer = grounded
                ? SteerLimiter(pedals.Steer, frontSlip, assist, dt, p.Steering, sliding, state.Speed)
                : MathUtil.Clamp(pedals.Steer, -assist.SteerLimit, assist.SteerLimit);

            YawAssistResult caught = YawAssist(steer, throttle, sideslip, excess, state.Speed, p.Yaw);

            pedals.Throttle = caught.Throttle;
            pedals.Steer = caught.Steer;
            return pedals;
        }
    }
}
