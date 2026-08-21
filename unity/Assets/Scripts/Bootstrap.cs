using UnityEngine;

namespace MumuF1.Game
{
    /// <summary>
    /// Builds the whole game at load, from code.
    /// </summary>
    /// <remarks>
    /// There is no scene to speak of, and that is on purpose. Everything
    /// here is generated — the circuit is swept from a spline, the car is
    /// primitives, the camera and the light are three lines each — so a
    /// scene file would be a list of objects that code creates anyway,
    /// plus a hundred GUID references that can silently rot. Building it
    /// in <c>RuntimeInitializeOnLoadMethod</c> means it runs in *any*
    /// scene, including an empty one: open the project, press Play, and
    /// you are driving.
    ///
    /// It also means the project can be authored, reviewed and diffed as
    /// text, which is the only way it could be written at all — the
    /// machine this came from has no editor to click in.
    /// </remarks>
    public static class Bootstrap
    {
        public static CarController Car { get; private set; }

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.BeforeSceneLoad)]
        private static void Build()
        {
            var root = new GameObject("mumuF1");
            Object.DontDestroyOnLoad(root);

            /* 120 Hz, matching the web version. The tyre model is stiff —
               a wheel carries very little inertia against several thousand
               newton-metres — and at 60 Hz the slip ratio can jump past
               the grip peak in one step and run away into permanent
               wheelspin. The sub-stepping inside the wheel handles the
               rest. */
            Time.fixedDeltaTime = 1f / 120f;

            BuildLighting(root.transform);
            Transform track = TrackBuilder.Build(root.transform);

            /* The scenery is what makes the speed legible. An empty green
               plane offers nothing to pass, and at three hundred kilometres
               an hour the only thing moving is a road surface with no
               texture to move — so the car reads as slow however fast it
               actually is. */
            var builder = track.GetComponent<TrackBuilder>();
            TracksideBuilder.Build(root.transform, builder.Circuit, builder.Geometry);

            BuildCar(root.transform, track);
        }

        private static void BuildLighting(Transform parent)
        {
            var sun = new GameObject("Sun");
            sun.transform.SetParent(parent);
            sun.transform.rotation = Quaternion.Euler(52f, -35f, 0f);
            Light light = sun.AddComponent<Light>();
            light.type = LightType.Directional;
            light.color = new Color(1f, 0.953f, 0.867f);
            light.intensity = 1.4f;
            light.shadows = LightShadows.Hard;

            RenderSettings.ambientMode = UnityEngine.Rendering.AmbientMode.Trilight;
            RenderSettings.ambientSkyColor = new Color(0.60f, 0.75f, 0.92f);
            RenderSettings.ambientEquatorColor = new Color(0.45f, 0.50f, 0.55f);
            RenderSettings.ambientGroundColor = new Color(0.27f, 0.31f, 0.18f);
        }

        private static void BuildCar(Transform parent, Transform track)
        {
            var car = new GameObject("Car");
            car.transform.SetParent(parent);

            var body = car.AddComponent<Rigidbody>();
            body.useGravity = true;

            /* The collision box is a backstop, not a part of the car. The
               suspension is four raycasts and the tyres are a model, so
               this only matters when the car has ended up somewhere it
               should not be. It has to clear the road through the whole
               of suspension travel *and* through the roll a corner asks
               for — in the web version it did not, and running wide at a
               corner fired the car sixty metres into the air. Centred on
               the centre of mass leaves 140 mm underneath, which is
               80 mm at full bump and about six degrees of roll. */
            var box = car.AddComponent<BoxCollider>();
            box.size = new Vector3(1.8f, 0.28f, 5.0f);
            box.center = Vector3.zero;
            box.material = new PhysicsMaterial("Chassis")
            {
                dynamicFriction = 0.2f,
                staticFriction = 0.2f,
                bounciness = 0f,
                frictionCombine = PhysicsMaterialCombine.Minimum,
                bounceCombine = PhysicsMaterialCombine.Minimum
            };

            CarController controller = car.AddComponent<CarController>();
            car.AddComponent<KeyboardDriver>();
            Car = controller;

            CarView.Build(car.transform);

            var builder = track.GetComponent<TrackBuilder>();
            controller.Track = builder;
            controller.Reset(builder.StartPosition, builder.StartHeadingDeg);

            var rig = new GameObject("Camera");
            rig.transform.SetParent(parent);
            Camera cam = rig.AddComponent<Camera>();
            cam.fieldOfView = 62f;
            cam.nearClipPlane = 0.1f;
            cam.farClipPlane = 4000f;
            cam.backgroundColor = new Color(0.043f, 0.055f, 0.071f);
            rig.AddComponent<AudioListener>();
            ChaseCamera chase = rig.AddComponent<ChaseCamera>();
            chase.Target = car.transform;
        }
    }
}
