using UnityEngine;

namespace MumuF1.Game
{
    /// <summary>
    /// Something to look at while the physics is what matters.
    /// </summary>
    /// <remarks>
    /// Two sources, the same arrangement the roadside uses. If a car model
    /// has been installed under <c>Assets/Resources/Kit/Car</c> it is used,
    /// measured and fitted to the space the primitives occupied; if not, the
    /// primitives are the car. Wheels are separate and looked up separately,
    /// so a pack that has a body and no wheel still works.
    ///
    /// The primitives are not a placeholder to be embarrassed about. A
    /// modelled car is an asset to import, and an asset is the one kind of
    /// change that cannot be authored as text — which is what this whole
    /// project is. It is also the right order of work: the shape of the car
    /// changes nothing about how it drives, so it can be the last thing done
    /// properly rather than the first.
    ///
    /// Nothing here moves. The wheels do not steer or spin yet, in either
    /// version — the simulation knows every wheel's angle and speed, so
    /// wiring that up is a small job, and it is a different one.
    /// </remarks>
    public static class CarView
    {
        private const string Kit = "Kit/";

        private static readonly Color Livery = new Color(0.85f, 0.09f, 0.11f);
        private static readonly Color Rubber = new Color(0.09f, 0.09f, 0.10f);

        /// <summary>
        /// The space the primitive car fills, as the reference an imported
        /// model is fitted to.
        /// </summary>
        /// <remarks>
        /// The union of the boxes below: 1.8 m across the front wing, from
        /// 110 mm below the hub to the top of the rear wing, and from the
        /// back of that wing to the tip of the nose. Written down rather than
        /// measured at runtime because it is the *intended* size of the car,
        /// and a model should be fitted to that rather than to whatever the
        /// primitives happen to add up to.
        /// </remarks>
        private static readonly Bounds3 BodySpace =
            new Bounds3(new Vec3(-0.9, -0.11, -2.35), new Vec3(0.9, 0.88, 3.25));

        /// <summary>A wheel 0.72 across and 0.36 wide, about its hub.</summary>
        private static readonly Bounds3 WheelSpace =
            new Bounds3(new Vec3(-0.18, -0.36, -0.36), new Vec3(0.18, 0.36, 0.36));

        private const float Front = 1.98f;
        private const float Rear = -1.62f;

        public static void Build(Transform car)
        {
            if (!Fitted(car, "Car", BodySpace, Vector3.zero, Livery, centred: false))
            {
                Primitives(car);
            }

            Wheel(car, "FL", new Vector3(-0.80f, -0.16f, Front));
            Wheel(car, "FR", new Vector3(0.80f, -0.16f, Front));
            Wheel(car, "RL", new Vector3(-0.78f, -0.16f, Rear));
            Wheel(car, "RR", new Vector3(0.78f, -0.16f, Rear));
        }

        /// <summary>The body, from primitives.</summary>
        private static void Primitives(Transform car)
        {
            Colour(Box(car, "Body", new Vector3(0f, 0.05f, 0f), new Vector3(1.0f, 0.32f, 4.4f)), Livery);
            Colour(Box(car, "Nose", new Vector3(0f, 0.02f, 2.5f), new Vector3(0.45f, 0.2f, 1.2f)), Livery);
            Colour(Box(car, "RearWing", new Vector3(0f, 0.72f, -2.2f), new Vector3(1.7f, 0.32f, 0.3f)), Livery);
            Colour(Box(car, "FrontWing", new Vector3(0f, -0.05f, 3.0f), new Vector3(1.8f, 0.1f, 0.5f)), Livery);
            Colour(Box(car, "Halo", new Vector3(0f, 0.42f, 0.6f), new Vector3(0.7f, 0.08f, 0.8f)),
                new Color(0.1f, 0.1f, 0.12f));
        }

        private static void Wheel(Transform car, string name, Vector3 at)
        {
            if (Fitted(car, "Wheel", WheelSpace, at, Rubber, centred: true, name: name)) return;

            GameObject go = GameObject.CreatePrimitive(PrimitiveType.Cylinder);
            go.name = name;
            Object.Destroy(go.GetComponent<Collider>());
            go.transform.SetParent(car, false);
            go.transform.localPosition = at;
            go.transform.localRotation = Quaternion.Euler(0f, 0f, 90f);
            go.transform.localScale = new Vector3(0.72f, 0.18f, 0.72f);
            Colour(go, Rubber);
        }

        /// <summary>
        /// Instantiate an installed model into the space a primitive filled.
        /// </summary>
        /// <remarks>
        /// Measured rather than trusted, for the reason the roadside is: a
        /// pack's units and pivots are not knowable without opening the file,
        /// and a car a hundred times too large is not a subtle failure. The
        /// holder carries where the part goes on the car and the model sits
        /// inside it carrying the fit, so the two never have to be composed
        /// by hand.
        ///
        /// Repainted, too. An imported model arrives wearing the pipeline's
        /// default material, and a photographic car inside a black outline
        /// would look like a mistake rather than a car.
        /// </remarks>
        private static bool Fitted(
            Transform car, string resource, Bounds3 space, Vector3 at,
            Color colour, bool centred, string name = null)
        {
            var prefab = Resources.Load<GameObject>(Kit + resource);
            if (prefab == null) return false;

            var holder = new GameObject(name ?? resource);
            holder.transform.SetParent(car, false);
            holder.transform.localPosition = at;

            GameObject model = Object.Instantiate(prefab, holder.transform);

            if (Measure(model, out Bounds3 box))
            {
                KitTransform fit = centred
                    ? KitFit.FitCentred(box, space)
                    : KitFit.Fit(box, space);

                model.transform.localScale = Vector3.one * (float)fit.Scale;
                model.transform.localPosition = new Vector3(
                    (float)fit.Offset.X, (float)fit.Offset.Y, (float)fit.Offset.Z);
            }

            foreach (Renderer r in model.GetComponentsInChildren<Renderer>(true))
            {
                var slots = new Material[r.sharedMaterials.Length];
                for (int i = 0; i < slots.Length; i++)
                {
                    Material source = r.sharedMaterials[i];
                    Color own = source != null ? source.color : Color.white;
                    slots[i] = Paint.Shared(Paint.Deliberate(own) ? own : colour);
                }
                r.sharedMaterials = slots;
            }

            foreach (Collider c in model.GetComponentsInChildren<Collider>(true))
            {
                /* The car collides with one box, decided in the bootstrap. A
                   collider arriving inside an imported model would be a
                   second one, of an unknown shape, on the rigidbody that the
                   whole vehicle model is applied to. */
                Object.Destroy(c);
            }

            return true;
        }

        /// <summary>The box a model occupies, in its own root's space.</summary>
        private static bool Measure(GameObject model, out Bounds3 box)
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
                    var p = into.MultiplyPoint3x4(new Vector3(
                        (corner & 1) == 0 ? local.min.x : local.max.x,
                        (corner & 2) == 0 ? local.min.y : local.max.y,
                        (corner & 4) == 0 ? local.min.z : local.max.z));
                    lo = Vector3.Min(lo, p);
                    hi = Vector3.Max(hi, p);
                    any = true;
                }
            }

            box = new Bounds3(new Vec3(lo.x, lo.y, lo.z), new Vec3(hi.x, hi.y, hi.z));
            return any;
        }

        private static GameObject Box(Transform car, string name, Vector3 at, Vector3 size)
        {
            GameObject go = GameObject.CreatePrimitive(PrimitiveType.Cube);
            go.name = name;
            Object.Destroy(go.GetComponent<Collider>());
            go.transform.SetParent(car, false);
            go.transform.localPosition = at;
            go.transform.localScale = size;
            return go;
        }

        private static void Colour(GameObject go, Color colour)
        {
            go.GetComponent<MeshRenderer>().sharedMaterial = Paint.Flat(colour);
        }
    }
}
