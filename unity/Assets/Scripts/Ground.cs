using System;
using UnityEngine;

namespace MumuF1.Game
{
    /// <summary>
    /// The land the circuit is built on.
    /// </summary>
    /// <remarks>
    /// There was none, and a comment in <see cref="MumuF1.TrackMesh"/> said
    /// there was — it justified narrowing the grass apron on the grounds that
    /// "the ground plane already paints grass to the horizon in the same
    /// colour". That was true of the TypeScript version this was ported from
    /// and was never true here, and nothing noticed, because the thing it
    /// left behind does not look like a missing object. It looks like sky:
    /// past the apron the road mesh simply stops, and what shows through the
    /// gap is the inside of the sky dome, which is blue and perfectly smooth
    /// and reads as distance rather than as a hole. The trees standing on the
    /// far side of it appear to float.
    ///
    /// It is also the floor. The road mesh is the collider, so the edge of
    /// the mesh was the edge of the world: a car that got past the verge fell
    /// out of the bottom of the level and kept falling, at a metre every
    /// twentieth of a second, for ever. The barrier stops that from
    /// happening; this is what happens if the barrier is ever wrong.
    ///
    /// Not flat. A plane at the lowest point of the Red Bull Ring puts sixty
    /// metres of air under the top of the circuit and a green sea around it,
    /// so the height is an inverse-distance blend of the road's own rings,
    /// capped by the lowest road within a hundred and fifty metres and then
    /// dropped a metre and a half. See <see cref="HeightAt"/> for why the
    /// blend needs the cap: it is the difference between land that is
    /// usually under the circuit and land that is always under it.
    /// </remarks>
    public static class Ground
    {
        /// <summary>How far past the circuit the land reaches (m).</summary>
        /// <remarks>
        /// Fog is opaque by 2,600 m, so anything past that is paying for
        /// itself in nothing. It has to reach *at least* that far, though:
        /// the horizon is where the fog is, and land that stops short of it
        /// leaves the same blue gap this file exists to close.
        /// </remarks>
        private const float Reach = 2800f;

        /// <summary>Cells across the sheet, each way.</summary>
        private const int Cells = 40;

        /// <summary>How far under the circuit it sits (m).</summary>
        private const float Drop = 1.5f;

        /// <summary>
        /// How far around a point counts as "beside the circuit here" (m).
        /// </summary>
        /// <remarks>
        /// See <see cref="HeightAt"/>. The blend alone is not enough to keep
        /// the land under the road, and this is what makes it so.
        /// </remarks>
        private const float Nearby = 150f;

        /// <summary>Rings sampled for the height field.</summary>
        private const int RingStride = 8;

        /// <summary>
        /// Fields, so the distance is not one flat colour.
        /// </summary>
        /// <remarks>
        /// Close enough in value that the eye reads them as one landscape
        /// under changing light rather than as a chequerboard, and far enough
        /// apart that there is something out there at all. All three are
        /// duller than the grass beside the road, which keeps the verge the
        /// brightest green in the frame and therefore the one that reads as
        /// part of the circuit.
        /// </remarks>
        private static readonly Color[] Fields =
        {
            new Color(0.25f, 0.42f, 0.20f),
            new Color(0.29f, 0.46f, 0.22f),
            new Color(0.33f, 0.44f, 0.24f),
            new Color(0.27f, 0.39f, 0.21f)
        };

        public static Transform Build(Transform parent, TrackGeometry road)
        {
            var go = new GameObject("Ground");
            go.transform.SetParent(parent, false);

            Bounds box = Extent(road);
            Sample[] samples = Rings(road);

            float x0 = box.min.x - Reach;
            float z0 = box.min.z - Reach;
            float x1 = box.max.x + Reach;
            float z1 = box.max.z + Reach;

            /* Four vertices a cell rather than a shared grid, so each
               field is one flat colour. A shared grid would interpolate its
               corners across the quad and give a two-hundred-metre gradient,
               which is the one thing everything else here is shaded to
               avoid. Sixty-four hundred vertices is nothing. */
            var vertices = new Vector3[Cells * Cells * 4];
            var colours = new Color[vertices.Length];
            var triangles = new int[Cells * Cells * 6];

            int v = 0;
            int t = 0;

            for (int j = 0; j < Cells; j++)
            {
                float za = Mathf.Lerp(z0, z1, j / (float)Cells);
                float zb = Mathf.Lerp(z0, z1, (j + 1) / (float)Cells);

                for (int i = 0; i < Cells; i++)
                {
                    float xa = Mathf.Lerp(x0, x1, i / (float)Cells);
                    float xb = Mathf.Lerp(x0, x1, (i + 1) / (float)Cells);

                    vertices[v] = new Vector3(xa, HeightAt(samples, xa, za) - Drop, za);
                    vertices[v + 1] = new Vector3(xa, HeightAt(samples, xa, zb) - Drop, zb);
                    vertices[v + 2] = new Vector3(xb, HeightAt(samples, xb, za) - Drop, za);
                    vertices[v + 3] = new Vector3(xb, HeightAt(samples, xb, zb) - Drop, zb);

                    Color field = Fields[Field(i, j)];
                    colours[v] = field;
                    colours[v + 1] = field;
                    colours[v + 2] = field;
                    colours[v + 3] = field;

                    /* Wound so the sheet faces up: seen from above, the
                       corner, the one along +z and the one along +x go
                       clockwise. */
                    triangles[t++] = v;
                    triangles[t++] = v + 1;
                    triangles[t++] = v + 2;

                    triangles[t++] = v + 2;
                    triangles[t++] = v + 1;
                    triangles[t++] = v + 3;

                    v += 4;
                }
            }

            var mesh = new Mesh
            {
                name = "Ground",
                indexFormat = UnityEngine.Rendering.IndexFormat.UInt32
            };
            mesh.SetVertices(vertices);
            mesh.SetTriangles(triangles, 0);
            mesh.SetColors(colours);
            mesh.RecalculateNormals();
            mesh.RecalculateBounds();

            go.AddComponent<MeshFilter>().sharedMesh = mesh;

            MeshRenderer renderer = go.AddComponent<MeshRenderer>();
            renderer.sharedMaterial = Paint.FromVertices(outline: 0f);
            /* Neither casts nor receives. A sheet six kilometres across is
               most of the directional light's shadow cascade, and what it
               buys is a shadow of the horizon on itself. */
            renderer.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            renderer.receiveShadows = false;

            /* The floor, and the reason nothing can fall for ever. */
            go.AddComponent<MeshCollider>().sharedMesh = mesh;

            return go.transform;
        }

        /// <summary>A ring's centre, as the height field sees it.</summary>
        private struct Sample
        {
            public float X;
            public float Y;
            public float Z;
        }

        /// <summary>
        /// The road's rings, thinned.
        /// </summary>
        /// <remarks>
        /// Centres rather than the whole sweep: the height field is sampled
        /// every couple of hundred metres, so the width of the road is
        /// detail it could not represent even if it had it. Every eighth
        /// ring is a sample about thirty metres apart, which is far finer
        /// than the grid.
        /// </remarks>
        private static Sample[] Rings(TrackGeometry road)
        {
            int count = Mathf.Max(1, road.Rings / RingStride);
            var samples = new Sample[count];
            int middle = road.Across / 2;

            for (int n = 0; n < count; n++)
            {
                int v = (n * RingStride % road.Rings) * road.Across + middle;
                samples[n] = new Sample
                {
                    X = road.Positions[v * 3],
                    Y = road.Positions[v * 3 + 1],
                    Z = road.Positions[v * 3 + 2]
                };
            }

            return samples;
        }

        /// <summary>
        /// The land's height, as an inverse-square-distance mean of the
        /// circuit's own — never above the road beside it.
        /// </summary>
        /// <remarks>
        /// The blend on its own gives a smooth landscape that follows the
        /// elevation near the circuit and settles to the mean far from it,
        /// and it is not sufficient. A weighted mean lies between the
        /// smallest and the largest of the heights it is drawn from, which
        /// keeps the land under the <em>highest</em> part of the circuit and
        /// says nothing about the lowest: at the bottom of a dip every
        /// neighbouring ring is higher than the road is, so the mean is too,
        /// and the land surfaces through the tarmac in the one place a car
        /// is going quickest.
        ///
        /// So the blend is capped by the lowest road within a hundred and
        /// fifty metres. That is a floor the road itself is on, by
        /// construction, and it is what makes the drop below a guarantee
        /// rather than a hope.
        /// </remarks>
        private static float HeightAt(Sample[] samples, float x, float z)
        {
            double weighted = 0;
            double total = 0;
            double lowest = double.PositiveInfinity;
            double nearestY = 0;
            double nearest = double.PositiveInfinity;

            for (int n = 0; n < samples.Length; n++)
            {
                float dx = samples[n].X - x;
                float dz = samples[n].Z - z;
                double d2 = dx * dx + dz * dz;

                /* Softened by a hundred metres, so a grid vertex that lands
                   on top of a ring is not the only sample that counts —
                   without it the sheet spikes to that one ring's height and
                   creases. */
                double w = 1.0 / (d2 + 10000.0);
                weighted += samples[n].Y * w;
                total += w;

                if (d2 < Nearby * Nearby && samples[n].Y < lowest) lowest = samples[n].Y;
                if (d2 < nearest)
                {
                    nearest = d2;
                    nearestY = samples[n].Y;
                }
            }

            if (total <= 0) return 0f;

            double blended = weighted / total;
            /* Out in the fields there is no road within range, so the
               nearest one stands in for it. Nothing out there is close
               enough for the difference to be visible. */
            double ceiling = double.IsPositiveInfinity(lowest) ? nearestY : lowest;

            return (float)Math.Min(blended, ceiling);
        }

        /// <summary>Which field this corner belongs to, deterministically.</summary>
        private static int Field(int i, int j)
        {
            int h = unchecked(i * 73856093 ^ j * 19349663);
            return (h & 0x7fffffff) % Fields.Length;
        }

        /// <summary>The box the road occupies, in plan.</summary>
        private static Bounds Extent(TrackGeometry road)
        {
            var lo = new Vector3(float.MaxValue, float.MaxValue, float.MaxValue);
            var hi = new Vector3(float.MinValue, float.MinValue, float.MinValue);

            for (int v = 0; v < road.VertexCount; v++)
            {
                var p = new Vector3(
                    road.Positions[v * 3],
                    road.Positions[v * 3 + 1],
                    road.Positions[v * 3 + 2]);
                lo = Vector3.Min(lo, p);
                hi = Vector3.Max(hi, p);
            }

            var box = new Bounds();
            box.SetMinMax(lo, hi);
            return box;
        }
    }
}
