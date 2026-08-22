using System;
using System.Collections.Generic;

namespace MumuF1
{
    /// <summary>An indexed ribbon of triangles, in one colour.</summary>
    public sealed class Ribbon
    {
        public float[] Positions { get; internal set; }
        public int[] Indices { get; internal set; }
        public int VertexCount { get; internal set; }
    }

    /// <summary>
    /// The wall at the edge of the circuit, and the catch fence over it.
    /// </summary>
    /// <remarks>
    /// This used to be drawn and nothing else, on the argument that a thin
    /// wall in a trimesh is something a car at 250 km/h goes through or
    /// climbs, and that the car would be kept inside by a restoring force
    /// instead. The restoring force was never written. What that left was a
    /// circuit whose verges ended in mid-air: run wide, cross eight metres of
    /// grass, and the world simply stops — the car falls out of the bottom of
    /// it and keeps falling.
    ///
    /// So the wall is solid now, and it is the collider. The three things the
    /// original objection was actually about are each answered:
    ///
    /// <list type="bullet">
    /// <item>Going through it is a tunnelling problem, and the car's
    /// rigidbody is already <c>ContinuousDynamic</c> — it sweeps its shape
    /// against static geometry rather than sampling it, so a 0.7 m step at
    /// 300 km/h cannot step over a wall.</item>
    /// <item>Climbing it, and spinning off it, are friction. A real barrier
    /// hit at an angle scrubs the car along itself; a high-friction one grabs
    /// a wheel and pivots the car into the scenery. The engine layer gives
    /// this mesh a frictionless surface for exactly that reason.</item>
    /// <item>Stopping dead is what a zero-thickness plane does, because there
    /// is nothing for a solver to resolve a deep overlap along. This sweeps a
    /// closed box — inner face, outer face, and a lid — so a contact always
    /// has a volume behind it.</item>
    /// </list>
    ///
    /// It is swept from the vertices the road was swept from, so the wall
    /// follows every corner exactly rather than being fitted alongside it,
    /// and the cross-section stays the only thing that knows where the edge
    /// of the road is: it marks the stations a barrier stands on the same way
    /// it marks the ones that carry an ink line.
    /// </remarks>
    public static class Barriers
    {
        /// <summary>Height of the wall (m).</summary>
        public const double Height = 1.05;

        /// <summary>Depth of the coloured cap along the top (m).</summary>
        public const double Cap = 0.2;

        /// <summary>Set into the verge slightly, so its foot is never left hanging.</summary>
        public const double Foot = -0.12;

        /// <summary>
        /// How thick the wall is, outward from the line it stands on (m).
        /// </summary>
        /// <remarks>
        /// Nothing can see the far side of it, so this is not for looks. It
        /// is what turns two triangles into a solid: a contact against a
        /// plane has no volume behind it to push out of, and a car that has
        /// half sunk into one can be resolved to either side.
        /// </remarks>
        public const double Thickness = 0.32;

        /// <summary>Height of the catch fence above the wall (m).</summary>
        public const double FenceHeight = 2.4;

        /// <summary>Rings between fence posts.</summary>
        /// <remarks>
        /// In rings rather than metres because that is the unit this file
        /// has. At the four-metre station spacing the circuit is swept at,
        /// three rings is a post every twelve metres, which is about what a
        /// real one is.
        /// </remarks>
        public const int PostEvery = 3;

        /// <summary>Width of a fence post (m).</summary>
        public const double PostWidth = 0.1;

        /// <summary>Depth of a fence rail (m).</summary>
        public const double RailDepth = 0.07;

        /// <summary>Heights of the rails, as a fraction of the fence.</summary>
        private static readonly double[] Rails = { 0.42, 0.97 };

        /// <summary>
        /// Three ribbons: the white wall, the coloured cap on it, and the
        /// catch fence above.
        /// </summary>
        /// <remarks>
        /// Split so each can be a different colour without a texture or a
        /// second material on one mesh. The cap earns its place — a plain
        /// white wall at a distance reads as a gap in the scenery rather than
        /// as a barrier — and the fence earns its own, because the posts
        /// running away into a corner are most of what tells you at a glance
        /// that this is a circuit and not a road.
        ///
        /// The wall and its cap stack into one closed box. The fence stands
        /// on top and is drawn only: it is thin uprights and two rails, which
        /// is the wrong shape to collide with, and the wall underneath is
        /// what the car actually meets.
        /// </remarks>
        public static void Build(TrackGeometry track, out Ribbon face, out Ribbon cap, out Ribbon fence)
        {
            var faceBuilder = new Builder();
            var capBuilder = new Builder();
            var fenceBuilder = new Builder();

            if (track.BarrierStations.Length != 0 && track.Rings > 1)
            {
                foreach (var station in track.BarrierStations)
                {
                    for (var ring = 0; ring < track.Rings; ring++)
                    {
                        var next = (ring + 1) % track.Rings;

                        Frame(track, ring, station, out var a, out var aUp, out var aOut, out var along);
                        Frame(track, next, station, out var b, out var bUp, out var bOut, out _);

                        /* Six corners a side: the foot, the top of the white,
                           and the top of the cap, on the road side and on the
                           far side. */
                        var aLow = a + aUp * Foot;
                        var aMid = a + aUp * (Height - Cap);
                        var aTop = a + aUp * Height;
                        var aLowOut = aLow + aOut * Thickness;
                        var aMidOut = aMid + aOut * Thickness;
                        var aTopOut = aTop + aOut * Thickness;

                        var bLow = b + bUp * Foot;
                        var bMid = b + bUp * (Height - Cap);
                        var bTop = b + bUp * Height;
                        var bLowOut = bLow + bOut * Thickness;
                        var bMidOut = bMid + bOut * Thickness;
                        var bTopOut = bTop + bOut * Thickness;

                        /* Which way round the triangles go depends on which
                           side of the road this wall is, and it used to
                           not: one fixed winding drew the left-hand wall
                           facing the circuit and the right-hand one facing
                           away from it, and the base pass culls back faces.
                           So half the barrier on every circuit has been
                           invisible from the driver's seat since it was
                           written — you could see the wall down one side of
                           a straight and straight through the wall down the
                           other, and the two look alike enough at speed that
                           it read as scenery rather than as a fault. It is
                           the same handedness question the frame below
                           answers, so it is answered from the same place. */
                        var flip = Vec3.Dot(Vec3.Cross(aUp, along), aOut) < 0;

                        Quad(faceBuilder, flip, aLow, aMid, bLow, bMid);           // road side
                        Quad(faceBuilder, flip, aMidOut, aLowOut, bMidOut, bLowOut); // far side
                        Quad(faceBuilder, flip, aLowOut, aLow, bLowOut, bLow);     // underneath

                        Quad(capBuilder, flip, aMid, aTop, bMid, bTop);           // road side
                        Quad(capBuilder, flip, aTopOut, aMidOut, bTopOut, bMidOut); // far side
                        Quad(capBuilder, flip, aTop, aTopOut, bTop, bTopOut);     // the lid

                        /* The fence is centred over the wall rather than
                           hung off its road-facing surface, so it is not
                           the first thing a car touches. */
                        var aFoot = aTop + aOut * (Thickness * 0.5);
                        var bFoot = bTop + bOut * (Thickness * 0.5);

                        foreach (var rail in Rails)
                        {
                            var low = FenceHeight * rail;
                            Quad(fenceBuilder, flip,
                                aFoot + aUp * low, aFoot + aUp * (low + RailDepth),
                                bFoot + bUp * low, bFoot + bUp * (low + RailDepth));
                        }

                        if (ring % PostEvery != 0) continue;

                        var half = along * (PostWidth * 0.5);
                        Quad(fenceBuilder, flip,
                            aFoot - half, aFoot - half + aUp * FenceHeight,
                            aFoot + half, aFoot + half + aUp * FenceHeight);
                    }
                }
            }

            face = faceBuilder.Finish();
            cap = capBuilder.Finish();
            fence = fenceBuilder.Finish();
        }

        /// <summary>
        /// One quad, wound to face the circuit.
        /// </summary>
        /// <remarks>
        /// <c>Builder.Quad(p0, p1, q0, q1)</c> makes triangles whose normal
        /// runs along <c>(q0 - p0) x (p1 - p0)</c>. Swapping the two pairs
        /// reverses that, which is all "the other side of the road" means
        /// here.
        /// </remarks>
        private static void Quad(Builder into, bool flip, Vec3 p0, Vec3 p1, Vec3 q0, Vec3 q1)
        {
            if (flip) into.Quad(q0, q1, p0, p1);
            else into.Quad(p0, p1, q0, q1);
        }

        /// <summary>
        /// Where a barrier vertex is, and which way is up, out and onward.
        /// </summary>
        /// <remarks>
        /// The sweep stores a position and a normal per vertex and nothing
        /// else, so the other two axes are recovered here. The tangent comes
        /// from the neighbouring rings; the lateral axis is the normal
        /// crossed into it, which gives the +t side of the road because that
        /// is the handedness the sweep laid its stations out in; and which
        /// way is *out* is settled by asking whether this station is on the
        /// +t or the -t side of a station well inboard of both.
        ///
        /// Asked rather than assumed, because at a hairpin the cross-section
        /// is clamped and stations pile up on each other — an index written
        /// down as "the left-hand barrier" would put the far side of the wall
        /// through the road the first time the template was reordered.
        /// </remarks>
        private static void Frame(
            TrackGeometry track, int ring, int station,
            out Vec3 at, out Vec3 up, out Vec3 outward, out Vec3 along)
        {
            at = Vertex(track, ring, station);
            var i = (ring * track.Across + station) * 3;
            up = new Vec3(track.Normals[i], track.Normals[i + 1], track.Normals[i + 2]);

            var ahead = Vertex(track, (ring + 1) % track.Rings, station);
            var behind = Vertex(track, (ring + track.Rings - 1) % track.Rings, station);
            var step = ahead - behind;
            along = step.LengthSquared < 1e-12 ? new Vec3(0, 0, 1) : step.Normalised();

            var lateral = Vec3.Cross(up, along);
            lateral = lateral.LengthSquared < 1e-12 ? new Vec3(1, 0, 0) : lateral.Normalised();

            var inboard = Vertex(track, ring, track.Across / 2);
            var side = Vec3.Dot(at - inboard, lateral);
            if (Math.Abs(side) < 1e-9) side = station * 2 >= track.Across - 1 ? 1 : -1;

            outward = side >= 0 ? lateral : lateral * -1;
        }

        private static Vec3 Vertex(TrackGeometry track, int ring, int station)
        {
            var i = (ring * track.Across + station) * 3;
            return new Vec3(track.Positions[i], track.Positions[i + 1], track.Positions[i + 2]);
        }

        private sealed class Builder
        {
            private readonly List<float> _positions = new List<float>();
            private readonly List<int> _indices = new List<int>();

            private int Push(Vec3 p)
            {
                var index = _positions.Count / 3;
                _positions.Add((float)p.X);
                _positions.Add((float)p.Y);
                _positions.Add((float)p.Z);
                return index;
            }

            public void Quad(Vec3 p0, Vec3 p1, Vec3 q0, Vec3 q1)
            {
                var i0 = Push(p0);
                var i1 = Push(p1);
                var i2 = Push(q0);
                var i3 = Push(q1);
                _indices.Add(i0); _indices.Add(i2); _indices.Add(i1);
                _indices.Add(i1); _indices.Add(i2); _indices.Add(i3);
            }

            public Ribbon Finish() => new Ribbon
            {
                Positions = _positions.ToArray(),
                Indices = _indices.ToArray(),
                VertexCount = _positions.Count / 3
            };
        }
    }
}
