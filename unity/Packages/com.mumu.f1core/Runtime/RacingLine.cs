using System;
using System.Collections.Generic;

namespace MumuF1
{
    /// <summary>How the racing line is found.</summary>
    public sealed class RacingLineOptions
    {
        /// <summary>Distance between stations (m).</summary>
        public double Spacing { get; set; } = 5;

        /// <summary>Smoothing passes. More converges harder on the shortest path.</summary>
        public int Iterations { get; set; } = 600;

        /// <summary>How far each pass moves a point, zero to one.</summary>
        public double Relaxation { get; set; } = 0.35;

        /// <summary>Margin kept inside the white lines (m) — half a car and a little.</summary>
        public double Margin { get; set; } = 1.3;

        /// <summary>Passes of a 1-2-1 filter over the curvature estimate.</summary>
        public int CurvatureSmoothing { get; set; } = 6;
    }

    /// <summary>
    /// The racing line.
    /// </summary>
    /// <remarks>
    /// Stored as a lateral offset from the centreline at each station, so it
    /// indexes by the same <c>s</c> everything else uses. That keeps the whole
    /// stack on one coordinate: the car's position projects to <c>s</c>, the
    /// line says where to be at that <c>s</c>, and the speed profile says how
    /// fast.
    ///
    /// The line is found by Laplacian smoothing under a width constraint:
    /// repeatedly pull each point towards the midpoint of its neighbours,
    /// then clamp it back inside the road. Left alone that converges on the
    /// shortest path round the circuit, which straightens every corner it can
    /// and is a good first approximation to a racing line — it runs wide on
    /// entry, cuts the apex and drifts out on exit, because that is what the
    /// shortest path through a corridor does.
    ///
    /// It is not a minimum-curvature line, which is what a real optimiser
    /// would produce and which is meaningfully quicker. The difference is
    /// mostly in long corners, where the shortest path apexes too early.
    /// </remarks>
    public sealed class RacingLine
    {
        private readonly Circuit _circuit;
        private readonly float[] _offsets;
        private readonly float[] _curvature;

        /// <summary>Lateral offset from the centreline at each station (m).</summary>
        public IReadOnlyList<float> Offsets => _offsets;

        /// <summary>Signed curvature of the line itself (1/m).</summary>
        public IReadOnlyList<float> Curvature => _curvature;

        public double Spacing { get; }
        public double Length { get; }
        public int StationCount => _offsets.Length;

        public RacingLine(Circuit circuit, RacingLineOptions options = null)
        {
            _circuit = circuit ?? throw new ArgumentNullException(nameof(circuit));
            options = options ?? new RacingLineOptions();

            var count = Math.Max(16, (int)Math.Round(circuit.Length / options.Spacing,
                MidpointRounding.AwayFromZero));
            Spacing = circuit.Length / count;
            Length = circuit.Length;

            /* Single precision, matching the reference's storage rather than
               improving on it. The arithmetic is double either way — what is
               kept in single is the value the next pass reads back, and the
               relaxation loop runs six hundred times, so widening it here
               would converge on a slightly different line to the one the web
               version drives. */
            _offsets = new float[count];
            _curvature = new float[count];

            // The centreline frames, cached once; the loop touches them
            // hundreds of times each.
            var centre = new Vec3[count];
            var left = new Vec3[count];
            var limit = new double[count];

            for (var i = 0; i < count; i++)
            {
                var s = i * Spacing;
                var sample = circuit.Spline.SampleAt(s);
                centre[i] = sample.Position;
                left[i] = sample.Left;
                limit[i] = Math.Max(0, circuit.HalfWidthAt(s) - options.Margin);
            }

            /* Road width is stated per section, so it steps at every
               boundary: a straight is 9.2 m half-width and a hairpin 7.6, and
               the constraint drops 1.5 m over a single station. A line pinned
               to that boundary inherits the step as a kink, and the sharpest
               curvature on the whole circuit ends up being on a straight.
               Narrowing early instead keeps the line legal and keeps the
               corner where it belongs. */
            const int window = 3;
            var eased = new double[count];
            for (var i = 0; i < count; i++)
            {
                var narrowest = limit[i];
                for (var k = -window; k <= window; k++)
                {
                    narrowest = Math.Min(narrowest, limit[Wrap(i + k, count)]);
                }
                eased[i] = narrowest;
            }
            Smooth(eased, 2);
            for (var i = 0; i < count; i++) limit[i] = Math.Min(limit[i], eased[i]);

            for (var pass = 0; pass < options.Iterations; pass++)
            {
                for (var i = 0; i < count; i++)
                {
                    var prev = Point(centre, left, Wrap(i - 1, count));
                    var next = Point(centre, left, Wrap(i + 1, count));
                    var here = Point(centre, left, i);

                    /* Move towards the midpoint of the neighbours, then
                       express the result as a lateral offset again and clamp
                       it to the road. */
                    var midpoint = (prev + next) * 0.5;
                    var moved = here + (midpoint - here) * options.Relaxation;
                    var lateral = Vec3.Dot(moved - centre[i], left[i]);

                    _offsets[i] = (float)MathUtil.Clamp(lateral, -limit[i], limit[i]);
                }
            }

            // Curvature of the resulting line, through three consecutive
            // points.
            for (var i = 0; i < count; i++)
            {
                var a = Point(centre, left, Wrap(i - 1, count));
                var b = Point(centre, left, i);
                var c = Point(centre, left, Wrap(i + 1, count));
                _curvature[i] = (float)SignedCurvature(a, b, c, left[i]);
            }

            /* Three points five metres apart give a noisy estimate, and the
               line is pinned hard against the boundary in places, which adds
               kinks of its own. The speed profile turns curvature directly
               into a target speed, so that noise becomes a target that jumps
               about between neighbouring stations and a driver that brakes at
               phantom corners. */
            Smooth(_curvature, options.CurvatureSmoothing);
        }

        private Vec3 Point(Vec3[] centre, Vec3[] left, int i) => centre[i] + left[i] * _offsets[i];

        private int Index(double s)
        {
            var n = _offsets.Length;
            var wrapped = ((s % Length) + Length) % Length;
            return Math.Min(n - 1, (int)Math.Floor(wrapped / Spacing));
        }

        /// <summary>Lateral offset of the line at a distance along the circuit.</summary>
        public double OffsetAt(double s)
        {
            var n = _offsets.Length;
            var wrapped = ((s % Length) + Length) % Length;
            var f = wrapped / Spacing;
            var i = (int)Math.Floor(f) % n;
            var j = (i + 1) % n;
            var u = f - Math.Floor(f);
            /* Both widened before the subtraction, which is not fussiness.
               The arrays are single precision, so `b - a` on two elements is a
               float subtraction and rounds when the two have different
               exponents — where the reference, reading the same values out of
               a Float32Array, gets doubles and subtracts exactly. Storing in
               float is deliberate and matching the reference; doing the
               arithmetic in float is not. */
            double a = _offsets[i];
            double b = _offsets[j];
            return a + (b - a) * u;
        }

        public double CurvatureAt(double s) => _curvature[Index(s)];

        /// <summary>
        /// The road's left vector at a distance along the circuit.
        /// </summary>
        /// <remarks>
        /// Straight off the spline rather than off the racing line, because
        /// the two differ only by the lateral offset and it is the road's
        /// frame that anything placed <em>beside</em> the line — a grid box,
        /// a marker — has to be square to.
        /// </remarks>
        public Vec3 LeftAt(double s) => _circuit.Spline.SampleAt(s).Left;

        /// <summary>World position of the racing line at a distance along the circuit.</summary>
        public Vec3 PointAt(double s)
        {
            var sample = _circuit.Spline.SampleAt(s);
            return sample.Position + sample.Left * OffsetAt(s);
        }

        private static int Wrap(int i, int n) => ((i % n) + n) % n;

        /// <summary>In-place 1-2-1 smoothing of a periodic array.</summary>
        private static void Smooth(double[] values, int passes)
        {
            var n = values.Length;
            var scratch = new double[n];
            for (var pass = 0; pass < passes; pass++)
            {
                for (var i = 0; i < n; i++)
                {
                    scratch[i] = 0.25 * values[Wrap(i - 1, n)]
                               + 0.5 * values[i]
                               + 0.25 * values[Wrap(i + 1, n)];
                }
                Array.Copy(scratch, values, n);
            }
        }

        private static void Smooth(float[] values, int passes)
        {
            var n = values.Length;
            var scratch = new float[n];
            for (var pass = 0; pass < passes; pass++)
            {
                for (var i = 0; i < n; i++)
                {
                    scratch[i] = (float)(0.25 * values[Wrap(i - 1, n)]
                                       + 0.5 * values[i]
                                       + 0.25 * values[Wrap(i + 1, n)]);
                }
                Array.Copy(scratch, values, n);
            }
        }

        /// <summary>
        /// Curvature through three points, signed so that positive turns
        /// towards <paramref name="left"/> — the convention the centreline
        /// uses.
        /// </summary>
        private static double SignedCurvature(Vec3 a, Vec3 b, Vec3 c, Vec3 left)
        {
            var ab = b - a;
            var bc = c - b;
            var ac = c - a;

            var lab = ab.Length;
            var lbc = bc.Length;
            var lac = ac.Length;
            if (lab < 1e-6 || lbc < 1e-6 || lac < 1e-6) return 0;

            // Menger curvature: four times the triangle's area over the
            // product of its sides.
            var area = Vec3.Cross(ab, bc).Length / 2;
            var magnitude = 4 * area / (lab * lbc * lac);

            /* The turn direction comes from which side of the chord the
               middle point falls, measured against the road's left vector. */
            var toMid = b - (a + c) * 0.5;
            return Vec3.Dot(toMid, left) >= 0 ? -magnitude : magnitude;
        }
    }
}
