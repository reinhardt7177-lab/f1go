using System;
using System.Collections.Generic;

namespace MumuF1
{
    /// <summary>
    /// The car, as much of it as a speed profile needs to know.
    /// </summary>
    /// <remarks>
    /// Not the whole vehicle. A profile asks three questions — how heavy is
    /// it, how much downforce and drag does it make, and how much grip do the
    /// tyres have under that load — and nothing about suspension, gearing or
    /// steering changes the answer. Keeping it to this means the profile can
    /// be tested against a car that does not exist yet.
    /// </remarks>
    public sealed class ProfileCar
    {
        public double Mass { get; set; } = 798;
        public AeroParams Aero { get; set; } = new AeroParams();
        public TireParams Tire { get; set; } = new TireParams();
    }

    /// <summary>How much of the car the profile is willing to use.</summary>
    public sealed class ProfileOptions
    {
        /// <summary>
        /// Fraction of the tyre's peak the driver actually uses.
        /// </summary>
        /// <remarks>
        /// Below one because a profile driven at exactly the limit has no
        /// margin for the controller's own error, and a controller with no
        /// margin spends the lap correcting a slide.
        /// </remarks>
        public double GripUsage { get; set; } = 0.82;

        /// <summary>Ceiling, for a circuit with no corner slow enough to set one.</summary>
        public double MaxSpeed { get; set; } = 103;

        /// <summary>Longitudinal deceleration ceiling from the brakes alone (m/s²).</summary>
        public double MaxBraking { get; set; } = 45;
    }

    /// <summary>
    /// Speed profile over the racing line.
    /// </summary>
    /// <remarks>
    /// Three steps, in order.
    ///
    /// <b>Corner limits.</b> The fastest a corner can be taken is where the
    /// lateral acceleration the tyres can produce equals the one the corner
    /// demands. For a car with wings that is not a fixed number, because the
    /// grip itself grows with speed:
    /// <code>
    ///     v² · κ = μ · (g + ½ρ·ClA·v² / m)
    /// </code>
    /// Solving for v gives
    /// <code>
    ///     v² = μg / (κ − μρ·ClA / 2m)
    /// </code>
    /// and the denominator going negative is not a failure — it means
    /// downforce grows faster than the corner demands, so the corner is flat
    /// out at any speed. That is exactly why a 150 m sweep is flat and a 42 m
    /// hairpin is not, and it falls straight out of the algebra rather than
    /// out of a table somebody tuned.
    ///
    /// <b>Backward pass.</b> Walk the lap backwards, capping each station at
    /// the speed from which you could still slow to the next one. This is
    /// what produces braking points.
    ///
    /// <b>Forward pass.</b> Walk forwards, capping each station at the speed
    /// you could actually have reached from the last one. This is what stops
    /// the profile promising a corner exit the engine cannot serve.
    ///
    /// Both passes spend whatever grip is left after cornering has taken its
    /// share of the friction circle, so a car still turning cannot also brake
    /// at full force.
    /// </remarks>
    public sealed class SpeedProfile
    {
        private readonly RacingLine _line;
        private readonly ProfileOptions _options;
        private readonly float[] _target;

        /// <summary>Target speed at each station of the racing line (m/s).</summary>
        public IReadOnlyList<float> Target => _target;

        public double Spacing { get; }
        public double MaxSpeed => _options.MaxSpeed;

        /// <summary>
        /// Fastest speed a corner of curvature <paramref name="kappa"/> can
        /// be taken at.
        /// </summary>
        /// <remarks>
        /// Solved iteratively because the friction coefficient falls as load
        /// rises and the load depends on the speed being solved for. Four
        /// passes is plenty; it converges fast.
        /// </remarks>
        public static double CornerLimit(double kappa, ProfileCar car, ProfileOptions options)
        {
            var k = Math.Abs(kappa);
            if (k < 1e-7) return options.MaxSpeed;

            var m = car.Mass;
            var weight = m * MathUtil.Gravity;
            var v = 40.0;

            for (var pass = 0; pass < 4; pass++)
            {
                var downforce = 0.5 * car.Aero.AirDensity * v * v * car.Aero.ClA;
                var mu = Tire.MuAtLoad(car.Tire, (weight + downforce) / 4) * options.GripUsage;

                // v² (κ − μρClA/2m) = μg
                var aeroTerm = mu * car.Aero.AirDensity * car.Aero.ClA / (2 * m);
                var denom = k - aeroTerm;

                // Downforce outruns the corner: flat out.
                if (denom <= 1e-7) return options.MaxSpeed;

                v = Math.Min(options.MaxSpeed, Math.Sqrt(mu * MathUtil.Gravity / denom));
            }

            return v;
        }

        /// <summary>Total acceleration the tyres can deliver at a speed (m/s²).</summary>
        private static double GripAcceleration(double v, ProfileCar car, ProfileOptions options)
        {
            var weight = car.Mass * MathUtil.Gravity;
            var downforce = 0.5 * car.Aero.AirDensity * v * v * car.Aero.ClA;
            var load = weight + downforce;
            var mu = Tire.MuAtLoad(car.Tire, load / 4) * options.GripUsage;
            return mu * load / car.Mass;
        }

        /// <summary>What is left for braking or driving once cornering has taken its cut.</summary>
        private static double LongitudinalBudget(
            double v, double kappa, ProfileCar car, ProfileOptions options)
        {
            var total = GripAcceleration(v, car, options);
            var lateral = v * v * Math.Abs(kappa);
            var remaining = total * total - lateral * lateral;
            return remaining <= 0 ? 0 : Math.Sqrt(remaining);
        }

        public SpeedProfile(RacingLine line, ProfileCar car = null, ProfileOptions options = null)
        {
            _line = line ?? throw new ArgumentNullException(nameof(line));
            car = car ?? new ProfileCar();
            _options = options ?? new ProfileOptions();

            var n = line.StationCount;
            Spacing = line.Spacing;
            _target = new float[n];

            // 1. corner limits
            for (var i = 0; i < n; i++)
            {
                _target[i] = (float)CornerLimit(line.Curvature[i], car, _options);
            }

            /* Engine-limited acceleration, from power rather than torque:
               near top speed it is power that runs out, not grip. */
            const double power = 700_000 * 0.9;
            double EngineAccel(double v) => Math.Min(18, power / (car.Mass * Math.Max(v, 8)));

            double Drag(double v) =>
                0.5 * car.Aero.AirDensity * v * v * car.Aero.CdA / car.Mass;

            // 2. backward pass — braking points
            for (var pass = 0; pass < 2; pass++)
            {
                for (var step = 0; step < n; step++)
                {
                    var i = (n - 1 - step + n) % n;
                    var next = (i + 1) % n;
                    var vNext = _target[next];
                    var budget = Math.Min(
                        _options.MaxBraking,
                        LongitudinalBudget(_target[i], line.Curvature[i], car, _options));

                    // Drag helps you slow down.
                    var decel = budget + Drag(_target[i]);
                    var reachable = Math.Sqrt(vNext * vNext + 2 * decel * Spacing);
                    if (reachable < _target[i]) _target[i] = (float)reachable;
                }
            }

            // 3. forward pass — what the car can actually get back
            for (var pass = 0; pass < 2; pass++)
            {
                for (var step = 0; step < n; step++)
                {
                    var i = step % n;
                    var next = (i + 1) % n;
                    var v = (double)_target[i];
                    var budget = LongitudinalBudget(v, line.Curvature[i], car, _options);
                    var accel = Math.Max(0, Math.Min(budget, EngineAccel(v)) - Drag(v));
                    var reachable = Math.Sqrt(v * v + 2 * accel * Spacing);
                    if (reachable < _target[next]) _target[next] = (float)reachable;
                }
            }
        }

        /// <summary>Interpolated target speed at a distance along the circuit (m/s).</summary>
        public double At(double s)
        {
            var n = _target.Length;
            var length = _line.Length;
            var wrapped = ((s % length) + length) % length;
            var f = wrapped / Spacing;
            var i = (int)Math.Floor(f) % n;
            var j = (i + 1) % n;
            var u = f - Math.Floor(f);
            return _target[i] + (_target[j] - _target[i]) * u;
        }

        /// <summary>
        /// The slowest target anywhere in the next <paramref name="distance"/>
        /// metres — what the driver should actually be aiming at, since
        /// braking has to start before the corner rather than at it.
        /// </summary>
        public double Lookahead(double s, double distance)
        {
            var slowest = At(s);
            for (var d = Spacing; d <= distance; d += Spacing)
            {
                slowest = Math.Min(slowest, At(s + d));
            }
            return slowest;
        }

        /// <summary>Estimated lap time if the profile were driven exactly (s).</summary>
        public double IdealLapTime()
        {
            var t = 0.0;
            foreach (var v in _target) t += Spacing / Math.Max(1, v);
            return t;
        }
    }
}
