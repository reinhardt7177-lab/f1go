using UnityEngine;

namespace MumuF1.Game
{
    /// <summary>
    /// The circuit, swept from its centreline at load.
    /// </summary>
    /// <remarks>
    /// Generated rather than modelled, which is how the web version does
    /// it too, and the sweep itself is not here: it is
    /// <see cref="MumuF1.TrackMesh"/>, in the engine-free package, so the
    /// road the collider uses is the road a plain <c>dotnet test</c> can
    /// check. This file is the adapter — it turns plain arrays into a
    /// <c>Mesh</c> and hangs it on a GameObject, and decides nothing about
    /// the shape of the road.
    ///
    /// The same triangles feed the renderer and the collider, so what you
    /// can see and what you can hit cannot disagree.
    ///
    /// Which circuit is a static field rather than an inspector value,
    /// because there is no scene to set it in: assign
    /// <see cref="CircuitId"/> before the bootstrap runs and it takes
    /// effect, and otherwise you get the practice oval, which is where a
    /// new driver should start.
    /// </remarks>
    public class TrackBuilder : MonoBehaviour
    {
        /// <summary>
        /// Which circuit to build: oval, redbullring, interlagos, monza or
        /// proving.
        /// </summary>
        public static string CircuitId = "oval";

        /// <summary>Metres between cross-sections.</summary>
        private const double StationSpacing = 4;

        public Vector3 StartPosition { get; private set; }
        public float StartHeadingDeg { get; private set; }

        /// <summary>The circuit this was built from, for anything that needs (s, t).</summary>
        public Circuit Circuit { get; private set; }

        /// <summary>
        /// The sweep the road was built from.
        /// </summary>
        /// <remarks>
        /// Kept rather than discarded because the barrier is swept from the
        /// same vertices. Fitting a wall alongside the road instead of from
        /// it is how the two end up disagreeing about where the edge is.
        /// </remarks>
        public TrackGeometry Geometry { get; private set; }

        public static Transform Build(Transform parent)
        {
            var go = new GameObject("Circuit");
            go.transform.SetParent(parent);
            TrackBuilder builder = go.AddComponent<TrackBuilder>();
            builder.Generate(Circuits.Get(CircuitId));
            return go.transform;
        }

        /// <summary>
        /// Grip under a world position.
        /// </summary>
        /// <remarks>
        /// Projected onto the centreline and read from the circuit's own
        /// lateral profile, which is how the web version does it. The
        /// alternative — one grip per collider — cannot work here, because
        /// tarmac, kerb, run-off and grass are all one mesh: they are one
        /// draw call on purpose, and splitting them into four colliders to
        /// label them would cost four times the draw calls to answer a
        /// question the circuit can already answer exactly.
        ///
        /// The hint is the previous answer, which turns the projection from
        /// a scan of the whole lap into a search of a sixty-metre window.
        /// A car cannot have moved further than that in a tick.
        /// </remarks>
        public double GripAt(Vector3 world, ref double hint)
        {
            var projection = Circuit.Spline.Project(new Vec3(world.x, world.y, world.z), hint);
            hint = projection.S;
            return Circuit.GripAt(projection.S, projection.T);
        }

        private void Generate(Circuit circuit)
        {
            Circuit = circuit;
            TrackGeometry geometry = TrackMesh.Build(circuit, StationSpacing);
            Geometry = geometry;

            var vertices = new Vector3[geometry.VertexCount];
            var normals = new Vector3[geometry.VertexCount];
            var colours = new Color[geometry.VertexCount];

            for (int v = 0; v < geometry.VertexCount; v++)
            {
                vertices[v] = new Vector3(
                    geometry.Positions[v * 3],
                    geometry.Positions[v * 3 + 1],
                    geometry.Positions[v * 3 + 2]);
                normals[v] = new Vector3(
                    geometry.Normals[v * 3],
                    geometry.Normals[v * 3 + 1],
                    geometry.Normals[v * 3 + 2]);
                colours[v] = new Color(
                    geometry.Colors[v * 3],
                    geometry.Colors[v * 3 + 1],
                    geometry.Colors[v * 3 + 2]);
            }

            /* Thirty-two bit indices, always. Monza sweeps 5,793 m at four
               metres with twenty-two vertices across, which is 31,861 — a
               hair under the 65,535 a sixteen-bit buffer holds, and the
               next circuit added would silently wrap. */
            var mesh = new Mesh
            {
                name = circuit.Spec.Name,
                indexFormat = UnityEngine.Rendering.IndexFormat.UInt32
            };
            mesh.SetVertices(vertices);
            mesh.SetTriangles(geometry.Indices, 0);
            /* The sweep's own normals, not RecalculateNormals. Every
               surface is flat-shaded and the cross-section deliberately
               puts pairs of vertices a centimetre apart to make a hard
               edge — averaging across those would round off exactly the
               edges that are there to be sharp. */
            mesh.SetNormals(normals);
            mesh.SetColors(colours);
            mesh.RecalculateBounds();

            var filter = gameObject.AddComponent<MeshFilter>();
            filter.sharedMesh = mesh;

            var renderer = gameObject.AddComponent<MeshRenderer>();
            /* No outline on the road. The hull is a silhouette line and
               a road has no silhouette — pushing one out of a 5 km ribbon
               puts a black band down the middle of every straight. */
            renderer.sharedMaterial = Paint.FromVertices(outline: 0f);

            var collider = gameObject.AddComponent<MeshCollider>();
            collider.sharedMesh = mesh;

            StartPosition = vertices.Length > 0
                ? Centre(circuit, 0) + Vector3.up * 0.5f
                : Vector3.up * 0.5f;

            Vector3 ahead = Centre(circuit, 2) - Centre(circuit, 0);
            StartHeadingDeg = Mathf.Atan2(ahead.x, ahead.z) * Mathf.Rad2Deg;
        }

        private static Vector3 Centre(Circuit circuit, double s)
        {
            Vec3 p = circuit.Spline.SampleAt(s).Position;
            return new Vector3((float)p.X, (float)p.Y, (float)p.Z);
        }
    }
}
