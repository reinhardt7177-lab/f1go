using System;

namespace MumuF1
{
    /// <summary>Which way the wings are set.</summary>
    public enum AeroMode
    {
        Corner,
        Straight
    }

    /// <summary>
    /// Aerodynamic parameters.
    /// </summary>
    /// <remarks>
    /// This is what separates an F1 car from every other car: downforce
    /// grows with the square of speed, so grip <i>increases</i> the
    /// faster you go. A fast corner that is impossible at 150 km/h is
    /// flat at 250 km/h. Get this wrong and no amount of tyre tuning
    /// will make the car feel right.
    /// </remarks>
    public sealed class AeroParams
    {
        /// <summary>Lift coefficient times frontal area, whole car (m^2).</summary>
        public double ClA = 4.2;

        /* Sized from the top speeds the car should reach rather than
           picked: at 797 kW, cdA of 1.6 gives a drag-limited 336 km/h in
           corner mode, and cutting a quarter of it in straight mode gives
           370. Those are the right numbers for a 2026 car — the outright
           race record is Bottas's 372.5 km/h at Mexico in 2016, and that
           was at altitude. */

        /// <summary>Drag coefficient times frontal area (m^2).</summary>
        public double CdA = 1.6;

        /// <summary>Fraction of total downforce on the front axle, 0..1.</summary>
        public double FrontBalance = 0.44;

        /// <summary>Air density (kg/m^3) at sea level, 15 C.</summary>
        public double AirDensity = 1.225;

        /* Active aerodynamics, 2026. DRS is gone. In its place both wings
           are movable and every car may switch between a corner setting
           and a straight-line setting at will — it is part of the car,
           not an overtaking aid handed to whoever is close enough behind.
           Straight mode is far more aggressive than DRS ever was, because
           it reclines the front wing as well: the drag reduction is
           large, and so is the downforce given up for it. */

        /// <summary>Fraction of CdA removed in straight mode.</summary>
        public double StraightDragReduction = 0.25;

        /// <summary>Fraction of ClA given up for it.</summary>
        public double StraightDownforceLoss = 0.55;

        /* Ground effect. A modern F1 floor is a venturi: the closer it
           runs to the road, the faster the air underneath and the more it
           sucks the car down — right up until the flow separates and the
           downforce collapses. That collapse re-extends the springs, the
           floor rises, the flow reattaches, and the car slams down again.
           Porpoising is not scripted; it falls out of these numbers. */

        /// <summary>Ride height of peak downforce (m).</summary>
        public double OptimalRideHeight = 0.03;

        /// <summary>Below this the floor stalls (m).</summary>
        public double StallRideHeight = 0.016;

        /// <summary>Downforce multiplier at the optimal height.</summary>
        public double GroundEffectGain = 1.45;

        /// <summary>Multiplier once fully stalled.</summary>
        public double StallLoss = 0.62;

        /// <summary>Height above which ground effect has faded out (m).</summary>
        public double GroundEffectRange = 0.11;
    }

    /// <summary>What the air is doing to the car.</summary>
    public readonly struct AeroForces
    {
        /// <summary>Total downward force (N).</summary>
        public readonly double Downforce;

        /// <summary>Downforce at the front axle (N).</summary>
        public readonly double DownforceFront;

        /// <summary>Downforce at the rear axle (N).</summary>
        public readonly double DownforceRear;

        /// <summary>Rearward force opposing motion (N).</summary>
        public readonly double Drag;

        public AeroForces(double downforce, double front, double rear, double drag)
        {
            Downforce = downforce;
            DownforceFront = front;
            DownforceRear = rear;
            Drag = drag;
        }
    }

    public static class Aero
    {
        /// <summary>
        /// Downforce multiplier as a function of floor height: rising
        /// from 1 at <c>GroundEffectRange</c> to <c>GroundEffectGain</c>
        /// at the optimum, then falling steeply to <c>StallLoss</c> below
        /// the stall height.
        /// </summary>
        public static double GroundEffect(AeroParams p, double rideHeight)
        {
            double h = Math.Max(0.0, rideHeight);

            if (h >= p.GroundEffectRange) return 1.0;

            if (h >= p.OptimalRideHeight)
            {
                // Gaining downforce as the floor approaches the road.
                double t = (p.GroundEffectRange - h)
                    / (p.GroundEffectRange - p.OptimalRideHeight);
                return 1.0 + (p.GroundEffectGain - 1.0) * t * t;
            }

            if (h <= p.StallRideHeight) return p.StallLoss;

            /* Between the stall height and the optimum the floor is
               losing the flow — a short, steep transition, which is what
               makes it oscillate. */
            double u = (p.OptimalRideHeight - h)
                / (p.OptimalRideHeight - p.StallRideHeight);
            return p.GroundEffectGain + (p.StallLoss - p.GroundEffectGain) * u * u;
        }

        /// <summary>Solve the aerodynamics for one instant.</summary>
        /// <param name="speed">Forward speed (m/s); reverse produces the same drag.</param>
        /// <param name="mode">Wing setting; every car may use either, at any time.</param>
        /// <remarks>
        /// Ground effect is evaluated per axle, so a car bottoming at the
        /// front and riding high at the rear loses front downforce
        /// specifically — the balance moves rearward and the car
        /// understeers, exactly as it does in reality.
        /// </remarks>
        public static AeroForces Solve(
            AeroParams p,
            double speed,
            AeroMode mode,
            double? rideHeightFront = null,
            double? rideHeightRear = null)
        {
            double hFront = rideHeightFront ?? p.OptimalRideHeight;
            double hRear = rideHeightRear ?? p.OptimalRideHeight;

            double q = 0.5 * p.AirDensity * speed * speed; // dynamic pressure

            bool straight = mode == AeroMode.Straight;
            double clA = straight ? p.ClA * (1.0 - p.StraightDownforceLoss) : p.ClA;
            double cdA = straight ? p.CdA * (1.0 - p.StraightDragReduction) : p.CdA;

            double baseForce = q * clA;
            double front = baseForce * p.FrontBalance * GroundEffect(p, hFront);
            double rear = baseForce * (1.0 - p.FrontBalance) * GroundEffect(p, hRear);

            return new AeroForces(front + rear, front, rear, q * cdA);
        }

        /// <summary>
        /// Terminal speed for a given power — a sanity check while
        /// tuning, since at top speed all engine power goes into drag.
        /// </summary>
        public static double TerminalSpeed(
            AeroParams p, double powerWatts, AeroMode mode = AeroMode.Straight)
        {
            double cdA = mode == AeroMode.Straight
                ? p.CdA * (1.0 - p.StraightDragReduction)
                : p.CdA;
            return Math.Cbrt(powerWatts / (0.5 * p.AirDensity * cdA));
        }
    }
}
