using System;
using System.Collections.Generic;

namespace MumuF1
{
    /// <summary>
    /// Builds a flat-shaded, vertex-coloured mesh out of primitives.
    /// </summary>
    /// <remarks>
    /// Lived inside <see cref="PropMesh"/> until the car needed it too. The
    /// roadside and the car are made the same way and for the same reasons —
    /// flat faces, colour per vertex, no textures, one draw call — so the
    /// shapes belong to whoever is building, not to the props.
    ///
    /// Everything it writes is wound anticlockwise seen from outside, and
    /// every face carries its own three vertices so that no normal is ever
    /// averaged across a facet. <see cref="Tri"/> has the argument.
    /// </remarks>
    public sealed class MeshBuilder
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
