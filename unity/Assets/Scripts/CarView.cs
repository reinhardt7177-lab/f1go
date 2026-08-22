using UnityEngine;

namespace MumuF1.Game
{
    /// <summary>
    /// The car, as an object.
    /// </summary>
    /// <remarks>
    /// Two sources, the same arrangement the roadside uses. If a model has
    /// been installed under <c>Assets/Resources/Kit/Car</c> it is used,
    /// measured and fitted to the space the generated one occupies; if not,
    /// the generated one is the car. Wheels are separate and looked up
    /// separately, so a pack with a body and no wheel still works.
    ///
    /// The generated car is not a placeholder. It was five boxes for a long
    /// time, on the argument that a car is an asset and an asset cannot be
    /// authored as text — which is true of a *modelled* car and not of a
    /// generated one. <see cref="MumuF1.CarMesh"/> is a table of
    /// cross-sections and a handful of wings, written down and diffable, and
    /// it makes a shape a box never could: a single-seater is recognisable by
    /// its taper, and axis-aligned boxes cannot taper.
    ///
    /// Where the wheels go is asked of the car rather than written here. It
    /// used to be written here, and it was wrong by a fifth of a metre —
    /// every wheel was drawn buried in the road while the physics hung them
    /// from a hardpoint the view had never heard of.
    /// </remarks>
    public static class CarView
    {
        private const string Kit = "Kit/";

        private static readonly Color Rubber = new Color(0.09f, 0.09f, 0.10f);

        /// <summary>A wheel 0.72 across and 0.36 wide, about its hub.</summary>
        /// <remarks>
        /// The space an installed wheel model is fitted into. The body has
        /// one too, and it lives with the shape it describes — see
        /// <see cref="MumuF1.CarMesh.Space"/>. This one stays here because
        /// the wheel's size is the chassis's, not the mesh's.
        /// </remarks>
        private static readonly Bounds3 WheelSpace =
            new Bounds3(new Vec3(-0.18, -0.36, -0.36), new Vec3(0.18, 0.36, 0.36));

        private static Mesh _wheelMesh;

        /// <summary>Build the car onto <paramref name="car"/>.</summary>
        /// <remarks>
        /// The chassis is asked where its wheels are rather than told. It
        /// knows: the hardpoints, the spring's rest length and the wheel's
        /// radius are all its own numbers, and they are the numbers the
        /// suspension raycast uses. Reading them here means the drawn wheel
        /// and the simulated one cannot drift apart.
        /// </remarks>
        public static void Build(Transform car, CarController chassis, Color livery)
        {
            if (!Fitted(car, "Car", CarMesh.Space, Vector3.zero, livery, centred: false))
            {
                Generated(car, livery);
            }

            for (int i = 0; i < 4; i++)
            {
                Wheel(car, Names[i], chassis.HubRest(i));
            }
        }

        private static readonly string[] Names = { "FL", "FR", "RL", "RR" };

        /// <summary>The body, generated.</summary>
        /// <remarks>
        /// One object, one mesh, one material. Bodywork, wings, floor, halo
        /// and helmet differ by vertex colour, which is the same trick the
        /// road and the roadside use — so a whole car is a single draw call
        /// and there is nothing left to repaint afterwards. The livery is
        /// baked in for that reason: a field of ten is ten small meshes
        /// rather than ten cars' worth of separately-coloured parts.
        /// </remarks>
        private static void Generated(Transform car, Color livery)
        {
            var go = new GameObject("Body");
            go.transform.SetParent(car, false);
            go.AddComponent<MeshFilter>().sharedMesh =
                Meshes.From(CarMesh.Build(Meshes.Tint(livery)), "Car");
            go.AddComponent<MeshRenderer>().sharedMaterial = Paint.FromVertices(outline: 2.4f);
        }

        /// <summary>One wheel, at its hub.</summary>
        /// <remarks>
        /// The generated wheel carries five bright spokes on each face, and
        /// they are the point of it: a plain black cylinder is rotationally
        /// symmetric, so a wheel at three thousand rpm looks exactly like a
        /// locked one. Braking into a corner is unreadable without them.
        ///
        /// The mesh is built once and shared by every wheel on every car —
        /// forty of them in a full field — because unlike the body it carries
        /// no livery.
        /// </remarks>
        private static void Wheel(Transform car, string name, Vector3 at)
        {
            if (Fitted(car, "Wheel", WheelSpace, at, Rubber, centred: true, name: name)) return;

            if (_wheelMesh == null) _wheelMesh = Meshes.From(CarMesh.Wheel(), "Wheel");

            var go = new GameObject(name);
            go.transform.SetParent(car, false);
            go.transform.localPosition = at;
            go.AddComponent<MeshFilter>().sharedMesh = _wheelMesh;
            go.AddComponent<MeshRenderer>().sharedMaterial = Paint.FromVertices(outline: 2.0f);
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

    }
}
