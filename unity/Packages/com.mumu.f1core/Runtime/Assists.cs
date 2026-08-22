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
    }
}
