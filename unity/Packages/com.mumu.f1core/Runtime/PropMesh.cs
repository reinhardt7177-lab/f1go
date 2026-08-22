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
            var b = new MeshBuilder();

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
    }
}
