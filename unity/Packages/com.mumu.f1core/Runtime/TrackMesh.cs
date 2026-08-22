using System;
using System.Collections.Generic;

namespace MumuF1
{
    /// <summary>A colour, linear, zero to one.</summary>
    public readonly struct Rgb
    {
        public readonly float R;
        public readonly float G;
        public readonly float B;

        public Rgb(float r, float g, float b)
        {
            R = r;
            G = g;
            B = b;
        }
    }

    /// <summary>A lateral station that carries a drawn line, and its weight (m).</summary>
    public readonly struct InkStation
    {
        public readonly int Station;
        public readonly double Width;

        public InkStation(int station, double width)
        {
            Station = station;
            Width = width;
        }
    }

    /// <summary>
    /// The swept road, as plain arrays.
    /// </summary>
    /// <remarks>
    /// Deliberately not a <c>UnityEngine.Mesh</c>. The same output feeds the
    /// collider and the renderer, and building it here rather than in the
    /// engine layer is what lets it be tested without one — which is the
    /// whole reason this lives in the core package. Positions are
    /// <c>float</c> because that is what a vertex buffer is, even though
    /// everything upstream of them is <c>double</c>.
    /// </remarks>
    public sealed class TrackGeometry
    {
        public float[] Positions { get; internal set; }
        public int[] Indices { get; internal set; }
        public float[] Normals { get; internal set; }

        /// <summary>Per-vertex colour, so one draw call shows every surface.</summary>
        public float[] Colors { get; internal set; }

        /// <summary>Surface kind per vertex, for debugging and for the minimap.</summary>
        public SurfaceKind[] Surfaces { get; internal set; }

        public int VertexCount { get; internal set; }
        public int TriangleCount { get; internal set; }

        /* The sweep, as a grid. The triangle soup above is what the collider
           and the renderer consume, but anything that wants to follow a
           single edge all the way round the circuit needs to know the shape
           it was built from. */

        /// <summary>Cross-sections around the lap.</summary>
        public int Rings { get; internal set; }

        /// <summary>Vertices across one cross-section.</summary>
        public int Across { get; internal set; }

        /// <summary>
        /// Lateral stations that are a drawn edge, with the weight of the
        /// line they carry.
        /// </summary>
        /// <remarks>
        /// Which boundaries these are is a fact about the cross-section, so
        /// it belongs here rather than in the renderer: the road edge is at
        /// the station where tarmac becomes kerb, and only this file knows
        /// which one that is.
        /// </remarks>
        public InkStation[] InkStations { get; internal set; }

        /// <summary>Lateral stations a barrier stands on.</summary>
        public int[] BarrierStations { get; internal set; }
    }

    /// <summary>
    /// Sweeps a circuit's centreline into a road.
    /// </summary>
    /// <remarks>
    /// At each station the spline gives a position and a left vector,
    /// banking rotates that vector about the tangent, and vertices are laid
    /// out across it — tarmac, kerb, run-off, then grass.
    /// </remarks>
    public static class TrackMesh
    {
        /// <summary>Paint, and tarmac that has been rubbered in by a season of cars.</summary>
        private static readonly Rgb Paint = new Rgb(0.93f, 0.94f, 0.95f);

        private static readonly Rgb Groove = new Rgb(0.19f, 0.20f, 0.23f);

        /// <summary>The pale half of a kerb. The red half comes from the surface colour.</summary>
        private static readonly Rgb KerbPale = new Rgb(0.93f, 0.93f, 0.94f);

        /// <summary>Metres of kerb per stripe.</summary>
        private const double KerbStripe = 3;

        /*
         * Raised and warmed from the near-photographic values these started
         * as.
         *
         * Flat shading removes the one thing that was carrying these colours:
         * under a lighting model, tarmac at 0.19 is a dark surface that the
         * sun lifts to a readable grey. Under four flat bands it is simply
         * dark, and a black line drawn on it — which is now how the road edge
         * is described — disappears into it. Every surface therefore has to
         * be bright enough to be drawn *on*, which is the same reason an
         * illustrator paints a road light grey and not the colour tarmac
         * actually is.
         */
        public static Rgb SurfaceColor(SurfaceKind kind)
        {
            switch (kind)
            {
                case SurfaceKind.Tarmac: return new Rgb(0.26f, 0.28f, 0.31f);
                case SurfaceKind.Kerb: return new Rgb(0.78f, 0.05f, 0.05f);
                case SurfaceKind.Runoff: return new Rgb(0.40f, 0.40f, 0.42f);
                case SurfaceKind.Gravel: return new Rgb(0.60f, 0.53f, 0.38f);
                case SurfaceKind.Grass: return new Rgb(0.29f, 0.50f, 0.24f);
                default: throw new ArgumentOutOfRangeException(nameof(kind));
            }
        }

        /// <summary>One vertex of the cross-section.</summary>
        private struct Station
        {
            public double T;
            public SurfaceKind Surface;
            public double Drop;

            /// <summary>
            /// Overrides the surface's colour without changing what it grips
            /// like. A white line is paint on tarmac, and the rubbered-in
            /// groove is tarmac that has been driven on — neither is a new
            /// surface as far as the car is concerned.
            /// </summary>
            public Rgb? Tint;

            /// <summary>
            /// Weight of the drawn line along this station (m), if it carries
            /// one.
            /// </summary>
            /// <remarks>
            /// A circuit seen from a car is mostly one flat grey plane, and
            /// what makes it read as a road is its edges. Under photographic
            /// lighting those come free — the kerb catches the sun, the grass
            /// is a different material. Under flat shading they do not, so
            /// the edges have to be drawn, the way they would be in a panel
            /// of a comic.
            /// </remarks>
            public double? Ink;

            /// <summary>
            /// True where a barrier stands.
            /// </summary>
            /// <remarks>
            /// The wall is drawn from this and nothing else, so the
            /// cross-section stays the single place that knows where the edge
            /// of the circuit is. An index written down in the renderer
            /// instead would put a wall down the middle of the road the first
            /// time a station was inserted above it.
            /// </remarks>
            public bool Barrier;
        }

        /// <summary>
        /// Clamp the cross-section so it cannot fold through itself.
        /// </summary>
        /// <remarks>
        /// Sweeping a fixed-width ribbon along a curve is only valid while the
        /// ribbon is narrower than the radius of curvature. At a hairpin the
        /// radius is 24 m while the run-off and grass reach 33 m from the
        /// centreline, so the inner edge wraps past the centre of the corner
        /// and comes back out over the road — a sheet of grass lying on top
        /// of the racing line. A car driving into it is thrown off the
        /// circuit, and a downward raycast finds grass where the tarmac
        /// should be.
        ///
        /// Stations on the inside of the corner are therefore pulled in to a
        /// fraction of the radius, and kept strictly ordered so the quads
        /// degenerate rather than invert.
        /// </remarks>
        private static void ClampToCurvature(Station[] stations, double curvature)
        {
            var kappa = Math.Abs(curvature);
            if (kappa < 1e-6) return;

            var limit = 0.75 / kappa;
            // Positive curvature turns left, and the inside of a left-hander
            // is the +t side.
            var insideIsPositive = curvature > 0;

            for (var i = 0; i < stations.Length; i++)
            {
                var t = stations[i].T;
                var inside = insideIsPositive ? t > 0 : t < 0;
                if (!inside || Math.Abs(t) <= limit) continue;
                stations[i].T = Math.Sign(t) * limit;
            }

            // Keep the sequence strictly increasing so no quad turns inside out.
            for (var i = 1; i < stations.Length; i++)
            {
                if (stations[i].T <= stations[i - 1].T) stations[i].T = stations[i - 1].T + 0.01;
            }
        }

        /// <summary>
        /// Pull the section in to <paramref name="maxExtent"/> either side.
        /// </summary>
        /// <remarks>
        /// Stations are moved rather than dropped, so every cross-section
        /// keeps the same number of vertices and the sweep stays a regular
        /// grid — the strip indices, the ink lines and the surface array all
        /// depend on that. A clamped station lands on top of its neighbour
        /// and the quad between them degenerates to nothing, which draws as
        /// nothing.
        /// </remarks>
        private static void ClampToExtent(Station[] stations, double maxExtent)
        {
            if (double.IsInfinity(maxExtent) || double.IsNaN(maxExtent)) return;

            for (var i = 0; i < stations.Length; i++)
            {
                var t = stations[i].T;
                if (Math.Abs(t) > maxExtent) stations[i].T = Math.Sign(t) * maxExtent;
            }
        }

        /// <summary>
        /// How wide each cross-section may sweep before it reaches into
        /// another part of the circuit.
        /// </summary>
        /// <remarks>
        /// <see cref="ClampToCurvature"/> already stops a section folding
        /// through its own corner. This is the other half of the same
        /// problem, and the one that was actually visible: nothing stopped a
        /// section reaching across at a <em>different</em> part of the lap.
        /// The verges are wide — road, kerb, run-off and a grass apron come to
        /// 33 m either side of the centreline at Monza — so any corner that
        /// doubles the circuit back within 66 m had two sheets of scenery
        /// lying through each other, one a few centimetres above the other.
        ///
        /// The overlap check in the circuit tests never caught it, twice
        /// over. It compares half-width only, so the verges are outside what
        /// it measures at all; and it skips pairs closer than 250 m along the
        /// lap, which is exactly where a hairpin puts them. A 24 m hairpin
        /// leaves its two straights 48 m apart and about 150 m apart around
        /// the lap — invisible to the check, and unmissable on screen.
        ///
        /// The rule is the obvious one: two parts of the circuit that pass
        /// within <c>d</c> of each other may each sweep <c>d / 2</c>, so they
        /// meet and never cross. The road itself is never clamped away — a
        /// circuit that narrowed its own tarmac to fix its scenery would be
        /// fixing the wrong thing.
        /// </remarks>
        private static double[] ProximityLimits(Circuit circuit, int rings)
        {
            var limits = new double[rings];
            var xs = new double[rings];
            var ys = new double[rings];
            var zs = new double[rings];
            var floor = new double[rings];

            for (var i = 0; i < rings; i++)
            {
                limits[i] = double.PositiveInfinity;
                var s = (double)i / rings * circuit.Length;
                var p = circuit.Spline.SampleAt(s).Position;
                xs[i] = p.X;
                ys[i] = p.Y;
                zs[i] = p.Z;
                // Never below the road plus its kerb, whatever the neighbours do.
                floor[i] = circuit.HalfWidthAt(s) + circuit.KerbWidth + 0.5;
            }

            var ringSpacing = circuit.Length / rings;

            for (var i = 0; i < rings; i++)
            {
                for (var j = i + 1; j < rings; j++)
                {
                    /* A bridge is not an overlap. Four metres is a road's
                       worth of clearance: below that two sheets at the same
                       place are a mistake, above it one is over the other on
                       purpose. (Spa was removed over exactly this: its
                       start/finish straight passed within a metre of the
                       descent to Eau Rouge, five metres apart in height. The
                       clamp below cannot fix a layout that crosses itself,
                       and should not try.) */
                    if (Math.Abs(ys[i] - ys[j]) > 4) continue;

                    var plan = MathUtil.Hypot(xs[i] - xs[j], zs[i] - zs[j]);
                    var alongLap = Math.Min(j - i, rings - (j - i)) * ringSpacing;

                    /* Are these two pieces of road, or one?
                     *
                     * Not a fixed separation: it has to hold for the proving
                     * ground, whose road is sixty metres wide, and for a
                     * twenty-four metre hairpin, and no single number does
                     * both. What separates the two cases is how the distance
                     * around compares with the distance across. Along a
                     * straight or a gentle curve you can walk from one ring to
                     * the other in about the distance between them, and they
                     * are the same road. Round a hairpin the walk is half
                     * again as long as the gap, and they are two — which is
                     * exactly when the verges have to stop short of each
                     * other. */
                    if (alongLap < 40 || alongLap < plan * 1.5) continue;

                    var share = plan / 2;
                    if (share < limits[i]) limits[i] = share;
                    if (share < limits[j]) limits[j] = share;
                }
            }

            for (var i = 0; i < rings; i++)
            {
                if (limits[i] < floor[i]) limits[i] = floor[i];
            }
            return limits;
        }

        /// <summary>Lateral stations across the road, as offsets from the centreline.</summary>
        private static Station[] LateralStations(
            Circuit circuit,
            double s,
            double curvature = 0,
            double maxExtent = double.PositiveInfinity)
        {
            var w = circuit.HalfWidthAt(s);
            var k = circuit.KerbWidth;
            var r = circuit.RunoffAt(s);

            /* The painted line just inside the kerb, and the rubbered-in
               groove down the middle, are what make tarmac read as a racing
               circuit rather than a grey road. Both are lateral bands: the
               line is paint, the groove is tarmac darkened where the cars run.

               Paint is only a colour — the physics still sees tarmac under it,
               which is right, because a white line is paint on tarmac. */
            const double line = 0.12;

            /* The grass apron used to reach fourteen metres past the run-off.
               It is there to catch a car that has left the circuit entirely —
               the mesh is the collider, so the edge of it is the edge of the
               world — and not to be looked at, because the ground plane
               already paints grass to the horizon in the same colour. Eight
               metres still catches the car and sweeps a great deal less
               scenery into the next corner. */
            var stations = new[]
            {
                new Station { T = -(w + k + r + 8), Surface = SurfaceKind.Grass, Drop = 0.35 },
                new Station { T = -(w + k + r), Surface = SurfaceKind.Grass, Drop = 0.12 },
                new Station { T = -(w + k + r) + 0.01, Surface = SurfaceKind.Runoff, Drop = 0.1, Ink = 0.34, Barrier = true },
                new Station { T = -(w + k), Surface = SurfaceKind.Runoff, Drop = 0.04 },
                new Station { T = -(w + k) + 0.01, Surface = SurfaceKind.Kerb, Drop = 0.03, Ink = 0.2 },
                new Station { T = -w, Surface = SurfaceKind.Kerb, Drop = 0, Ink = 0.26 },
                new Station { T = -w + 0.01, Surface = SurfaceKind.Tarmac, Drop = 0, Tint = Paint },
                new Station { T = -w + line, Surface = SurfaceKind.Tarmac, Drop = 0, Tint = Paint },
                new Station { T = -w + line + 0.01, Surface = SurfaceKind.Tarmac, Drop = 0 },
                new Station { T = -w * 0.42, Surface = SurfaceKind.Tarmac, Drop = 0 },
                new Station { T = -w * 0.34, Surface = SurfaceKind.Tarmac, Drop = 0, Tint = Groove },
                new Station { T = w * 0.34, Surface = SurfaceKind.Tarmac, Drop = 0, Tint = Groove },
                new Station { T = w * 0.42, Surface = SurfaceKind.Tarmac, Drop = 0 },
                new Station { T = w - line - 0.01, Surface = SurfaceKind.Tarmac, Drop = 0 },
                new Station { T = w - line, Surface = SurfaceKind.Tarmac, Drop = 0, Tint = Paint },
                new Station { T = w - 0.01, Surface = SurfaceKind.Tarmac, Drop = 0, Tint = Paint },
                new Station { T = w, Surface = SurfaceKind.Kerb, Drop = 0, Ink = 0.26 },
                new Station { T = w + k - 0.01, Surface = SurfaceKind.Kerb, Drop = 0.03, Ink = 0.2 },
                new Station { T = w + k, Surface = SurfaceKind.Runoff, Drop = 0.04 },
                new Station { T = w + k + r - 0.01, Surface = SurfaceKind.Runoff, Drop = 0.1, Ink = 0.34, Barrier = true },
                new Station { T = w + k + r, Surface = SurfaceKind.Grass, Drop = 0.12 },
                new Station { T = w + k + r + 8, Surface = SurfaceKind.Grass, Drop = 0.35 }
            };

            ClampToCurvature(stations, curvature);
            ClampToExtent(stations, maxExtent);
            return stations;
        }

        /// <param name="circuit">the circuit to sweep.</param>
        /// <param name="stationSpacing">
        /// distance between cross-sections (m). Four metres keeps a fast
        /// sweep smooth without a million triangles.
        /// </param>
        public static TrackGeometry Build(Circuit circuit, double stationSpacing = 4)
        {
            var rings = Math.Max(8, (int)Math.Round(circuit.Length / stationSpacing, MidpointRounding.AwayFromZero));
            var template = LateralStations(circuit, 0, 0);
            var across = template.Length;

            /* Read off the template rather than hard-coded: the cross-section
               is edited often, and an index written down somewhere else would
               go on drawing a line down the middle of the road the first time
               a station was inserted above it. */
            var inkStations = new List<InkStation>();
            var barrierStations = new List<int>();
            for (var i = 0; i < across; i++)
            {
                if (template[i].Ink.HasValue) inkStations.Add(new InkStation(i, template[i].Ink.Value));
                if (template[i].Barrier) barrierStations.Add(i);
            }

            var positions = new float[rings * across * 3];
            var normals = new float[rings * across * 3];
            var colors = new float[rings * across * 3];
            var surfaces = new SurfaceKind[rings * across];
            var indices = new int[rings * (across - 1) * 6];

            var limits = ProximityLimits(circuit, rings);

            var vi = 0;
            var ii = 0;

            for (var ring = 0; ring < rings; ring++)
            {
                var s = (double)ring / rings * circuit.Length;
                var sample = circuit.Spline.SampleAt(s);
                var banking = circuit.BankingAt(s);
                var stations = LateralStations(circuit, s, sample.Curvature, limits[ring]);

                // Banking rotates the lateral axis about the tangent.
                var left = RotateAboutAxis(sample.Left, sample.Tangent, banking);
                var up = Vec3.Cross(sample.Tangent, left).Normalised();

                foreach (var station in stations)
                {
                    var p = sample.Position + left * station.T + up * -station.Drop;

                    positions[vi * 3] = (float)p.X;
                    positions[vi * 3 + 1] = (float)p.Y;
                    positions[vi * 3 + 2] = (float)p.Z;

                    normals[vi * 3] = (float)up.X;
                    normals[vi * 3 + 1] = (float)up.Y;
                    normals[vi * 3 + 2] = (float)up.Z;

                    /* Kerbs alternate along their length. A kerb painted one
                       flat colour is the single clearest tell that a road is
                       not a race track — the stripes are how the eye reads
                       where the limit is and how fast it is going over it. */
                    var c = station.Tint ?? SurfaceColor(station.Surface);
                    if (station.Surface == SurfaceKind.Kerb && Mod2(Math.Floor(s / KerbStripe)) == 1)
                    {
                        c = KerbPale;
                    }

                    colors[vi * 3] = c.R;
                    colors[vi * 3 + 1] = c.G;
                    colors[vi * 3 + 2] = c.B;

                    surfaces[vi] = station.Surface;
                    vi++;
                }
            }

            // Stitch consecutive rings, wrapping the last back to the first so
            // the lap is closed and a car crossing the line does not fall
            // through.
            for (var ring = 0; ring < rings; ring++)
            {
                var a = ring * across;
                var b = (ring + 1) % rings * across;

                for (var k = 0; k < across - 1; k++)
                {
                    indices[ii++] = a + k;
                    indices[ii++] = b + k;
                    indices[ii++] = a + k + 1;

                    indices[ii++] = a + k + 1;
                    indices[ii++] = b + k;
                    indices[ii++] = b + k + 1;
                }
            }

            return new TrackGeometry
            {
                Positions = positions,
                Indices = indices,
                Normals = normals,
                Colors = colors,
                Surfaces = surfaces,
                VertexCount = vi,
                TriangleCount = ii / 3,
                Rings = rings,
                Across = across,
                InkStations = inkStations.ToArray(),
                BarrierStations = barrierStations.ToArray()
            };
        }

        /// <summary>Rodrigues rotation of <c>v</c> about a unit <c>axis</c>.</summary>
        private static Vec3 RotateAboutAxis(Vec3 v, Vec3 axis, double angle)
        {
            if (angle == 0) return v;

            var c = Math.Cos(angle);
            var s = Math.Sin(angle);
            var cross = Vec3.Cross(axis, v);
            var dot = Vec3.Dot(axis, v);

            return new Vec3(
                v.X * c + cross.X * s + axis.X * dot * (1 - c),
                v.Y * c + cross.Y * s + axis.Y * dot * (1 - c),
                v.Z * c + cross.Z * s + axis.Z * dot * (1 - c));
        }

        /// <summary>
        /// The stripe index, always zero or one.
        /// </summary>
        /// <remarks>
        /// C# keeps the sign of the dividend under <c>%</c> where JavaScript
        /// does too, but <c>s</c> is a distance and never negative here — this
        /// exists so a future caller sweeping backwards from the line does not
        /// silently get an unstriped kerb.
        /// </remarks>
        private static int Mod2(double value) => (int)(((long)value % 2 + 2) % 2);
    }
}
