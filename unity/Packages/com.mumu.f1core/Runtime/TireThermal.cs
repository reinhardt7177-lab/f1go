using System;

namespace MumuF1
{
    /// <summary>
    /// Thermal and wear parameters for a tyre.
    /// </summary>
    /// <remarks>
    /// A tyre only delivers its quoted friction inside a temperature
    /// window perhaps thirty degrees wide. Cold, the rubber is too stiff
    /// to key into the road; overheated, it greases and the grip falls
    /// away. Everything that makes a stint interesting comes out of this:
    /// the out-lap, warming the fronts under braking, losing the rears
    /// through a long corner, managing a set to the end.
    /// </remarks>
    public sealed class TireThermalParams
    {
        /// <summary>Temperature of peak grip (deg C).</summary>
        public double OptimalTemp = 100.0;

        /// <summary>Half-width of the usable window (deg C).</summary>
        public double TempWindow = 25.0;

        /// <summary>Grip multiplier at the edge of the window.</summary>
        public double GripAtWindowEdge = 0.93;

        /// <summary>Lowest the multiplier falls to far outside it.</summary>
        public double GripFloor = 0.62;

        /* Sized from the equilibrium these have to hold rather than
           picked by feel. A tyre being worked hard dissipates on the
           order of 8 kW and should settle near 100 C in a 60 m/s
           airstream, which fixes the cooling conductance at about
           110 W/K: (100 - 26) x 110 = 8.1 kW. Get this wrong the other
           way — as a first pass did — and cooling swamps the heat input,
           so the tyres never come in at all. */

        /// <summary>Surface thermal mass (J/K) — responds within a corner.</summary>
        public double SurfaceHeatCapacity = 5_500.0;

        /// <summary>Core thermal mass (J/K) — responds over a lap.</summary>
        public double CoreHeatCapacity = 45_000.0;

        /// <summary>Conductance between surface and core (W/K).</summary>
        public double SurfaceToCore = 120.0;

        /// <summary>Convective cooling at rest (W/K).</summary>
        public double CoolingBase = 45.0;

        /*
         * Cooling per metre per second of airspeed (W/K per m/s).
         *
         * This was 1.1, and at 1.1 the model has no stable operating point
         * anywhere a race car lives. It is a closed loop and the loop has
         * positive gain: a hotter tyre grips less, a tyre that grips less
         * must slide further to make the same force, and sliding further is
         * exactly what heats it. Every sustained run therefore ended at the
         * clamp — 226 °C measured on a flat-out lap of the practice oval,
         * with the grip multiplier pinned at its 0.62 floor.
         *
         * It never showed up because nothing here had ever completed a lap.
         * Short runs read 74 to 85 °C and looked perfectly healthy; the
         * runaway needs about a minute. What it feels like is a car that
         * slides everywhere for no reason and gets worse the longer you
         * drive, which is precisely the complaint that sent me looking.
         *
         * Solving the loop for its fixed points puts the knee at 3.1: below
         * that there is only the clamp. Between 3.1 and about 5 a tyre that
         * starts cold settles correctly and a tyre that has already been
         * cooked never comes back, which is worse than either — you lose the
         * car once and it stays lost. So 5 was the first attempt, chosen for
         * being past that: one stable answer whatever the tyre has been
         * through.
         *
         * Driving it said 5 was not enough. A flat-out lap settled at
         * 154 °C, thirty degrees outside the window, and then kept climbing
         * to 190 as the car slowed and lost the airflow it was cooling with.
         * Working backwards from that plateau, a driven tyre at racing speed
         * is dissipating about 42 kW, not the 11 the first estimate assumed —
         * so the coefficient was solving the right equation with the wrong
         * load, and 9 is what that load actually needs.
         *
         * Which is worth stating as physics rather than as a fitted number.
         * The model routes every watt of contact-patch friction into the
         * tyre, and a real contact patch loses a great deal of it into the
         * road it is pressed against. There is no conduction term here and
         * this is standing in for one, which is also why scaling it with
         * airspeed is not merely convenient: both the convection and the
         * conduction it stands for rise with how fast the patch is moving
         * over fresh tarmac.
         *
         * What it gives, and the shape matters more than the numbers: about
         * 100 °C flat out, which is the middle of the working window; low
         * thirties ambling, which is cold and slow and should be; and
         * genuinely cooked — past 200 °C — only from wheelspin at low speed,
         * where there is no airflow to carry it away. You ruin tyres doing
         * burnouts, not down the straight. An overheated tyre recovers if
         * you back off, and the tenth lap is not a different car.
         */

        /// <summary>Extra convective cooling per m/s of airflow (W/K).</summary>
        public double CoolingPerSpeed = 9.0;

        public double AmbientTemp = 26.0;

        /* A hard-worked set puts roughly 25 MJ through each contact patch
           over a stint, which should leave it most of the way worn. */

        /// <summary>Wear per megajoule through the contact patch.</summary>
        public double WearPerMJ = 0.03;

        /// <summary>Grip multiplier once fully worn.</summary>
        public double GripAtFullWear = 0.72;

        /// <summary>Wear narrows the window: degrees the optimum drops by.</summary>
        public double WearTempPenalty = 8.0;
    }

    /// <summary>Mutable per-wheel condition. A class, because it is stepped in place.</summary>
    public sealed class TireCondition
    {
        public double SurfaceTemp;
        public double CoreTemp;

        /// <summary>0 is new, 1 is fully worn.</summary>
        public double Wear;
    }

    public static class TireThermal
    {
        /// <summary>
        /// A new set, out of the blankets.
        /// </summary>
        /// <remarks>
        /// Starting at the cold edge of the window rather than at the
        /// optimum makes the first lap a real out-lap: the tyres have to
        /// be worked into their window before the car will do what is
        /// asked of it.
        /// </remarks>
        public static TireCondition Fresh(TireThermalParams p, double? startTemp = null)
        {
            double t = startTemp ?? (p.OptimalTemp - p.TempWindow);
            return new TireCondition { SurfaceTemp = t, CoreTemp = t, Wear = 0.0 };
        }

        /// <summary>
        /// Grip multiplier from temperature: a raised cosine across the
        /// window, decaying outside it. A worn tyre wants to run cooler,
        /// so the window shifts down as rubber is lost.
        /// </summary>
        public static double ThermalGrip(TireThermalParams p, double temp, double wear)
        {
            double optimal = p.OptimalTemp - p.WearTempPenalty * wear;
            double d = Math.Abs(temp - optimal) / p.TempWindow;

            if (d <= 1.0)
            {
                // 1 at the centre, GripAtWindowEdge at the edge.
                return 1.0 - (1.0 - p.GripAtWindowEdge) * (1.0 - Math.Cos(d * Math.PI)) * 0.5;
            }

            double beyond = Math.Min(1.0, (d - 1.0) / 1.6);
            return Math.Max(
                p.GripFloor,
                p.GripAtWindowEdge
                    - (p.GripAtWindowEdge - p.GripFloor) * (1.0 - Math.Cos(beyond * Math.PI)) * 0.5);
        }

        /// <summary>Grip multiplier from wear alone.</summary>
        public static double WearGrip(TireThermalParams p, double wear)
            => 1.0 - (1.0 - p.GripAtFullWear) * MathUtil.Clamp(wear, 0, 1);

        /// <summary>Combined multiplier applied to the friction coefficient.</summary>
        public static double ConditionGrip(TireThermalParams p, TireCondition c)
            => ThermalGrip(p, c.SurfaceTemp, c.Wear) * WearGrip(p, c.Wear);

        /// <summary>Advance one tyre's condition by <paramref name="dt"/> seconds.</summary>
        /// <param name="frictionPower">
        /// Energy per second dissipated in the contact patch: force times
        /// the speed at which the patch is sliding, which is exactly what
        /// heats a tyre and exactly what wears it.
        /// </param>
        /// <param name="airspeed">For convective cooling (m/s).</param>
        public static void Step(
            TireThermalParams p,
            TireCondition c,
            double frictionPower,
            double airspeed,
            double dt,
            bool grounded)
        {
            double heatIn = Math.Max(0.0, frictionPower);

            double cooling = (p.CoolingBase + p.CoolingPerSpeed * Math.Max(0.0, airspeed))
                * (c.SurfaceTemp - p.AmbientTemp);
            double toCore = p.SurfaceToCore * (c.SurfaceTemp - c.CoreTemp);

            c.SurfaceTemp += ((heatIn - cooling - toCore) / p.SurfaceHeatCapacity) * dt;

            // The core is fed by the surface and loses heat far more slowly.
            double coreCooling = p.CoolingBase * 0.25 * (c.CoreTemp - p.AmbientTemp);
            c.CoreTemp += ((toCore - coreCooling) / p.CoreHeatCapacity) * dt;

            c.SurfaceTemp = MathUtil.Clamp(c.SurfaceTemp, p.AmbientTemp - 5, 260);
            c.CoreTemp = MathUtil.Clamp(c.CoreTemp, p.AmbientTemp - 5, 220);

            if (grounded)
            {
                c.Wear = MathUtil.Clamp(
                    c.Wear + (heatIn * dt * p.WearPerMJ) / 1_000_000.0, 0, 1);
            }
        }
    }
}
