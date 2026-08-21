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
    /// The wall at the edge of the circuit.
    /// </summary>
    /// <remarks>
    /// Drawn only. It is deliberately not part of the collider, and that is
    /// the whole design: a thin wall in a trimesh is something a car at
    /// 250 km/h goes through or climbs, and a car that hits one squarely
    /// stops dead or flips. Neither is what a ten-year-old should get for
    /// running wide — the car is kept inside by a restoring force instead,
    /// and this is what that force looks like.
    ///
    /// So the two have to agree about where the edge is, and they do: both
    /// read it from the same place. The cross-section marks the stations a
    /// barrier stands on, the same way it marks the ones that carry an ink
    /// line, so it stays the only thing that knows the shape of the road.
    ///
    /// Swept from the vertices the road was swept from, so the wall follows
    /// every corner exactly rather than being fitted alongside it.
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
        /// Two ribbons: the white face and the cap along its top.
        /// </summary>
        /// <remarks>
        /// Splitting them is what lets the cap be a different colour without
        /// a texture or a second material on one mesh — and the cap is worth
        /// having, because a plain white wall at a distance reads as a gap in
        /// the scenery rather than as a barrier.
        /// </remarks>
        public static void Build(TrackGeometry track, out Ribbon face, out Ribbon cap)
        {
            var faceBuilder = new Builder();
            var capBuilder = new Builder();

            if (track.BarrierStations.Length != 0)
            {
                foreach (var station in track.BarrierStations)
                {
                    for (var ring = 0; ring < track.Rings; ring++)
                    {
                        var next = (ring + 1) % track.Rings;

                        /* Six corners, this ring and the next. The wall is a
                           single plane rather than a box: seen from the
                           circuit only one side of it is ever visible, and a
                           box would double the triangles for a face nobody
                           can reach. */
                        Corners(track, ring, station, out var aLow, out var aMid, out var aTop);
                        Corners(track, next, station, out var bLow, out var bMid, out var bTop);

                        faceBuilder.Quad(aLow, aMid, bLow, bMid);
                        capBuilder.Quad(aMid, aTop, bMid, bTop);
                    }
                }
            }

            face = faceBuilder.Finish();
            cap = capBuilder.Finish();
        }

        private static void Corners(
            TrackGeometry track, int ring, int station,
            out Vec3 low, out Vec3 mid, out Vec3 top)
        {
            var i = (ring * track.Across + station) * 3;
            var at = new Vec3(track.Positions[i], track.Positions[i + 1], track.Positions[i + 2]);
            var up = new Vec3(track.Normals[i], track.Normals[i + 1], track.Normals[i + 2]);

            low = at + up * Foot;
            mid = at + up * (Height - Cap);
            top = at + up * Height;
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
