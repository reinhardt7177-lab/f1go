using System.Collections.Generic;
using UnityEngine;

namespace MumuF1.Game
{
    /// <summary>
    /// Everything beside the road: the wall that holds the car on it, the
    /// catch fence over that, and what stands behind both.
    /// </summary>
    /// <remarks>
    /// Where each thing goes is decided by <see cref="MumuF1.Trackside"/> in
    /// the engine-free package, where it is tested. This file only turns
    /// those placements into objects, and it will take them from either of
    /// two sources.
    ///
    /// If a racing kit has been unpacked into
    /// <c>Assets/Resources/Kit/</c> — Kenney's is CC0, so it can be — each
    /// kind is looked up by name and that model is used, repainted into the
    /// house style. If it has not, the shape comes from
    /// <see cref="MumuF1.PropMesh"/>, which is generated and tested like
    /// everything else here. Both look right enough to drive against, so the
    /// project has no asset it cannot build without and dropping a pack in is
    /// an improvement rather than a prerequisite.
    /// <c>Assets/Resources/Kit/README.md</c> has the names.
    ///
    /// Generated props are merged in chunks along the lap, and kit models are
    /// instantiated one each — Unity's GPU instancing already handles repeats
    /// of the same imported mesh, and a prefab may carry components that
    /// merging would throw away.
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
            /* Props first, and the order is load-bearing. Each one is
               dropped onto whatever is under it by a raycast, and the wall
               is a collider now — a hoarding stands sixty centimetres behind
               the barrier line, which is barely clear of a wall thirty-two
               centimetres thick, and the first one that landed on top of it
               would be a board standing in the air with no way to tell why.
               Nothing here needs the wall to exist yet. */
            BuildProps(circuit);
            BuildBarriers(road);
        }

        // --- the wall ---------------------------------------------------

        private void BuildBarriers(TrackGeometry road)
        {
            Barriers.Build(road, out Ribbon face, out Ribbon cap, out Ribbon fence);
            if (face.VertexCount == 0) return;

            /* The wall is the collider, and this is why it can be one.
               Frictionless, because a barrier that grips is worse than no
               barrier at all: a front wheel that catches on one pivots the
               car about it and throws the back end across the road, and the
               car is then pointing at the scenery with no speed to steer
               with. A real one scrubs you along itself and gives the car
               back. Nor does it bounce — a wall that returns energy fires
               you across the circuit into the opposite one.

               `Minimum` on both, so it stays frictionless and dead whatever
               the car's own surface says. Combine modes are a property of
               the pair, and the higher of the two materials' priorities
               decides; asking for the minimum from this side means the wall
               wins regardless. */
            var wall = new PhysicsMaterial("Barrier")
            {
                dynamicFriction = 0f,
                staticFriction = 0f,
                bounciness = 0f,
                frictionCombine = PhysicsMaterialCombine.Minimum,
                bounceCombine = PhysicsMaterialCombine.Minimum
            };

            BuildRibbon(face, "Barrier", new Color(0.93f, 0.945f, 0.957f), wall);
            BuildRibbon(cap, "BarrierCap", new Color(0.847f, 0.137f, 0.165f), wall);

            /* Drawn only. Posts and two rails are the wrong shape to collide
               with — thin, and full of the gaps that make it a fence — and
               the wall underneath is what the car actually meets. */
            BuildRibbon(fence, "CatchFence", new Color(0.35f, 0.38f, 0.42f), null);
        }

        private void BuildRibbon(Ribbon ribbon, string name, Color colour, PhysicsMaterial surface)
        {
            if (ribbon.VertexCount == 0) return;

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
            /* Every quad carries its own four vertices, so an averaged normal
               is still the quad's own normal — which is what flat shading
               wants, and what makes the top of the wall read as a separate
               surface from its face. */
            mesh.RecalculateNormals();
            mesh.RecalculateBounds();

            var go = new GameObject(name);
            go.transform.SetParent(transform, false);
            go.AddComponent<MeshFilter>().sharedMesh = mesh;

            /* No outline. The hull would double a mesh that is already the
               longest thing in the world, to draw a line along an edge the
               cap colour is already drawing. */
            go.AddComponent<MeshRenderer>().sharedMaterial = Paint.Flat(colour, outline: 0f);

            if (surface == null) return;

            MeshCollider collider = go.AddComponent<MeshCollider>();
            collider.sharedMesh = mesh;
            collider.material = surface;
        }

        // --- what stands behind it ---------------------------------------

        /// <summary>
        /// How many props go into one merged mesh.
        /// </summary>
        /// <remarks>
        /// Not all of them, and not one each. One mesh for the whole roadside
        /// is one draw call and no culling — Monza's four hundred props render
        /// in full while you are looking at a wall. One object per prop culls
        /// perfectly and costs four hundred draw calls. Chunking by position
        /// along the lap gives both: a handful of objects, each a contiguous
        /// stretch of circuit, so the ones behind you are skipped whole.
        /// </remarks>
        private const int ChunkSize = 48;

        /// <summary>How far into the ground a prop is pushed (m).</summary>
        /// <remarks>
        /// A tree standing exactly on a surface shows daylight under it the
        /// moment the surface is not perfectly level, and every surface here
        /// is swept from a spline and banked.
        /// </remarks>
        private const float Sink = 0.2f;

        private void BuildProps(Circuit circuit)
        {
            List<Placement> placements = Trackside.Place(circuit, Density);
            Dictionary<PropKind, Mesh> shapes = Shapes();

            /* The road and the land are already built and this is about to
               ask them questions, so PhysX has to have heard about them
               first. Colliders are registered when they are added, but their
               transforms are not synced on their own — `autoSyncTransforms`
               is off, and a scene query does not trigger a sync. */
            Physics.SyncTransforms();

            var chunk = new List<CombineInstance>();
            int built = 0;

            foreach (Placement p in placements)
            {
                var position = new Vector3((float)p.Position.X, (float)p.Position.Y, (float)p.Position.Z);
                position.y = Settle(position);
                var rotation = Quaternion.Euler(0f, (float)(p.Yaw * Mathf.Rad2Deg), 0f);
                var scale = Vector3.one * (float)p.Scale;

                GameObject prefab = FromKit(p.Kind);
                if (prefab != null)
                {
                    Seat(prefab, p.Kind, position, rotation, scale);
                    continue;
                }

                chunk.Add(new CombineInstance
                {
                    mesh = shapes[p.Kind],
                    transform = Matrix4x4.TRS(position, rotation, scale)
                });

                if (chunk.Count >= ChunkSize)
                {
                    Merge(chunk, built++);
                    chunk.Clear();
                }
            }

            if (chunk.Count > 0) Merge(chunk, built);
        }

        /// <summary>
        /// The height of whatever is under a prop.
        /// </summary>
        /// <remarks>
        /// <see cref="MumuF1.Trackside"/> places props on the plane of the
        /// road, forty centimetres down, because that is the only surface it
        /// knows about — it has the centreline and nothing else, and it
        /// cannot be given the rest without dragging the whole sweep into a
        /// file whose job is to decide <em>where</em> things go rather than
        /// how high.
        ///
        /// So the height is measured here, where the surfaces actually
        /// exist. It matters more than it used to: props stand up to fifty
        /// metres back, the verge falls a metre across its width and then
        /// the land falls further, so a forest planted on the road's plane
        /// hovers over all of it. That is what the trees behind the barrier
        /// were doing — standing at road height with nothing under them at
        /// all, because until now there was nothing out there to stand on.
        ///
        /// From well above and a long way down, because the land can be far
        /// below the road at a circuit that climbs. If nothing is found the
        /// placement's own height stands, which is what it did before.
        /// </remarks>
        private static float Settle(Vector3 at)
        {
            var from = new Vector3(at.x, at.y + 200f, at.z);

            return Physics.Raycast(from, Vector3.down, out RaycastHit hit, 600f,
                       ~0, QueryTriggerInteraction.Ignore)
                ? hit.point.y - Sink
                : at.y;
        }

        /// <summary>
        /// The kit's prefab for a kind, if the kit is there.
        /// </summary>
        /// <remarks>
        /// <c>Resources.Load</c> returns null rather than throwing when
        /// nothing is at the path, which is exactly the behaviour wanted: the
        /// kit is optional, a partial install is fine, and its absence is not
        /// an error.
        /// </remarks>
        private static GameObject FromKit(PropKind kind) =>
            Resources.Load<GameObject>(KitPath + kind);

        /// <summary>
        /// Stand a kit model where the generated one would have stood.
        /// </summary>
        /// <remarks>
        /// The model is measured and fitted rather than trusted — see
        /// <see cref="MumuF1.KitFit"/>. A pack exported in centimetres is a
        /// hundred times too big and one pivoted on its own middle sinks half
        /// of itself into the verge, and neither is visible without opening
        /// the file. Measuring here means whoever dropped the zip in never
        /// has to.
        ///
        /// The holder carries the placement — where on the circuit, which way
        /// round, how large — and the model sits inside it carrying the fit,
        /// so the two never have to be composed by hand.
        /// </remarks>
        private void Seat(GameObject prefab, PropKind kind, Vector3 position, Quaternion rotation, Vector3 scale)
        {
            var holder = new GameObject(kind.ToString());
            holder.transform.SetParent(transform, false);
            holder.transform.SetPositionAndRotation(position, rotation);
            holder.transform.localScale = scale;

            GameObject instance = Instantiate(prefab, holder.transform);

            if (LocalBounds(instance, out Bounds3 measured))
            {
                KitTransform fit = KitFit.Fit(measured, KitFit.Reference(kind));
                instance.transform.localScale = Vector3.one * (float)fit.Scale;
                instance.transform.localPosition = new Vector3(
                    (float)fit.Offset.X, (float)fit.Offset.Y, (float)fit.Offset.Z);
            }

            Repaint(instance, kind);
        }

        /// <summary>
        /// The box a model occupies, in its own root's space.
        /// </summary>
        /// <remarks>
        /// Read from the meshes rather than from a renderer, because a
        /// renderer's bounds are in world space and depend on where the thing
        /// currently is — which is the answer to a different question. Every
        /// corner is transformed rather than the two extremes, because a
        /// child rotated inside the prefab makes min and max meaningless on
        /// their own.
        /// </remarks>
        private static bool LocalBounds(GameObject model, out Bounds3 box)
        {
            Vector3 lo = Vector3.positiveInfinity;
            Vector3 hi = Vector3.negativeInfinity;
            bool any = false;

            Matrix4x4 toRoot = model.transform.worldToLocalMatrix;

            foreach (MeshFilter filter in model.GetComponentsInChildren<MeshFilter>(true))
            {
                Mesh mesh = filter.sharedMesh;
                if (mesh == null) continue;

                Matrix4x4 into = toRoot * filter.transform.localToWorldMatrix;
                Bounds local = mesh.bounds;

                for (int corner = 0; corner < 8; corner++)
                {
                    var at = new Vector3(
                        (corner & 1) == 0 ? local.min.x : local.max.x,
                        (corner & 2) == 0 ? local.min.y : local.max.y,
                        (corner & 4) == 0 ? local.min.z : local.max.z);
                    Vector3 p = into.MultiplyPoint3x4(at);
                    lo = Vector3.Min(lo, p);
                    hi = Vector3.Max(hi, p);
                    any = true;
                }
            }

            box = new Bounds3(new Vec3(lo.x, lo.y, lo.z), new Vec3(hi.x, hi.y, hi.z));
            return any;
        }

        /// <summary>
        /// Put a kit model into the house style.
        /// </summary>
        /// <remarks>
        /// Without this, dropping the pack in makes things worse rather than
        /// better: an imported model arrives wearing the render pipeline's
        /// default material, and a photographic grey box standing next to a
        /// circuit drawn in four flat bands inside a black line reads as a
        /// bug. The model's shape is what was wanted; its shading was not.
        ///
        /// A model's own material colours are kept where it has them — a
        /// tree's bark and its leaves are two named materials with real
        /// diffuse values, and flattening those would give it a green trunk.
        /// Where the colour lives in a palette texture instead, and the
        /// material is left white, the stand-in's colour is used, so a kit
        /// hoarding is the same blue as a generated one and the two can stand
        /// side by side during a partial install.
        /// </remarks>
        private static void Repaint(GameObject instance, PropKind kind)
        {
            foreach (Renderer r in instance.GetComponentsInChildren<Renderer>(true))
            {
                var slots = new Material[r.sharedMaterials.Length];
                for (int i = 0; i < slots.Length; i++)
                {
                    Material source = r.sharedMaterials[i];
                    string named = source != null ? source.name : null;
                    Color own = source != null ? source.color : Color.white;

                    slots[i] = Paint.Shared(Palette.ForPart(named, own, Colour(kind)));
                }
                r.sharedMaterials = slots;
            }
        }

        /// <summary>The generated shape for each kind, built once.</summary>
        private static Dictionary<PropKind, Mesh> Shapes()
        {
            var shapes = new Dictionary<PropKind, Mesh>();
            foreach (KeyValuePair<PropKind, Mesh3> entry in PropMesh.All())
            {
                shapes[entry.Key] = Meshes.From(entry.Value, entry.Key.ToString());
            }
            return shapes;
        }

        private void Merge(List<CombineInstance> chunk, int index)
        {
            /* Thirty-two bit indices before the combine, not after. Forty-eight
               props of up to ninety-six triangles each is fourteen thousand
               vertices — under the sixteen-bit limit today, and one prop
               getting more detailed is all it would take to wrap the buffer
               into confetti. */
            var mesh = new Mesh
            {
                name = $"Props {index}",
                indexFormat = UnityEngine.Rendering.IndexFormat.UInt32
            };
            mesh.CombineMeshes(chunk.ToArray(), true, true);
            mesh.RecalculateBounds();

            var go = new GameObject($"Props {index}");
            go.transform.SetParent(transform, false);
            go.AddComponent<MeshFilter>().sharedMesh = mesh;

            /* One material for the whole roadside. Trunks, canopies,
               hoardings and flags differ by vertex colour rather than by
               material, which is the same trick the circuit uses to draw
               tarmac, kerb, run-off and grass in one call. */
            go.AddComponent<MeshRenderer>().sharedMaterial = Paint.FromVertices(outline: 2.0f);
        }

        /// <summary>
        /// The house colour for a kind, for kit models that arrive without one.
        /// </summary>
        /// <remarks>
        /// The generated shapes carry their colours per vertex — a tree's
        /// trunk and its canopy are one mesh in two colours — so this is the
        /// single colour to fall back on when a whole imported model has to
        /// be painted at once. It is the dominant one.
        /// </remarks>
        private static Color Colour(PropKind kind)
        {
            switch (kind)
            {
                case PropKind.Conifer: return new Color(0.18f, 0.42f, 0.23f);
                case PropKind.Broadleaf: return new Color(0.31f, 0.58f, 0.25f);
                case PropKind.MarshalPost: return new Color(0.85f, 0.87f, 0.89f);
                case PropKind.Grandstand: return new Color(0.74f, 0.77f, 0.80f);
                case PropKind.AdBoard: return new Color(0.13f, 0.35f, 0.68f);
                case PropKind.Flag: return new Color(0.94f, 0.78f, 0.15f);
                default: return new Color(0.18f, 0.20f, 0.22f);
            }
        }
    }
}
