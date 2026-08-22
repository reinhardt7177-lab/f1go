using System;
using System.Collections.Generic;

namespace MumuF1
{
    /// <summary>A frame on the centreline.</summary>
    public readonly struct TrackSample
    {
        /// <summary>Distance along the centreline (m).</summary>
        public readonly double S;
        public readonly Vec3 Position;

        /// <summary>Unit tangent, pointing the racing direction.</summary>
        public readonly Vec3 Tangent;

        /// <summary>Unit normal pointing to the driver's left.</summary>
        public readonly Vec3 Left;

        /// <summary>Signed curvature (1/m); positive turns left.</summary>
        public readonly double Curvature;

        public TrackSample(double s, Vec3 position, Vec3 tangent, Vec3 left, double curvature)
        {
            S = s;
            Position = position;
            Tangent = tangent;
            Left = left;
            Curvature = curvature;
        }
    }

    /// <summary>A world position, expressed against the centreline.</summary>
    public readonly struct Projection
    {
        /// <summary>Distance along the centreline (m).</summary>
        public readonly double S;

        /// <summary>Lateral offset; positive is left of the racing direction (m).</summary>
        public readonly double T;

        /// <summary>Height above the centreline at that point (m).</summary>
        public readonly double Height;

        public readonly TrackSample Sample;

        public Projection(double s, double t, double height, TrackSample sample)
        {
            S = s;
            T = t;
            Height = height;
            Sample = sample;
        }
    }

    /// <summary>
    /// The centreline: the load-bearing data structure of the whole
    /// project.
    /// </summary>
    /// <remarks>
    /// Once a circuit exists as a spline, everything else derives from
    /// it: the road mesh, the racing line, sector and timing lines,
    /// respawn points, and — most importantly — <see cref="Project"/>,
    /// which converts a world position into <c>(s, t)</c>: distance along
    /// the track and lateral offset from the centre. With that in hand,
    /// lap counting, sector timing, off-track detection, race position
    /// and the AI's target all become one-liners.
    ///
    /// Uniform Catmull-Rom through the control points, resampled at a
    /// fixed arc-length interval so that lookups by distance are a direct
    /// index rather than a search.
    /// </remarks>
    public sealed class CenterlineSpline
    {
        private readonly TrackSample[] _samples;
        private readonly double _spacing;

        public double Length { get; }
        public bool Closed { get; }
        public int SampleCount => _samples.Length;

        /// <param name="controlPoints">At least four points.</param>
        /// <param name="spacing">Resample interval in metres.</param>
        public CenterlineSpline(IReadOnlyList<Vec3> controlPoints, double spacing = 1.0, bool closed = true)
        {
            if (controlPoints == null || controlPoints.Count < 4)
            {
                throw new ArgumentException("a centreline needs at least four control points");
            }
            Closed = closed;

            // Dense evaluation first, then resample by arc length.
            var dense = new List<Vec3>();
            int segments = closed ? controlPoints.Count : controlPoints.Count - 1;
            const int perSegment = 64;

            for (int i = 0; i < segments; i++)
            {
                for (int j = 0; j < perSegment; j++)
                {
                    dense.Add(CatmullRom(controlPoints, i, (double)j / perSegment, closed));
                }
            }
            dense.Add(closed ? dense[0] : CatmullRom(controlPoints, segments - 1, 1, closed));

            // Cumulative arc length along the dense polyline.
            var cumulative = new double[dense.Count];
            for (int i = 1; i < dense.Count; i++)
            {
                cumulative[i] = cumulative[i - 1] + (dense[i] - dense[i - 1]).Length;
            }
            double total = cumulative[cumulative.Length - 1];
            Length = total;

            int count = Math.Max(8, (int)Math.Round(total / spacing));
            double step = total / count;
            _spacing = step;

            var positions = new Vec3[count];
            for (int i = 0; i < count; i++)
            {
                positions[i] = PointAtDistance(dense, cumulative, i * step);
            }

            /* Tangents from central differences on the resampled points —
               cheap and stable at uniform spacing. Two passes, because
               curvature is a difference of *tangents* and the first pass
               is still filling those in: computing it inline would read
               neighbours that had not been written yet. */
            var tangents = new Vec3[count];
            var lefts = new Vec3[count];
            for (int i = 0; i < count; i++)
            {
                Vec3 prev = positions[(i - 1 + count) % count];
                Vec3 next = positions[(i + 1) % count];
                tangents[i] = (next - prev).Normalised();
                // Left is up cross tangent, for a right-handed frame with +Y up.
                lefts[i] = Vec3.Cross(Vec3.Up, tangents[i]).Normalised();
            }

            _samples = new TrackSample[count];
            for (int i = 0; i < count; i++)
            {
                Vec3 dT = tangents[(i + 1) % count] - tangents[(i - 1 + count) % count];
                double curvature = Vec3.Dot(dT, lefts[i]) / (2 * step);
                _samples[i] = new TrackSample(i * step, positions[i], tangents[i], lefts[i], curvature);
            }
        }

        /// <summary>Interpolated frame at a distance along the track.</summary>
        public TrackSample SampleAt(double s)
        {
            int n = _samples.Length;
            double wrapped = Closed
                ? ((s % Length) + Length) % Length
                : MathUtil.Clamp(s, 0, Length);

            double f = wrapped / _spacing;
            int i0 = (int)Math.Floor(f) % n;
            int i1 = (i0 + 1) % n;
            TrackSample a = _samples[i0];
            TrackSample b = _samples[i1];
            double u = f - Math.Floor(f);

            return new TrackSample(
                wrapped,
                Vec3.Lerp(a.Position, b.Position, u),
                Vec3.Lerp(a.Tangent, b.Tangent, u).Normalised(),
                Vec3.Lerp(a.Left, b.Left, u).Normalised(),
                a.Curvature + (b.Curvature - a.Curvature) * u);
        }

        /// <summary>
        /// World position to <c>(s, t)</c>.
        /// </summary>
        /// <param name="hint">
        /// The previous result, if known. A car cannot have moved far in
        /// one tick, so this turns a scan of every sample into a look at
        /// sixty metres of them — which matters, because this is called
        /// every tick for every car on the circuit.
        /// </param>
        public Projection Project(Vec3 point, double? hint = null)
        {
            int n = _samples.Length;
            int bestIndex = 0;
            double bestDistSq = double.PositiveInfinity;

            if (hint == null)
            {
                for (int i = 0; i < n; i++)
                {
                    double d = Vec3.DistanceSquared(point, _samples[i].Position);
                    if (d < bestDistSq) { bestDistSq = d; bestIndex = i; }
                }
            }
            else
            {
                double h = ((hint.Value % Length) + Length) % Length;
                int centre = (int)Math.Round(h / _spacing);
                int window = Math.Max(4, (int)Math.Ceiling(60.0 / _spacing));
                for (int k = -window; k <= window; k++)
                {
                    int i = ((centre + k) % n + n) % n;
                    double d = Vec3.DistanceSquared(point, _samples[i].Position);
                    if (d < bestDistSq) { bestDistSq = d; bestIndex = i; }
                }
            }

            /* Refine against the segment leaving the nearest sample and
               the one entering it, and keep whichever is closer. One
               segment is not enough: the nearest *sample* is not always
               on the nearest *segment*. */
            Refine(point, bestIndex, bestIndex + 1, out Projection best, out double bestD);
            Refine(point, bestIndex - 1, bestIndex, out Projection alt, out double altD);
            return bestD <= altD ? best : alt;
        }

        private void Refine(Vec3 point, int i0, int i1, out Projection projection, out double distanceSq)
        {
            int n = _samples.Length;
            TrackSample a = _samples[((i0 % n) + n) % n];
            TrackSample b = _samples[((i1 % n) + n) % n];

            Vec3 seg = b.Position - a.Position;
            double segLenSq = Math.Max(1e-9, Vec3.Dot(seg, seg));
            double u = MathUtil.Clamp(Vec3.Dot(point - a.Position, seg) / segLenSq, 0, 1);

            double s = a.S + u * _spacing;
            TrackSample sample = SampleAt(s);
            Vec3 delta = point - sample.Position;

            projection = new Projection(s, Vec3.Dot(delta, sample.Left), delta.Y, sample);
            distanceSq = Vec3.Dot(delta, delta);
        }

        private static Vec3 CatmullRom(IReadOnlyList<Vec3> points, int segment, double u, bool closed)
        {
            int n = points.Count;
            Vec3 At(int i) => closed
                ? points[((i % n) + n) % n]
                : points[(int)MathUtil.Clamp(i, 0, n - 1)];

            Vec3 p0 = At(segment - 1), p1 = At(segment), p2 = At(segment + 1), p3 = At(segment + 2);

            double u2 = u * u;
            double u3 = u2 * u;
            double Blend(double a, double b, double c, double d) => 0.5 *
                (2 * b + (-a + c) * u + (2 * a - 5 * b + 4 * c - d) * u2 + (-a + 3 * b - 3 * c + d) * u3);

            return new Vec3(
                Blend(p0.X, p1.X, p2.X, p3.X),
                Blend(p0.Y, p1.Y, p2.Y, p3.Y),
                Blend(p0.Z, p1.Z, p2.Z, p3.Z));
        }

        private static Vec3 PointAtDistance(List<Vec3> dense, double[] cumulative, double s)
        {
            int lo = 0;
            int hi = cumulative.Length - 1;
            while (lo < hi - 1)
            {
                int mid = (lo + hi) >> 1;
                if (cumulative[mid] <= s) lo = mid; else hi = mid;
            }
            double segLen = cumulative[hi] - cumulative[lo];
            double u = segLen > 1e-9 ? (s - cumulative[lo]) / segLen : 0;
            return Vec3.Lerp(dense[lo], dense[hi], u);
        }
    }
}
