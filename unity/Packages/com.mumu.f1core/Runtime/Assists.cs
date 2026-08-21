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
    }
}
