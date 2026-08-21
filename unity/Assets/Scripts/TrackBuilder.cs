using System.Collections.Generic;
using UnityEngine;

namespace MumuF1.Game
{
    /// <summary>
    /// The circuit, swept from a centreline at load.
    /// </summary>
    /// <remarks>
    /// Generated rather than modelled, which is how the web version does
    /// it too: a cross-section — tarmac, kerb, run-off, grass — is laid
    /// out at each station along the centreline and the stations are
    /// stitched into one mesh. The same triangles feed the renderer and
    /// the collider, so what you can see and what you can hit cannot
    /// disagree.
    ///
    /// The centreline here is the practice oval: two 250 m corners joined
    /// by straights, the circuit the web version opens on. It is
    /// deliberately the simplest one — the spline and the four real
    /// circuits are the next thing to come across, and this proves the
    /// sweep, the collider and the surfaces work before they do.
    /// </remarks>
    public class TrackBuilder : MonoBehaviour
    {
        public Vector3 StartPosition { get; private set; }
        public float StartHeadingDeg { get; private set; }

        /// <summary>Half-width of the tarmac (m).</summary>
        private const float HalfWidth = 9.5f;

        /// <summary>Metres between cross-sections.</summary>
        private const float StationSpacing = 4f;

        public static Transform Build(Transform parent)
        {
            var go = new GameObject("Circuit");
            go.transform.SetParent(parent);
            TrackBuilder builder = go.AddComponent<TrackBuilder>();
            builder.Generate();
            return go.transform;
        }

        /// <summary>
        /// The cross-section, as offsets from the centreline with the
        /// grip and colour of the surface between each pair.
        /// </summary>
        private static readonly (float T, Color Colour, double Grip)[] Section =
        {
            (-(HalfWidth + 12f), new Color(0.33f, 0.56f, 0.28f), 0.42),  // grass
            (-(HalfWidth + 3f), new Color(0.46f, 0.45f, 0.47f), 0.72),   // run-off
            (-(HalfWidth + 1.2f), new Color(0.88f, 0.18f, 0.18f), 0.85), // kerb
            (-HalfWidth, new Color(0.30f, 0.32f, 0.35f), 1.0),           // tarmac
            (HalfWidth, new Color(0.88f, 0.18f, 0.18f), 0.85),
            (HalfWidth + 1.2f, new Color(0.46f, 0.45f, 0.47f), 0.72),
            (HalfWidth + 3f, new Color(0.33f, 0.56f, 0.28f), 0.42),
            (HalfWidth + 12f, new Color(0.33f, 0.56f, 0.28f), 0.42)
        };

        private void Generate()
        {
            List<Vector3> centre = Centreline(out List<Vector3> lefts);
            int rings = centre.Count;
            int across = Section.Length;

            var vertices = new List<Vector3>(rings * across);
            var colours = new List<Color>(rings * across);
            var triangles = new List<int>();

            for (int ring = 0; ring < rings; ring++)
            {
                for (int i = 0; i < across; i++)
                {
                    /* The verges sit slightly lower than the road, so the
                       edge reads as an edge rather than as a colour
                       change. Nothing here is high enough to trip over —
                       a kerb with height is a launch ramp for a car with
                       a flat floor. */
                    float t = Section[i].T;
                    float drop = Mathf.Abs(t) <= HalfWidth ? 0f
                        : Mathf.Min(0.12f, (Mathf.Abs(t) - HalfWidth) * 0.02f);
                    vertices.Add(centre[ring] + lefts[ring] * t + Vector3.down * drop);
                    colours.Add(Section[i].Colour);
                }
            }

            for (int ring = 0; ring < rings; ring++)
            {
                int a = ring * across;
                int b = ((ring + 1) % rings) * across;   // wraps, so the lap closes
                for (int i = 0; i < across - 1; i++)
                {
                    triangles.Add(a + i); triangles.Add(b + i); triangles.Add(a + i + 1);
                    triangles.Add(a + i + 1); triangles.Add(b + i); triangles.Add(b + i + 1);
                }
            }

            var mesh = new Mesh { name = "Circuit", indexFormat = UnityEngine.Rendering.IndexFormat.UInt32 };
            mesh.SetVertices(vertices);
            mesh.SetTriangles(triangles, 0);
            mesh.SetColors(colours);
            mesh.RecalculateNormals();
            mesh.RecalculateBounds();

            var filter = gameObject.AddComponent<MeshFilter>();
            filter.sharedMesh = mesh;

            var renderer = gameObject.AddComponent<MeshRenderer>();
            renderer.sharedMaterial = VertexColourMaterial();

            var collider = gameObject.AddComponent<MeshCollider>();
            collider.sharedMesh = mesh;

            gameObject.AddComponent<SurfaceGrip>().Grip = 1.0;

            StartPosition = centre[0] + Vector3.up * 0.5f;
            Vector3 ahead = centre[1] - centre[0];
            StartHeadingDeg = Mathf.Atan2(ahead.x, ahead.z) * Mathf.Rad2Deg;
        }

        /// <summary>
        /// Two 250 m corners joined by straights — 3.37 km, the practice
        /// oval's shape. Returns the centreline and, for each station,
        /// the unit vector pointing left across the road.
        /// </summary>
        private static List<Vector3> Centreline(out List<Vector3> lefts)
        {
            const float radius = 250f;
            const float straight = 550f;

            var points = new List<Vector3>();
            void Straight(Vector3 from, Vector3 dir, float length)
            {
                int steps = Mathf.RoundToInt(length / StationSpacing);
                for (int i = 0; i < steps; i++) points.Add(from + dir * (i * StationSpacing));
            }
            void Arc(Vector3 pivot, float startDeg, float sweepDeg)
            {
                float arc = Mathf.Abs(sweepDeg) * Mathf.Deg2Rad * radius;
                int steps = Mathf.RoundToInt(arc / StationSpacing);
                for (int i = 0; i < steps; i++)
                {
                    float a = (startDeg + sweepDeg * i / steps) * Mathf.Deg2Rad;
                    points.Add(pivot + new Vector3(Mathf.Sin(a), 0f, Mathf.Cos(a)) * radius);
                }
            }

            Straight(new Vector3(radius, 0f, -straight / 2f), Vector3.forward, straight);
            Arc(new Vector3(0f, 0f, straight / 2f), 0f, 180f);
            Straight(new Vector3(-radius, 0f, straight / 2f), Vector3.back, straight);
            Arc(new Vector3(0f, 0f, -straight / 2f), 180f, 180f);

            lefts = new List<Vector3>(points.Count);
            for (int i = 0; i < points.Count; i++)
            {
                Vector3 tangent = (points[(i + 1) % points.Count] - points[i]).normalized;
                lefts.Add(Vector3.Cross(Vector3.up, tangent).normalized);
            }
            return points;
        }

        /// <summary>
        /// Flat colour straight from the vertices — the same idea the web
        /// version's toon renderer uses, and the reason the circuit needs
        /// no textures at all.
        /// </summary>
        private static Material VertexColourMaterial()
        {
            Shader shader = Shader.Find("Universal Render Pipeline/Unlit")
                ?? Shader.Find("Unlit/Color")
                ?? Shader.Find("Standard");
            var material = new Material(shader) { name = "Circuit" };
            if (material.HasProperty("_BaseColor")) material.SetColor("_BaseColor", Color.white);
            return material;
        }
    }
}
