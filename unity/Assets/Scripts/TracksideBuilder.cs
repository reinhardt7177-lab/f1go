using System.Collections.Generic;
using UnityEngine;

namespace MumuF1.Game
{
    /// <summary>
    /// Everything beside the road: the wall, and what stands behind it.
    /// </summary>
    /// <remarks>
    /// Where each thing goes is decided by <see cref="MumuF1.Trackside"/> in
    /// the engine-free package, where it is tested. This file only turns
    /// those placements into objects, and it will take them from either of
    /// two sources.
    ///
    /// If Kenney's Racing Kit has been unpacked into
    /// <c>Assets/Resources/Kit/</c> — it is CC0, so it can be — each kind is
    /// looked up by name and the prefab is used. If it has not, the same
    /// kinds are built out of primitives in the house style. Both look right
    /// enough to drive against, so the project has no asset it cannot build
    /// without, and dropping the pack in is an improvement rather than a
    /// prerequisite. <c>Assets/Resources/Kit/README.md</c> has the names.
    ///
    /// The stand-ins are merged, one mesh per kind. Four hundred separate
    /// tree objects would be four hundred draw calls; merged, a whole forest
    /// is one. Prefabs from the kit are instantiated individually, because
    /// they arrive as prefabs and Unity's GPU instancing already handles
    /// repeats of the same mesh.
    /// </remarks>
    public class TracksideBuilder : MonoBehaviour
    {
        /// <summary>Where an unpacked racing kit is looked for.</summary>
        public const string KitPath = "Kit/";

        /// <summary>
        /// How much of the forest to build, zero to one.
        /// </summary>
        /// <remarks>
        /// Thinned deterministically — see <see cref="MumuF1.Trackside.Place"/>.
        /// Turning this down removes trees without moving the ones that stay,
        /// so a circuit learned on one machine is the same circuit on another.
        /// </remarks>
        public static float Density = 1f;

        public static Transform Build(Transform parent, Circuit circuit, TrackGeometry road)
        {
            var go = new GameObject("Trackside");
            go.transform.SetParent(parent);
            go.AddComponent<TracksideBuilder>().Generate(circuit, road);
            return go.transform;
        }

        private void Generate(Circuit circuit, TrackGeometry road)
        {
            BuildBarriers(road);
            BuildProps(circuit);
        }

        // --- the wall ---------------------------------------------------

        private void BuildBarriers(TrackGeometry road)
        {
            Barriers.Build(road, out Ribbon face, out Ribbon cap);
            if (face.VertexCount == 0) return;

            BuildRibbon(face, "Barrier", new Color(0.93f, 0.945f, 0.957f));
            BuildRibbon(cap, "BarrierCap", new Color(0.847f, 0.137f, 0.165f));
        }

        private void BuildRibbon(Ribbon ribbon, string name, Color colour)
        {
            var vertices = new Vector3[ribbon.VertexCount];
            for (int v = 0; v < ribbon.VertexCount; v++)
            {
                vertices[v] = new Vector3(
                    ribbon.Positions[v * 3],
                    ribbon.Positions[v * 3 + 1],
                    ribbon.Positions[v * 3 + 2]);
            }

            var mesh = new Mesh
            {
                name = name,
                indexFormat = UnityEngine.Rendering.IndexFormat.UInt32
            };
            mesh.SetVertices(vertices);
            mesh.SetTriangles(ribbon.Indices, 0);
            /* The wall is a single plane, so it has no volume to derive
               normals from the way a solid does — but a flat quad's averaged
               normal is still the quad's normal, which is what is wanted. */
            mesh.RecalculateNormals();
            mesh.RecalculateBounds();

            var go = new GameObject(name);
            go.transform.SetParent(transform, false);
            go.AddComponent<MeshFilter>().sharedMesh = mesh;

            /* No outline, and no collider. The hull would double a wall that
               is already two triangles per ring, and the collider is
               deliberately absent: a thin wall in a trimesh is something a
               car at 250 km/h goes through or climbs. */
            go.AddComponent<MeshRenderer>().sharedMaterial = Paint.Flat(colour, outline: 0f);
        }

        // --- what stands behind it ---------------------------------------

        private void BuildProps(Circuit circuit)
        {
            List<Placement> placements = Trackside.Place(circuit, Density);

            var standIns = new Dictionary<PropKind, List<CombineInstance>>();

            foreach (Placement p in placements)
            {
                var position = new Vector3((float)p.Position.X, (float)p.Position.Y, (float)p.Position.Z);
                var rotation = Quaternion.Euler(0f, (float)(p.Yaw * Mathf.Rad2Deg), 0f);
                var scale = Vector3.one * (float)p.Scale;

                GameObject prefab = FromKit(p.Kind);
                if (prefab != null)
                {
                    GameObject instance = Instantiate(prefab, position, rotation, transform);
                    instance.transform.localScale = scale;
                    continue;
                }

                if (!standIns.TryGetValue(p.Kind, out List<CombineInstance> parts))
                {
                    parts = new List<CombineInstance>();
                    standIns[p.Kind] = parts;
                }

                foreach (CombineInstance part in StandIn.Parts(p.Kind))
                {
                    parts.Add(new CombineInstance
                    {
                        mesh = part.mesh,
                        transform = Matrix4x4.TRS(position, rotation, scale) * part.transform
                    });
                }
            }

            foreach (KeyValuePair<PropKind, List<CombineInstance>> entry in standIns)
            {
                Merge(entry.Key, entry.Value);
            }
        }

        /// <summary>
        /// The kit's prefab for a kind, if the kit is there.
        /// </summary>
        /// <remarks>
        /// <c>Resources.Load</c> returns null rather than throwing when
        /// nothing is at the path, which is exactly the behaviour wanted: the
        /// kit is optional and its absence is not an error.
        /// </remarks>
        private static GameObject FromKit(PropKind kind) =>
            Resources.Load<GameObject>(KitPath + kind);

        private void Merge(PropKind kind, List<CombineInstance> parts)
        {
            if (parts.Count == 0) return;

            /* Thirty-two bit indices before the combine, not after. A
               broadleaf stand-in is two spheres and a trunk, a bit over a
               thousand vertices, and Monza scatters three hundred trees —
               so this mesh is well past the 65,535 a sixteen-bit buffer
               holds, and the default would wrap it into confetti. */
            var mesh = new Mesh
            {
                name = kind.ToString(),
                indexFormat = UnityEngine.Rendering.IndexFormat.UInt32
            };
            mesh.CombineMeshes(parts.ToArray(), true, true);
            mesh.RecalculateNormals();
            mesh.RecalculateBounds();

            var go = new GameObject(kind.ToString());
            go.transform.SetParent(transform, false);
            go.AddComponent<MeshFilter>().sharedMesh = mesh;
            go.AddComponent<MeshRenderer>().sharedMaterial = Paint.Flat(StandIn.Colour(kind));
        }
    }

    /// <summary>
    /// What each kind looks like when the racing kit is not installed.
    /// </summary>
    /// <remarks>
    /// Primitives, and deliberately crude ones. Nothing here is looked at
    /// for longer than a fifth of a second at the edge of vision, which is
    /// the same reason the whole game is drawn in flat colour inside a black
    /// line: what has to survive is the silhouette, and a cone on a cylinder
    /// is a tree at two hundred metres.
    ///
    /// Each kind returns its parts as meshes with a local transform, so the
    /// caller can bake hundreds of them into one mesh rather than one object
    /// each.
    /// </remarks>
    public static class StandIn
    {
        private static Mesh _cube;
        private static Mesh _cylinder;
        private static Mesh _sphere;

        private static Mesh Cube => _cube != null ? _cube : _cube = Primitive(PrimitiveType.Cube);
        private static Mesh Cylinder => _cylinder != null ? _cylinder : _cylinder = Primitive(PrimitiveType.Cylinder);
        private static Mesh Sphere => _sphere != null ? _sphere : _sphere = Primitive(PrimitiveType.Sphere);

        /// <summary>
        /// Unity's primitive meshes, taken once.
        /// </summary>
        /// <remarks>
        /// <c>CreatePrimitive</c> is the only way to get at them from script,
        /// and it makes a GameObject to do it — so the object is destroyed
        /// immediately and the mesh kept. Doing this once per tree rather
        /// than once per kind would create and destroy four hundred objects
        /// at load.
        /// </remarks>
        private static Mesh Primitive(PrimitiveType type)
        {
            GameObject probe = GameObject.CreatePrimitive(type);
            Mesh mesh = probe.GetComponent<MeshFilter>().sharedMesh;
            Object.DestroyImmediate(probe);
            return mesh;
        }

        public static Color Colour(PropKind kind)
        {
            switch (kind)
            {
                case PropKind.Conifer: return new Color(0.184f, 0.420f, 0.227f);
                case PropKind.Broadleaf: return new Color(0.306f, 0.580f, 0.251f);
                case PropKind.MarshalPost: return new Color(0.847f, 0.867f, 0.890f);
                case PropKind.Grandstand: return new Color(0.737f, 0.769f, 0.800f);
                case PropKind.AdBoard: return new Color(0.129f, 0.353f, 0.678f);
                case PropKind.Flag: return new Color(0.937f, 0.784f, 0.145f);
                default: return new Color(0.180f, 0.196f, 0.220f);
            }
        }

        public static IEnumerable<CombineInstance> Parts(PropKind kind)
        {
            switch (kind)
            {
                case PropKind.Conifer:
                    yield return At(Cylinder, new Vector3(0f, 1.1f, 0f), new Vector3(0.6f, 1.1f, 0.6f));
                    /* Three stacked, narrowing upward. One cone reads as a
                       traffic marker; three read as a conifer, which is the
                       whole difference at the distance it is seen from. */
                    yield return At(Cube, new Vector3(0f, 3.4f, 0f), new Vector3(4.2f, 2.6f, 4.2f));
                    yield return At(Cube, new Vector3(0f, 5.4f, 0f), new Vector3(3.0f, 2.4f, 3.0f));
                    yield return At(Cube, new Vector3(0f, 7.0f, 0f), new Vector3(1.7f, 2.0f, 1.7f));
                    break;

                case PropKind.Broadleaf:
                    yield return At(Cylinder, new Vector3(0f, 1.3f, 0f), new Vector3(0.7f, 1.3f, 0.7f));
                    /* Two overlapping balls rather than one. A single ball
                       reads as a lollipop; two of different sizes, offset,
                       read as foliage. */
                    yield return At(Sphere, new Vector3(0f, 4.6f, 0f), new Vector3(5.0f, 4.4f, 5.0f));
                    yield return At(Sphere, new Vector3(1.1f, 3.6f, 0.5f), new Vector3(3.6f, 3.2f, 3.6f));
                    break;

                case PropKind.MarshalPost:
                    yield return At(Cylinder, new Vector3(0f, 1.3f, 0f), new Vector3(0.18f, 1.3f, 0.18f));
                    yield return At(Cube, new Vector3(0f, 2.9f, 0f), new Vector3(1.5f, 1.0f, 0.12f));
                    break;

                case PropKind.Grandstand:
                    // The rake, as five steps, then a roof on two columns.
                    for (int i = 0; i < 5; i++)
                    {
                        float h = 1.4f + i * 0.2f;
                        yield return At(Cube, new Vector3(0f, h * 0.5f, -i * 2.2f), new Vector3(26f, h, 2.2f));
                    }
                    yield return At(Cube, new Vector3(0f, 9.4f, -4.4f), new Vector3(27f, 0.5f, 12f));
                    yield return At(Cube, new Vector3(-12f, 4.7f, 1.2f), new Vector3(0.7f, 9f, 0.7f));
                    yield return At(Cube, new Vector3(12f, 4.7f, 1.2f), new Vector3(0.7f, 9f, 0.7f));
                    break;

                case PropKind.AdBoard:
                    yield return At(Cube, new Vector3(0f, 0.9f, 0f), new Vector3(7.0f, 1.4f, 0.14f));
                    yield return At(Cube, new Vector3(-3.2f, 0.5f, 0.12f), new Vector3(0.16f, 1.0f, 0.16f));
                    yield return At(Cube, new Vector3(3.2f, 0.5f, 0.12f), new Vector3(0.16f, 1.0f, 0.16f));
                    break;

                case PropKind.Flag:
                    yield return At(Cylinder, new Vector3(0f, 2.6f, 0f), new Vector3(0.12f, 2.6f, 0.12f));
                    yield return At(Cube, new Vector3(0.9f, 4.6f, 0f), new Vector3(1.8f, 1.1f, 0.06f));
                    break;

                case PropKind.StartGantry:
                    /* Legs outside the road, so the thing that spans the
                       timing line never has anything standing on it. The
                       twelve metres is the widest half-width any circuit
                       here uses plus its kerb. */
                    yield return At(Cube, new Vector3(-12f, 3.4f, 0f), new Vector3(0.8f, 6.8f, 0.8f));
                    yield return At(Cube, new Vector3(12f, 3.4f, 0f), new Vector3(0.8f, 6.8f, 0.8f));
                    yield return At(Cube, new Vector3(0f, 7.2f, 0f), new Vector3(24.8f, 1.2f, 1.0f));
                    break;
            }
        }

        private static CombineInstance At(Mesh mesh, Vector3 position, Vector3 scale) =>
            new CombineInstance
            {
                mesh = mesh,
                transform = Matrix4x4.TRS(position, Quaternion.identity, scale)
            };
    }
}
