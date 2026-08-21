using System;

namespace MumuF1
{
    /// <summary>
    /// Spring, damper and anti-roll bar.
    /// </summary>
    /// <remarks>
    /// The anti-roll bar is the reason this is its own type. It couples
    /// the two wheels on an axle, and shifting stiffness between the
    /// front and rear bar is the primary tool for dialling out understeer
    /// or oversteer — because a stiffer bar puts more load onto that
    /// axle's outside tyre, and load sensitivity then costs that axle
    /// grip. Tune it against <see cref="TireParams.LoadSensitivity"/>.
    ///
    /// Rates are set by the downforce, not by the car's weight. At
    /// 300 km/h this car makes roughly 19 kN of downforce on top of its
    /// 7.8 kN of weight, so each corner carries about 6.6 kN without
    /// running out of travel. Rates sized for the static weight alone
    /// would bottom the car out on every straight.
    /// </remarks>
    public sealed class SuspensionParams
    {
        /// <summary>Uncompressed spring length (m).</summary>
        public double RestLength = 0.12;

        /// <summary>Travel either side of rest before bottoming out (m).</summary>
        public double MaxTravel = 0.08;

        /// <summary>Spring rate (N/m).</summary>
        public double StiffnessFront = 160_000.0;
        public double StiffnessRear = 180_000.0;

        /// <summary>Damping coefficient (Ns/m).</summary>
        public double DampingFront = 8_000.0;
        public double DampingRear = 8_600.0;

        /// <summary>Anti-roll bar rate (N per m of left-right difference).</summary>
        public double AntiRollFront = 38_000.0;
        public double AntiRollRear = 28_000.0;
    }

    public static class Suspension
    {
        /// <summary>Bump-stop rate as a multiple of the spring rate.</summary>
        public const double BumpStopRatio = 18.0;

        /// <summary>
        /// Ceiling on the vertical force one corner may produce (N).
        /// </summary>
        /// <remarks>
        /// A backstop rather than a model: roughly ten times the static
        /// corner load, which no legitimate landing exceeds, and which
        /// caps the damage any future stiffness mistake can do.
        /// </remarks>
        public const double MaxCornerForce = 80_000.0;

        /// <summary>Vertical force from one corner, before the anti-roll bar.</summary>
        /// <param name="compression">How far the spring is compressed from rest (m).</param>
        /// <param name="compressionVelocity">Rate of compression, positive compressing (m/s).</param>
        public static double Force(
            double stiffness,
            double damping,
            double compression,
            double compressionVelocity,
            double maxTravel)
        {
            double c = MathUtil.Clamp(compression, -maxTravel, maxTravel);

            /* Bump stop. Past full travel this has to be much stiffer
               than the spring, or the chassis sinks until its collider
               punches through the road — but it cannot be arbitrarily
               stiff. An explicit integrator is only stable while
               sqrt(k/m) * dt stays below about 2, which at 120 Hz and a
               200 kg corner mass caps the rate near 11 MN/m. A first pass
               used two hundred times the spring rate, or 32 MN/m: every
               time a wheel touched the stop the solver added energy
               instead of absorbing it, and the car was fired off the
               circuit at 300 m/s. */
            double overTravel = compression - c;
            double bumpStop = overTravel * stiffness * BumpStopRatio;

            double force = stiffness * c + bumpStop + damping * compressionVelocity;

            // A spring can push the wheel down but never pull the car
            // down, and no single corner may deliver more than a hard
            // landing's worth of load.
            return Math.Min(MaxCornerForce, Math.Max(0.0, force));
        }

        /// <summary>
        /// Anti-roll contribution for one axle. Add it at the left wheel
        /// and subtract it at the right.
        /// </summary>
        public static double AntiRoll(
            double rate, double compressionLeft, double compressionRight)
            => rate * (compressionRight - compressionLeft) * 0.5;
    }
}
