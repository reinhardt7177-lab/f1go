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
    ///
    /// There is still a scene *file*, at <c>Assets/Scenes/Main.unity</c>,
    /// and it is empty on purpose. A player build has to be given at
    /// least one scene — without it the editor stops at <c>Cannot build
    /// untitled scene</c>, having compiled everything perfectly well
    /// first, which is a confusing way to be told the build list is
    /// blank. So the scene is a placeholder with nothing in it: no
    /// camera, no light, no objects, because this method makes all
    /// three.
    ///
    /// It runs <em>after</em> that scene loads, and the difference is not
    /// cosmetic. It ran before, and the whole world came up with no physics
    /// in it: the car hung motionless at exactly the height it was spawned
    /// at, every suspension ray came back empty, and a two-hundred-metre
    /// probe straight down through a road that was plainly there found
    /// nothing. A collider and a rigidbody belong to the scene they are
    /// created in, and at <c>BeforeSceneLoad</c> there is no scene to belong
    /// to — so PhysX never heard about any of them. Nothing said so.
    /// <c>FixedUpdate</c> still ran, the engine still revved to its limiter,
    /// the renderer still drew a car sitting correctly on a road, and the
    /// build was green from end to end. Three builds went out before an
    /// instrument was pointed at it.
    /// </remarks>
    public static class Bootstrap
    {
        public static CarController Car { get; private set; }

        /// <summary>The player's colours.</summary>
        /// <remarks>
        /// Here rather than in <see cref="CarView"/> because the livery is
        /// now an argument to the mesh: the whole car is one vertex-coloured
        /// object, so there is no material left to repaint and the colour has
        /// to be known before the car is built.
        /// </remarks>
        public static readonly Color LiveryColour = new Color(0.80f, 0.07f, 0.10f);

        /// <summary>Everything this made, so it can be unmade.</summary>
        private static GameObject _root;

        /// <summary>
        /// Tear the world down and build it again.
        /// </summary>
        /// <remarks>
        /// What the title card calls when the circuit changes. Nothing here
        /// is loaded from disk — the circuit is swept from a spline, the
        /// scenery is placed from a hash, the car is primitives — so building
        /// it a second time is a fraction of a second and needs no scene
        /// load. Which is just as well: `RuntimeInitializeOnLoadMethod` runs
        /// once at startup and never again, so reloading the scene would
        /// leave a world nobody had rebuilt.
        /// </remarks>
        public static void Rebuild()
        {
            if (_root != null) Object.Destroy(_root);
            Build();
        }

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
        private static void Build()
        {
            var root = new GameObject("mumuF1");
            _root = root;
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

            CarController car = BuildCar(root.transform, track);

            /* And the race around it. Everything from here down is timing,
               rules and rivals, all of it out of MumuF1.Core — the car above
               does not know a session exists and does not need to. */
            RaceDirector race = car.gameObject.AddComponent<RaceDirector>();
            race.Begin(track.GetComponent<TrackBuilder>());

            /* Drives itself when asked. An attract mode, and the only way
               anything here has ever completed a lap under test — a harness
               can hold the throttle down but cannot steer, because it cannot
               see where the car is. */
            car.gameObject.AddComponent<Autopilot>();

            RivalView.Build(root.transform, race);
            Hud.Build(root.transform, race, car);

            /* Last, and on top of everything. Until it is dismissed the
               session has not begun — not the clock, not the lights, not
               track limits — which is a different and stronger claim than
               the grid makes, and the web version learned it the hard way:
               the lights used to count down behind the card, so you tapped
               to find yourself already late off a grid you never saw. */
            Music.Build(root.transform);
            TitleCard.Build(root.transform, race);

            /* Push every collider just created into PhysX before anything
               asks it a question. Transforms are not synced on their own —
               `Physics.autoSyncTransforms` is off by default and a scene
               query does not trigger a sync — so the first suspension cast
               of the first tick would otherwise be asked about a world the
               physics engine had not been told about yet. It costs
               microseconds once. */
            Physics.SyncTransforms();
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

            /* Ambient, fog and the sky itself are Sky's, so there is one
               place that decides what the weather is rather than three that
               have to agree. */
        }

        private static CarController BuildCar(Transform parent, Transform track)
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

            /* Both, always. Which one is driving is decided at runtime by
               whether a finger has touched the screen — a laptop with a
               touchscreen is a real thing, and so is a phone with a
               keyboard, so this is not a build-time question. */
            car.AddComponent<TouchDriver>();
            car.AddComponent<KeyboardDriver>();

            /* Synthesised rather than sampled, so there is no audio file to
               import, give a GUID and reference from a serialised field. */
            car.AddComponent<CarAudio>();
            Car = controller;

            CarView.Build(car.transform, controller, LiveryColour);

            /* After the wheels exist, because it finds them by name. */
            car.AddComponent<WheelView>();

            var builder = track.GetComponent<TrackBuilder>();
            controller.Track = builder;
            controller.Reset(
                builder.StartPosition + Vector3.up * controller.SpawnHeight,
                builder.StartHeadingDeg);

            var rig = new GameObject("Camera");
            rig.transform.SetParent(parent);
            Camera cam = rig.AddComponent<Camera>();
            cam.fieldOfView = 62f;
            cam.nearClipPlane = 0.1f;
            cam.farClipPlane = 4000f;
            cam.backgroundColor = new Color(0.043f, 0.055f, 0.071f);
            rig.AddComponent<AudioListener>();

            /* With the camera, because the sky is half a camera setting: a
               skybox draws nothing unless the camera is told to clear to it,
               and a background colour behind a skybox is what shows through
               on the frame it fails to load. */
            Sky.Build(parent, cam);

            ChaseCamera chase = rig.AddComponent<ChaseCamera>();
            chase.Target = car.transform;

            return controller;
        }
    }
}
