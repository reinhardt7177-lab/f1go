using System;
using System.Collections.Generic;

namespace MumuF1
{
    /// <summary>What a wheel is standing on.</summary>
    public enum SurfaceKind
    {
        Tarmac,
        Kerb,
        Runoff,
        Grass,
        Gravel
    }

    /// <summary>Friction multipliers applied to the tyre's coefficient.</summary>
    public static class Surface
    {
        public static double Grip(SurfaceKind kind)
        {
            switch (kind)
            {
                case SurfaceKind.Tarmac: return 1.0;
                case SurfaceKind.Kerb: return 0.86;
                case SurfaceKind.Runoff: return 0.78;
                case SurfaceKind.Gravel: return 0.42;
                case SurfaceKind.Grass: return 0.33;
                default: throw new ArgumentOutOfRangeException(nameof(kind));
            }
        }
    }

    /// <summary>One straight or one constant-radius corner.</summary>
    /// <remarks>
    /// Settable rather than init-only, and deliberately. <c>init</c> needs
    /// <c>System.Runtime.CompilerServices.IsExternalInit</c>, which .NET 8
    /// has and the netstandard2.1 profile Unity compiles against does not —
    /// so it would build green in CI and then fail to import in the editor,
    /// which is the one failure this whole arrangement exists to prevent.
    /// The specs are built once into static readonly fields and never
    /// touched again, so nothing is lost but the compiler's help.
    /// </remarks>
    public sealed class CircuitSection
    {
        public string Name { get; set; } = string.Empty;

        /// <summary>Arc length along the centreline (m).</summary>
        public double Length { get; set; }

        /// <summary>Corner radius (m). Zero is a straight; positive turns right.</summary>
        public double Radius { get; set; }

        /// <summary>Rise over run; 0.14 is a fourteen per cent climb.</summary>
        public double Gradient { get; set; }

        /// <summary>Banking (rad); positive raises the outside of a right-hander.</summary>
        public double Banking { get; set; }

        /// <summary>
        /// Road half-width (m). Null carries the previous section's forward,
        /// which is why it is nullable and the three above are not: zero is a
        /// meaningful radius, gradient and banking, but not a meaningful width.
        /// </summary>
        public double? HalfWidth { get; set; }

        /// <summary>Run-off beyond the kerb on each side (m). Null carries forward.</summary>
        public double? Runoff { get; set; }
    }

    /// <summary>
    /// A circuit as a track map describes it: a sequence of straights and
    /// constant-radius corners, each with a length, a gradient and a banking
    /// angle.
    /// </summary>
    /// <remarks>
    /// A much better source format than a list of coordinates. It is
    /// readable, it is editable by someone holding a track map, and corner
    /// radii — the numbers that actually decide how a circuit drives — are
    /// stated directly instead of being implied by point spacing.
    /// </remarks>
    public sealed class CircuitSpec
    {
        public string Id { get; set; } = string.Empty;
        public string Name { get; set; } = string.Empty;
        public string Country { get; set; } = string.Empty;

        public IReadOnlyList<CircuitSection> Sections { get; set; } = Array.Empty<CircuitSection>();

        /// <summary>Distances along the lap where each sector ends; the last is the lap.</summary>
        public IReadOnlyList<double> SectorSplits { get; set; } = Array.Empty<double>();

        /// <summary>Half-width used until a section overrides it.</summary>
        public double DefaultHalfWidth { get; set; }

        public double DefaultRunoff { get; set; }
        public double KerbWidth { get; set; }

        /// <summary>Where the timing line sits, as a distance from the first section.</summary>
        public double StartLine { get; set; }
    }

    /// <summary>
    /// A built circuit: the centreline as a spline, plus the cross-section
    /// profile that says how wide the road is and what lies beyond it.
    /// </summary>
    public sealed class Circuit
    {
        /// <summary>Per-sample cross-section, on its own uniform grid.</summary>
        private readonly struct Profile
        {
            public readonly double HalfWidth;
            public readonly double Runoff;
            public readonly double Banking;
            public readonly string Section;

            public Profile(double halfWidth, double runoff, double banking, string section)
            {
                HalfWidth = halfWidth;
                Runoff = runoff;
                Banking = banking;
                Section = section;
            }
        }

        public CenterlineSpline Spline { get; }
        public CircuitSpec Spec { get; }
        public double Length { get; }
        public double KerbWidth { get; }

        /// <summary>Sector boundaries in metres, ascending; the last is <see cref="Length"/>.</summary>
        public IReadOnlyList<double> SectorSplits => _sectorSplits;

        private readonly Profile[] _profile;
        private readonly double _profileSpacing;
        private readonly double[] _sectorSplits;

        private Circuit(CircuitSpec spec, IReadOnlyList<IntegratedSample> samples)
        {
            Spec = spec;
            KerbWidth = spec.KerbWidth;

            var controlPoints = new Vec3[samples.Count];
            for (var i = 0; i < samples.Count; i++) controlPoints[i] = samples[i].Position;

            Spline = new CenterlineSpline(controlPoints, 2, true);
            Length = Spline.Length;

            // The integration and the spline resample at different rates, so
            // the profile is stored on its own uniform grid and looked up by
            // distance rather than by index into the spline.
            _profileSpacing = Length / samples.Count;
            _profile = new Profile[samples.Count];
            for (var i = 0; i < samples.Count; i++)
            {
                var s = samples[i];
                _profile[i] = new Profile(s.HalfWidth, s.Runoff, s.Banking, s.Section);
            }

            _sectorSplits = new double[spec.SectorSplits.Count];
            for (var i = 0; i < _sectorSplits.Length; i++)
            {
                _sectorSplits[i] = MathUtil.Clamp(spec.SectorSplits[i], 0, Length);
            }
            if (_sectorSplits.Length > 0) _sectorSplits[_sectorSplits.Length - 1] = Length;
        }

        private Profile ProfileAt(double s)
        {
            var n = _profile.Length;
            var wrapped = ((s % Length) + Length) % Length;
            var i = Math.Min(n - 1, (int)Math.Floor(wrapped / _profileSpacing));
            return _profile[i];
        }

        public double HalfWidthAt(double s) => ProfileAt(s).HalfWidth;

        public double RunoffAt(double s) => ProfileAt(s).Runoff;

        public double BankingAt(double s) => ProfileAt(s).Banking;

        public string SectionAt(double s) => ProfileAt(s).Section;

        /// <summary>Which surface a point sits on, given its lateral offset.</summary>
        public SurfaceKind SurfaceAt(double s, double t)
        {
            var p = ProfileAt(s);
            var d = Math.Abs(t);
            if (d <= p.HalfWidth) return SurfaceKind.Tarmac;
            if (d <= p.HalfWidth + KerbWidth) return SurfaceKind.Kerb;
            if (d <= p.HalfWidth + KerbWidth + p.Runoff) return SurfaceKind.Runoff;
            return SurfaceKind.Grass;
        }

        /// <summary>Grip multiplier for a position on the road.</summary>
        public double GripAt(double s, double t) => Surface.Grip(SurfaceAt(s, t));

        /// <summary>True when all four wheels would be within the white lines.</summary>
        public bool IsOnTrack(double s, double t) => Math.Abs(t) <= HalfWidthAt(s);

        /// <summary>Which sector a distance falls in, zero-based.</summary>
        public int SectorAt(double s)
        {
            var wrapped = ((s % Length) + Length) % Length;
            for (var i = 0; i < _sectorSplits.Length; i++)
            {
                if (wrapped < _sectorSplits[i]) return i;
            }
            return _sectorSplits.Length - 1;
        }

        private struct IntegratedSample
        {
            public Vec3 Position;
            public double HalfWidth;
            public double Runoff;
            public double Banking;
            public string Section;
        }

        /// <summary>
        /// Walk the section list, integrating heading and height.
        /// </summary>
        /// <remarks>
        /// Heading is measured so that zero points along -Z (the forward
        /// axis) and increases when turning right, matching the
        /// right-handed, +Y up convention used everywhere else.
        /// </remarks>
        public static Circuit Build(CircuitSpec spec, double step = 4)
        {
            var samples = new List<IntegratedSample>();

            // A closed lap must turn through exactly one full revolution.
            // Radii read off a track map never sum to that on their own, and
            // the shortfall appears as a kink in the tangent at the timing
            // line: the spline is closed in position but not in direction, so
            // a car driving straight through the line finds the road at an
            // angle to it and leaves the circuit. Normalising the total turn
            // removes the kink at the cost of adjusting every radius by the
            // same small factor.
            var totalTurn = 0.0;
            foreach (var section in spec.Sections)
            {
                if (section.Radius != 0) totalTurn += section.Length / section.Radius;
            }
            var turnScale = Math.Abs(totalTurn) > 1e-6
                ? Math.Sign(totalTurn) * 2 * Math.PI / totalTurn
                : 1.0;

            var heading = 0.0;
            var x = 0.0;
            var y = 0.0;
            var z = 0.0;
            var halfWidth = spec.DefaultHalfWidth;
            var runoff = spec.DefaultRunoff;

            foreach (var section in spec.Sections)
            {
                if (section.HalfWidth.HasValue) halfWidth = section.HalfWidth.Value;
                if (section.Runoff.HasValue) runoff = section.Runoff.Value;

                var gradient = section.Gradient;
                var banking = section.Banking;
                var radius = section.Radius;
                var steps = Math.Max(1, (int)Math.Round(section.Length / step, MidpointRounding.AwayFromZero));
                var ds = section.Length / steps;

                for (var i = 0; i < steps; i++)
                {
                    samples.Add(new IntegratedSample
                    {
                        Position = new Vec3(x, y, z),
                        HalfWidth = halfWidth,
                        Runoff = runoff,
                        Banking = banking,
                        Section = section.Name
                    });

                    // Advance along the current heading, then turn.
                    x += Math.Sin(heading) * ds;
                    z += -Math.Cos(heading) * ds;
                    y += gradient * ds;

                    if (radius != 0) heading += ds / radius * turnScale;
                }
            }

            BlurBanking(samples, step);
            CloseTheLoop(samples);

            // Round off the vertical profile — after closing the loop, not
            // before.
            //
            // Gradient is stated per section, so it steps at every boundary:
            // at Interlagos the drop into the Senna S runs at -8 per cent
            // into a climb at +5, and that is a crease rather than a
            // compression. A car with 50 mm of floor clearance and a 3.6 m
            // wheelbase grounds out on one and stops dead. Real circuits have
            // vertical curves; a few smoothing passes give these ones the
            // same, spreading each transition over roughly twenty metres.
            //
            // Order matters. Smoothing first would blend the unclosed start
            // and end heights across the seam, dragging the whole first
            // corner up with it — the closure ramp is only correct on an
            // unsmoothed profile.
            SmoothHeights(samples, 20);

            return new Circuit(spec, samples);
        }

        /// <summary>
        /// Ramp the banking in and out.
        /// </summary>
        /// <remarks>
        /// A section carries one banking angle, so the value written by the
        /// integration is a step function: on the proving oval it goes from
        /// level to three and a half degrees between one four-metre sample
        /// and the next. The road edge is nine and a half metres from the
        /// centreline, so that step lifts it by <c>9.5 * sin(0.06)</c> —
        /// 570 millimetres, measured. And the mesh is the collider, so it is
        /// not a visual seam; it is a half-metre wall across the road at the
        /// entry to every banked corner. A car meeting one at speed is
        /// launched and lands on its roof, which is exactly what was
        /// reported.
        ///
        /// Real circuits ramp banking in over a hundred metres and more — a
        /// superspeedway does not tilt under you at a line — and so does
        /// this: a periodic box blur, run twice so the result is smooth
        /// rather than merely continuous. Two passes of a 120 m window spread
        /// the transition over about 175 m, which takes the 570 mm step down
        /// to around 13 mm from one four-metre section of road to the next.
        /// That is a road surface; the original was a kerb laid across the
        /// racing line.
        ///
        /// Only banking is smoothed. A gradient step changes the slope rather
        /// than the height, so it is a kink of a few degrees rather than a
        /// wall, and blurring it would quietly move where every hill is.
        /// </remarks>
        private static void BlurBanking(List<IntegratedSample> samples, double step)
        {
            const double ramp = 120;
            var n = samples.Count;
            var half = Math.Max(1, (int)Math.Round(ramp / (2 * step), MidpointRounding.AwayFromZero));

            for (var pass = 0; pass < 2; pass++)
            {
                var source = new double[n];
                for (var i = 0; i < n; i++) source[i] = samples[i].Banking;

                for (var i = 0; i < n; i++)
                {
                    var total = 0.0;
                    for (var k = -half; k <= half; k++) total += source[Wrap(i + k, n)];

                    var sample = samples[i];
                    sample.Banking = total / (half * 2 + 1);
                    samples[i] = sample;
                }
            }
        }

        /// <summary>
        /// Close the loop cleanly. Real circuits return to their start; the
        /// integration will not, because the radii are approximations. Spread
        /// the mismatch over the whole lap so no single corner distorts.
        /// </summary>
        private static void CloseTheLoop(List<IntegratedSample> samples)
        {
            var n = samples.Count;
            if (n < 2) return;

            var gap = samples[0].Position - samples[n - 1].Position;
            if (gap.Length <= 0.001) return;

            for (var i = 0; i < n; i++)
            {
                var w = (double)i / (n - 1);
                var sample = samples[i];
                sample.Position = sample.Position + gap * w;
                samples[i] = sample;
            }
        }

        /// <summary>1-2-1 smoothing of the height channel, in place and periodic.</summary>
        private static void SmoothHeights(List<IntegratedSample> samples, int passes)
        {
            var n = samples.Count;
            var scratch = new double[n];

            for (var pass = 0; pass < passes; pass++)
            {
                for (var i = 0; i < n; i++)
                {
                    var prev = samples[Wrap(i - 1, n)].Position.Y;
                    var next = samples[Wrap(i + 1, n)].Position.Y;
                    scratch[i] = 0.25 * prev + 0.5 * samples[i].Position.Y + 0.25 * next;
                }
                for (var i = 0; i < n; i++)
                {
                    var sample = samples[i];
                    var p = sample.Position;
                    sample.Position = new Vec3(p.X, scratch[i], p.Z);
                    samples[i] = sample;
                }
            }
        }

        private static int Wrap(int i, int n) => ((i % n) + n) % n;
    }
}
