using System;
using System.Collections.Generic;

namespace MumuF1
{
    /// <summary>A flat-shaded, vertex-coloured mesh.</summary>
    /// <remarks>
    /// Flat-shaded means every triangle carries its own three vertices and
    /// the face's own normal. That triples the vertex count of a cone and it
    /// is the right trade: this game shades in four hard bands, and a shared
    /// vertex averages the normals of the faces meeting at it, which rounds
    /// off exactly the facets the style is made of. A smooth-normalled ball
    /// under four bands reads as a flat disc with two rings on it.
    ///
    /// Colour is per-vertex rather than per-material, so a whole roadside —
    /// trunks, canopies, hoardings, flags — is one draw call and no textures.
    /// The circuit is painted the same way and for the same reason.
    /// </remarks>
    public sealed class Mesh3
    {
        public float[] Positions { get; internal set; }
        public float[] Normals { get; internal set; }
        public float[] Colors { get; internal set; }
        public int[] Indices { get; internal set; }
        public int VertexCount { get; internal set; }
        public int TriangleCount { get; internal set; }
    }

    /// <summary>
    /// What each roadside prop is made of.
    /// </summary>
    /// <remarks>
    /// Generated rather than modelled, like everything else here — and the
    /// argument is the same one the shader made: what has to survive is the
    /// silhouette. Nothing beside the road is looked at for longer than a
    /// fifth of a second at the edge of vision, so a seven-sided cone on a
    /// five-sided trunk is a conifer, and detail beyond that is detail
    /// nobody sees at two hundred kilometres an hour.
    ///
    /// It lives in the engine-free package so the shapes can be checked
    /// without an editor. The check that matters is orientation: a mesh
    /// wound the wrong way round is invisible from outside and solid from
    /// inside, which is a bug you cannot see coming in code and cannot miss
    /// on screen.
    /// </remarks>
    public static class PropMesh
    {
        private static readonly Rgb Bark = new Rgb(0.42f, 0.29f, 0.18f);
        private static readonly Rgb Needle = new Rgb(0.18f, 0.42f, 0.23f);
        private static readonly Rgb Leaf = new Rgb(0.31f, 0.58f, 0.25f);
        private static readonly Rgb Steel = new Rgb(0.85f, 0.87f, 0.89f);
        private static readonly Rgb Concrete = new Rgb(0.74f, 0.77f, 0.80f);
        private static readonly Rgb Shadow = new Rgb(0.18f, 0.20f, 0.22f);
        private static readonly Rgb Board = new Rgb(0.13f, 0.35f, 0.68f);
        private static readonly Rgb Cloth = new Rgb(0.94f, 0.78f, 0.15f);
        private static readonly Rgb Warning = new Rgb(0.85f, 0.14f, 0.16f);

        /// <summary>
        /// One prop, standing on the origin with its foot at y = 0 and its
        /// front along +Z.
        /// </summary>
        /// <remarks>
        /// Foot at zero because everything is placed on the ground: a shape
        /// centred on its own middle sinks half of itself into the verge.
        /// Front along +Z because boards, flags and posts are turned to look
        /// back across the road by a yaw about +Y, and a yaw has to have
        /// something to turn.
        /// </remarks>
        public static Mesh3 Build(PropKind kind)
        {
            var b = new Builder();

            switch (kind)
            {
                case PropKind.Conifer:
                    b.Tube(Vec3.Zero, 0.30, 0.22, 2.2, 5, Bark);
                    /* Three tiers, narrowing upward. One cone is a traffic
                       marker; three are a conifer, and that is the whole
                       difference at the distance it is seen from. */
                    b.Cone(new Vec3(0, 1.9, 0), 2.9, 3.4, 7, Needle);
                    b.Cone(new Vec3(0, 3.6, 0), 2.2, 3.2, 7, Needle);
                    b.Cone(new Vec3(0, 5.2, 0), 1.4, 2.8, 7, Needle);
                    break;

                case PropKind.Broadleaf:
                    b.Tube(Vec3.Zero, 0.34, 0.26, 2.6, 5, Bark);
                    /* Two balls of different sizes, offset. A single one
                       reads as a lollipop; two read as foliage. */
                    b.Ball(new Vec3(0, 4.4, 0), 2.5, 7, 4, Leaf);
                    b.Ball(new Vec3(1.1, 3.5, 0.5), 1.7, 6, 3, Leaf);
                    break;

                case PropKind.MarshalPost:
                    b.Tube(Vec3.Zero, 0.09, 0.09, 2.6, 5, Shadow);
                    b.Box(new Vec3(0, 3.0, 0), new Vec3(1.5, 1.0, 0.10), Steel);
                    break;

                case PropKind.Grandstand:
                    // The rake, as five steps, then a roof on two columns.
                    for (var i = 0; i < 5; i++)
                    {
                        var h = 1.4 + i * 0.2;
                        b.Box(new Vec3(0, h * 0.5, -i * 2.2), new Vec3(26, h, 2.2), Concrete);
                    }
                    b.Box(new Vec3(0, 9.4, -4.4), new Vec3(27, 0.5, 12), Steel);
                    b.Box(new Vec3(-12, 4.7, 1.2), new Vec3(0.7, 9, 0.7), Steel);
                    b.Box(new Vec3(12, 4.7, 1.2), new Vec3(0.7, 9, 0.7), Steel);
                    break;

                case PropKind.AdBoard:
                    b.Box(new Vec3(0, 1.05, 0), new Vec3(7.0, 1.4, 0.14), Board);
                    b.Box(new Vec3(-3.2, 0.35, 0.10), new Vec3(0.16, 0.7, 0.16), Shadow);
                    b.Box(new Vec3(3.2, 0.35, 0.10), new Vec3(0.16, 0.7, 0.16), Shadow);
                    break;

                case PropKind.Flag:
                    b.Tube(Vec3.Zero, 0.07, 0.06, 5.2, 5, Steel);
                    /* Thin rather than flat. A cloth with no thickness is one
                       quad, and one quad seen from behind is nothing at all —
                       so the flag would vanish for half of every lap. */
                    b.Box(new Vec3(0.95, 4.5, 0), new Vec3(1.8, 1.1, 0.05), Cloth);
                    break;

                case PropKind.StartGantry:
                    /* Legs outside the road, so the thing spanning the timing
                       line never has anything standing on it. Twelve metres
                       is the widest half-width any circuit here uses, plus
                       its kerb. */
                    b.Box(new Vec3(-12.4, 3.4, 0), new Vec3(0.8, 6.8, 0.8), Shadow);
                    b.Box(new Vec3(12.4, 3.4, 0), new Vec3(0.8, 6.8, 0.8), Shadow);
                    b.Box(new Vec3(0, 7.2, 0), new Vec3(25.6, 1.2, 1.0), Warning);
                    b.Box(new Vec3(0, 6.2, 0), new Vec3(6.0, 0.9, 1.1), Shadow);
                    break;

                default:
                    throw new ArgumentOutOfRangeException(nameof(kind));
            }

            return b.Finish();
        }

        /// <summary>Every kind, built once.</summary>
        public static Dictionary<PropKind, Mesh3> All()
        {
            var meshes = new Dictionary<PropKind, Mesh3>();
            foreach (PropKind kind in Enum.GetValues(typeof(PropKind)))
            {
                meshes[kind] = Build(kind);
            }
            return meshes;
        }

        private sealed class Builder
        {
            private readonly List<float> _positions = new List<float>();
            private readonly List<float> _normals = new List<float>();
            private readonly List<float> _colors = new List<float>();
            private readonly List<int> _indices = new List<int>();

            /// <summary>
            /// One triangle, with its own three vertices and its own normal.
            /// </summary>
            /// <remarks>
            /// The normal is <c>cross(b - a, c - a)</c>, which is the front
            /// face in Unity as well as in the reference renderer — Unity's
            /// own quad primitive winds this way, and so does the road sweep,
            /// whose normal comes out as the road's up vector by exactly this
            /// rule. Everything here is therefore wound anticlockwise seen
            /// from outside, and a closed prop wound the other way would have
            /// negative volume, which is what the tests measure.
            /// </remarks>
            public void Tri(Vec3 a, Vec3 b, Vec3 c, Rgb colour)
            {
                var n = Vec3.Cross(b - a, c - a);
                var len = n.Length;
                if (len < 1e-12) return;   // degenerate, and nothing to draw
                n = n * (1.0 / len);

                foreach (var p in new[] { a, b, c })
                {
                    _indices.Add(_positions.Count / 3);
                    _positions.Add((float)p.X);
                    _positions.Add((float)p.Y);
                    _positions.Add((float)p.Z);
                    _normals.Add((float)n.X);
                    _normals.Add((float)n.Y);
                    _normals.Add((float)n.Z);
                    _colors.Add(colour.R);
                    _colors.Add(colour.G);
                    _colors.Add(colour.B);
                }
            }

            public void Quad(Vec3 a, Vec3 b, Vec3 c, Vec3 d, Rgb colour)
            {
                Tri(a, b, c, colour);
                Tri(a, c, d, colour);
            }

            /// <summary>An axis-aligned box, centred on <paramref name="at"/>.</summary>
            public void Box(Vec3 at, Vec3 size, Rgb colour)
            {
                double x = size.X * 0.5, y = size.Y * 0.5, z = size.Z * 0.5;

                Vec3 P(double sx, double sy, double sz) =>
                    new Vec3(at.X + sx * x, at.Y + sy * y, at.Z + sz * z);

                // Each face anticlockwise seen from outside.
                Quad(P(-1, -1, 1), P(1, -1, 1), P(1, 1, 1), P(-1, 1, 1), colour);      // +Z
                Quad(P(1, -1, -1), P(-1, -1, -1), P(-1, 1, -1), P(1, 1, -1), colour);  // -Z
                Quad(P(1, -1, 1), P(1, -1, -1), P(1, 1, -1), P(1, 1, 1), colour);      // +X
                Quad(P(-1, -1, -1), P(-1, -1, 1), P(-1, 1, 1), P(-1, 1, -1), colour);  // -X
                Quad(P(-1, 1, 1), P(1, 1, 1), P(1, 1, -1), P(-1, 1, -1), colour);      // +Y
                Quad(P(-1, -1, -1), P(1, -1, -1), P(1, -1, 1), P(-1, -1, 1), colour);  // -Y
            }

            /// <summary>A closed cone, its base on <paramref name="at"/>.</summary>
            public void Cone(Vec3 at, double radius, double height, int sides, Rgb colour)
            {
                var apex = new Vec3(at.X, at.Y + height, at.Z);
                var centre = at;

                for (var i = 0; i < sides; i++)
                {
                    var p = Ring(at, radius, i, sides);
                    var q = Ring(at, radius, i + 1, sides);
                    Tri(apex, q, p, colour);     // side
                    Tri(centre, p, q, colour);   // base, facing down
                }
            }

            /// <summary>A closed cylinder or frustum, its base on <paramref name="at"/>.</summary>
            public void Tube(Vec3 at, double bottom, double top, double height, int sides, Rgb colour)
            {
                var lid = new Vec3(at.X, at.Y + height, at.Z);

                for (var i = 0; i < sides; i++)
                {
                    var b0 = Ring(at, bottom, i, sides);
                    var b1 = Ring(at, bottom, i + 1, sides);
                    var t0 = Ring(lid, top, i, sides);
                    var t1 = Ring(lid, top, i + 1, sides);

                    Quad(b0, t0, t1, b1, colour);
                    Tri(lid, t1, t0, colour);
                    Tri(at, b0, b1, colour);
                }
            }

            /// <summary>A faceted ball — a low-poly sphere, flat-shaded.</summary>
            public void Ball(Vec3 at, double radius, int sides, int rings, Rgb colour)
            {
                Vec3 P(int i, int j)
                {
                    var phi = Math.PI * j / rings;          // 0 at the top
                    var theta = 2 * Math.PI * i / sides;
                    return new Vec3(
                        at.X + radius * Math.Sin(phi) * Math.Cos(theta),
                        at.Y + radius * Math.Cos(phi),
                        at.Z + radius * Math.Sin(phi) * Math.Sin(theta));
                }

                for (var j = 0; j < rings; j++)
                {
                    for (var i = 0; i < sides; i++)
                    {
                        var a = P(i, j);
                        var b = P(i + 1, j);
                        var c = P(i + 1, j + 1);
                        var d = P(i, j + 1);

                        if (j == 0) Tri(a, c, d, colour);            // cap at the top
                        else if (j == rings - 1) Tri(a, b, c, colour); // cap at the bottom
                        else Quad(a, b, c, d, colour);
                    }
                }
            }

            private static Vec3 Ring(Vec3 centre, double radius, int i, int sides)
            {
                var theta = 2 * Math.PI * i / sides;
                return new Vec3(
                    centre.X + radius * Math.Cos(theta),
                    centre.Y,
                    centre.Z + radius * Math.Sin(theta));
            }

            public Mesh3 Finish() => new Mesh3
            {
                Positions = _positions.ToArray(),
                Normals = _normals.ToArray(),
                Colors = _colors.ToArray(),
                Indices = _indices.ToArray(),
                VertexCount = _positions.Count / 3,
                TriangleCount = _indices.Count / 3
            };
        }
    }
}
