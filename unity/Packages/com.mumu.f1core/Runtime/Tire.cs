using System;

namespace MumuF1
{
    /// <summary>
    /// Tyre parameters — a simplified Pacejka "magic formula" with load
    /// sensitivity and a friction ellipse for combined slip.
    /// </summary>
    public sealed class TireParams
    {
        /// <summary>Peak friction coefficient at the reference load.</summary>
        public double MuNominal = 1.75;

        /// <summary>Reference vertical load the coefficient is quoted at (N).</summary>
        public double LoadReference = 3000.0;

        /// <summary>
        /// Fractional loss of mu per unit of load above reference. Zero
        /// disables it and makes the car feel inert and forgiving.
        /// </summary>
        public double LoadSensitivity = 0.08;

        /* B, C and E are not independent: together they fix where the
           curve peaks. These are solved so that lateral grip peaks near
           7 degrees of slip angle and longitudinal grip near 0.12 slip
           ratio, which is what SlipAngleAtPeak and SlipRatioAtPeak
           assume. Change one and the peak moves — the tests check they
           stay consistent. */
        public double LatB = 16.0;
        public double LatC = 1.5;
        public double LatE = 0.3;

        public double LongB = 13.0;
        public double LongC = 1.65;
        public double LongE = 0.3;

        public double RollingResistance = 0.014;
    }

    /// <summary>What one contact patch is producing.</summary>
    public readonly struct TireForces
    {
        /// <summary>Longitudinal force, positive accelerates the car (N).</summary>
        public readonly double Long;

        /// <summary>Lateral force (N).</summary>
        public readonly double Lat;

        /// <summary>Fraction of the friction ellipse consumed, 0..2.</summary>
        public readonly double GripUsage;

        public TireForces(double longitudinal, double lateral, double gripUsage)
        {
            Long = longitudinal;
            Lat = lateral;
            GripUsage = gripUsage;
        }
    }

    /// <summary>
    /// The single most important piece of how the car feels.
    /// </summary>
    /// <remarks>
    /// Three behaviours matter and all three are modelled:
    ///
    /// <list type="number">
    /// <item>Grip peaks at a small slip and <i>falls off</i> past it.
    /// That peak is what a driver hunts for, and the fall-off is what
    /// makes a spin recoverable or not.</item>
    /// <item>Grip per newton of load decreases as load increases. This is
    /// why weight transfer costs overall grip, and why anti-roll balance
    /// changes understeer and oversteer at all.</item>
    /// <item>Longitudinal and lateral grip share one budget. Brake and
    /// turn at the same time and you get less of each.</item>
    /// </list>
    /// </remarks>
    public static class Tire
    {
        /// <summary>
        /// Slip values at which each pure curve peaks, used to normalise
        /// combined slip. Derived from the default coefficients.
        /// </summary>
        public const double SlipRatioAtPeak = 0.12;

        /// <summary>About 7.2 degrees.</summary>
        public const double SlipAngleAtPeak = 0.125;

        /// <summary>
        /// The magic formula itself: normalised force for a normalised
        /// slip. Returns roughly -1..1, peaking a little above 1 for a
        /// racing tyre.
        /// </summary>
        public static double MagicFormula(double slip, double b, double c, double e)
        {
            double bs = b * slip;
            return Math.Sin(c * Math.Atan(bs - e * (bs - Math.Atan(bs))));
        }

        /// <summary>
        /// Effective friction coefficient at a given vertical load.
        /// Falls with load, which is the whole reason weight transfer
        /// matters. Floored so a load spike cannot drive mu negative.
        /// </summary>
        public static double MuAtLoad(TireParams p, double load)
        {
            double excess = load / p.LoadReference - 1.0;
            return Math.Max(0.35, p.MuNominal * (1.0 - p.LoadSensitivity * excess));
        }

        /// <summary>Peak longitudinal force available at a given load.</summary>
        public static double PeakForce(TireParams p, double load)
            => MuAtLoad(p, load) * load;

        /// <summary>Solve one contact patch.</summary>
        /// <param name="slipRatio">Longitudinal slip; 0 is rolling.</param>
        /// <param name="slipAngle">Lateral slip angle (rad).</param>
        /// <param name="load">Vertical load (N).</param>
        /// <param name="gripScale">
        /// Everything that scales the available friction without changing
        /// the shape of the curve: the surface under the wheel, tyre
        /// temperature and wear.
        /// </param>
        public static TireForces Solve(
            TireParams p,
            double slipRatio,
            double slipAngle,
            double load,
            double gripScale = 1.0)
        {
            if (load <= 1.0) return new TireForces(0, 0, 0);

            double mu = MuAtLoad(p, load) * gripScale;
            double peak = mu * load;

            /* Slip-circle method. Normalise each slip by the slip at
               which its own curve peaks, so a combined magnitude of 1
               sits on the peak of the friction ellipse whatever the
               direction. */
            double nLong = slipRatio / SlipRatioAtPeak;
            double nLat = slipAngle / SlipAngleAtPeak;
            double sigma = MathUtil.Hypot(nLong, nLat);

            if (sigma < 1e-6) return new TireForces(0, 0, 0);

            /* Blend the two curve shapes by direction: on the axes this
               reduces exactly to the pure longitudinal or pure lateral
               curve, and between them it interpolates smoothly.

               The weights are squared direction cosines because those
               sum to one. Using the cosines themselves would let the
               blend reach sqrt(2) times either curve at 45 degrees and
               the resultant would escape the friction circle — grip out
               of nowhere for braking into a corner. */
            double dLong = nLong / sigma;
            double dLat = nLat / sigma;
            double wLong = dLong * dLong;
            double wLat = dLat * dLat;

            double normalised =
                wLong * MagicFormula(sigma * SlipRatioAtPeak, p.LongB, p.LongC, p.LongE) +
                wLat * MagicFormula(sigma * SlipAngleAtPeak, p.LatB, p.LatC, p.LatE);

            double magnitude = normalised * peak;

            // Force opposes slip: driving slip pushes the car forward,
            // and slip to the right generates force to the left.
            double fLong = dLong * magnitude;
            double fLat = -dLat * magnitude;

            double usage = MathUtil.Clamp(
                MathUtil.Hypot(fLong, fLat) / Math.Max(peak, 1e-6), 0, 2);

            return new TireForces(fLong, fLat, usage);
        }
    }
}
