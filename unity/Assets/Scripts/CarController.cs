using UnityEngine;
using MumuF1;

namespace MumuF1.Game
{
    /// <summary>
    /// The car: a rigid body held up by four raycasts.
    /// </summary>
    /// <remarks>
    /// Almost nothing here decides anything. Every number that matters —
    /// what the tyre does with a slip angle, what the floor does at a
    /// ride height, what a spring carries at a compression — comes from
    /// <c>MumuF1.Core</c>, which has no Unity in it and is tested on its
    /// own. This file is the wiring: it asks the engine where the road
    /// is, hands the answers to the model, and applies what comes back.
    ///
    /// That split is deliberate and it is the whole reason the port is
    /// safe. A <c>WheelCollider</c> would have been fewer lines and would
    /// have thrown the model away with them — the handling would then be
    /// PhysX's opinion rather than the one that was tuned and tested.
    /// Four raycasts and <c>AddForceAtPosition</c> is exactly the shape
    /// the TypeScript already had, so the behaviour comes across intact.
    /// </remarks>
    [RequireComponent(typeof(Rigidbody))]
    public class CarController : MonoBehaviour
    {
        // Indices, matching the core's convention.
        public const int FL = 0, FR = 1, RL = 2, RR = 3;

        [Header("Chassis")]
        public float Mass = 798f;
        public Vector3 Inertia = new Vector3(1000f, 1100f, 150f);
        public float Wheelbase = 3.6f;
        public float TrackFront = 1.6f;
        public float TrackRear = 1.55f;
        public float FrontWeightBias = 0.45f;
        public float HardpointY = 0.16f;
        public float WheelRadius = 0.36f;
        public float WheelInertia = 1.8f;
        public float MaxSteerAngleDeg = 20f;
        public float SteerSpeedFactor = 0.45f;

        /// <summary>
        /// The aerodynamic floor, below the centre of mass (m).
        /// Deliberately not the collision box — see the note on the box
        /// below, and the web version's `floorY`.
        /// </summary>
        public float FloorY = -0.24f;

        [Header("Which layers count as road")]
        public LayerMask GroundMask = ~0;

        // The model, shared with the tests and with the web version.
        private readonly TireParams _tire = new TireParams();
        private readonly TireThermalParams _thermal = new TireThermalParams();
        private readonly AeroParams _aero = new AeroParams();
        private readonly SuspensionParams _suspension = new SuspensionParams();
        private readonly Drivetrain _drivetrain = new Drivetrain();

        /* What the aids are holding between ticks. */
        private readonly AssistState _assist = new AssistState();
        private readonly TractionControlParams _traction = new TractionControlParams();
        private readonly YawAssistParams _yaw = new YawAssistParams();

        private Rigidbody _body;

        /* Reused so four casts a tick allocate nothing. Eight is more than a
           wheel can plausibly see through — the car's own box, the road, and
           room to spare. RaycastNonAlloc stops at the buffer's length rather
           than growing it, so this being too small would silently drop the
           furthest hits; it is never the nearest ones that are lost, and the
           nearest is what this wants. */
        private readonly RaycastHit[] _hits = new RaycastHit[8];
        private readonly Wheel[] _wheels = new Wheel[4];

        private double _rideHeightFront = 0.05;
        private double _rideHeightRear = 0.05;

        /// <summary>Driver input for this step, written by whatever is driving.</summary>
        public Controls Controls;

        /// <summary>
        /// Whether traction control is doing anything.
        /// </summary>
        /// <remarks>
        /// On, and the default matters. Measured on the practice oval:
        /// thirteen kilometres an hour after forty-seven seconds of full
        /// throttle, slip ratio pinned at its ceiling the whole way. The
        /// arithmetic says the same thing. First gear times the final drive
        /// is 18.19, so 610 N m of engine torque at 95% efficiency is
        /// 10,541 N m at the wheel and 29,281 N of tractive force — against
        /// a rear axle carrying 4,306 N at a friction coefficient of 1.79,
        /// which is 7,708 N of grip. The engine can ask for 3.8 times what
        /// the tyres can take, so the rears light up and stay lit.
        ///
        /// That is not a hard car to drive, it is a car that does not go,
        /// and no amount of skill helps: holding the peak needs about a
        /// quarter throttle held steady, and a keyboard pedal has two
        /// positions.
        ///
        /// The controller was written and tested a long time ago and was
        /// simply never connected — <c>Assists</c> has had it, and a spin
        /// catch, and a steering limiter, since the port. This is the first
        /// of the three to be wired up; the other two read signed yaw, and
        /// the engine mirrors the reference's forward axis, so they need
        /// their signs settled before they can be trusted.
        /// </remarks>
        public bool TractionControl = true;

        /// <summary>The ceiling traction control is currently holding.</summary>
        public double ThrottleLimit => _assist.ThrottleLimit;

        /// <summary>
        /// The circuit, for the surface under each wheel. Null is allowed —
        /// see <see cref="SurfaceGripAt"/>.
        /// </summary>
        public TrackBuilder Track;

        /// <summary>Read-only view for the camera, the HUD and the sound.</summary>
        public double SpeedMs { get; private set; }
        public double EngineRpm => _drivetrain.Rpm;
        public int Gear => _drivetrain.Gear;
        public double Downforce { get; private set; }

        /// <summary>What one tyre is doing, for whatever wants to hear it.</summary>
        /// <remarks>
        /// A copy of four numbers rather than the wheel itself. `Wheel` is
        /// private because it is the integrator's own state — omega,
        /// compression, relaxation, the spline hint — and handing that out
        /// would let anything reach in and change what the car is doing next
        /// tick. These four are outputs.
        /// </remarks>
        public struct TyreSound
        {
            public double SlipAngle;
            public double SlipRatio;

            /// <summary>Grip multiplier of the surface under this wheel; one is clean tarmac.</summary>
            public double SurfaceGrip;

            /// <summary>Vertical load through the contact patch (N).</summary>
            public double Load;
        }

        /// <summary>Where one wheel is and which way it is pointing.</summary>
        public struct WheelPose
        {
            /// <summary>Rotation about the axle (rad).</summary>
            public double Spin;

            /// <summary>Steer angle (rad); zero on the rear pair.</summary>
            public double Steer;

            /// <summary>Suspension compression, zero fully extended (m).</summary>
            public double Compression;

            public bool Grounded;
        }

        /// <summary>Where the wheel at <paramref name="index"/> is.</summary>
        public WheelPose Pose(int index)
        {
            Wheel w = _wheels[Mathf.Clamp(index, 0, 3)];
            if (w == null) return default;

            return new WheelPose
            {
                Spin = w.Spin,
                Steer = w.SteerAngle,
                Compression = w.Compression,
                Grounded = w.Grounded
            };
        }

        /// <summary>How many wheels are touching anything.</summary>
        public int GroundedWheels
        {
            get
            {
                var n = 0;
                for (var i = 0; i < 4; i++)
                {
                    if (_wheels[i] != null && _wheels[i].Grounded) n++;
                }

                return n;
            }
        }

        /// <summary>How far the front-left ray reached, or −1 for nothing (m).</summary>
        public double RayDistance { get; private set; } = -1;

        /// <summary>How square that hit was to the suspension axis, −1 for nothing.</summary>
        public double RayFacing { get; private set; } = -1;

        /// <summary>Total vertical load through all four contact patches (N).</summary>
        public double TotalLoad
        {
            get
            {
                double sum = 0;
                for (var i = 0; i < 4; i++)
                {
                    if (_wheels[i] != null) sum += _wheels[i].Load;
                }

                return sum;
            }
        }

        /// <summary>
        /// How far above the road this car's origin belongs (m).
        /// </summary>
        /// <remarks>
        /// Derived, because guessing it put the car outside its own
        /// suspension. The spawn used a round half metre; the ray that looks
        /// for the ground is only <c>RestLength + WheelRadius + MaxTravel</c>
        /// = 0.56 m long and starts at the hardpoint, 0.16 m up — so it
        /// reached 0.40 m below the origin and the road was 0.50 m below it.
        /// Four wheels reported no ground, on every tick, for ever. And an
        /// ungrounded wheel is skipped entirely, so the drive torque never
        /// reached the tyres either: full throttle, engine on its idle stop,
        /// nought km/h, nothing in any log.
        ///
        /// This puts the wheels exactly on the road with the springs fully
        /// extended, which is the state a car dropped from rest settles out
        /// of — well inside the ray, with the whole of the travel to spare.
        /// </remarks>
        public float SpawnHeight => (float)(_suspension.RestLength + WheelRadius) - HardpointY;

        /// <summary>
        /// Where wheel <paramref name="index"/>'s hub sits when the spring is
        /// neither compressed nor extended, in body space.
        /// </summary>
        /// <remarks>
        /// Exists so that the view cannot disagree with the simulation about
        /// where a wheel is, which it did: the hubs were drawn at a hand
        /// written −0.16 while the physics hung them from a hardpoint at
        /// +0.16 by a 0.12 spring, putting every wheel a fifth of a metre
        /// into the road. Two places holding the same number is how that
        /// happens, so now there is one, and it is this one — the number the
        /// raycast actually uses.
        /// </remarks>
        public Vector3 HubRest(int index)
        {
            int i = Mathf.Clamp(index, 0, 3);
            float x = (i == FL || i == RL) ? -1f : 1f;
            float half = (i == FL || i == FR) ? TrackFront : TrackRear;
            float z = (i == FL || i == FR)
                ? Wheelbase * (1f - FrontWeightBias)
                : -Wheelbase * FrontWeightBias;

            return new Vector3(
                x * half / 2f,
                HardpointY - (float)_suspension.RestLength,
                z);
        }

        /// <summary>Largest driven-wheel slip ratio, for the diagnostic line.</summary>
        public double DrivenSlip =>
            _wheels[RL] == null ? 0 : System.Math.Max(
                System.Math.Abs(_wheels[RL].SlipRatio), System.Math.Abs(_wheels[RR].SlipRatio));

        /// <summary>What the tyre at <paramref name="index"/> is doing.</summary>
        public TyreSound Tyre(int index)
        {
            Wheel w = _wheels[Mathf.Clamp(index, 0, 3)];
            if (w == null) return default;

            return new TyreSound
            {
                SlipAngle = w.SlipAngle,
                SlipRatio = w.SlipRatio,
                SurfaceGrip = w.SurfaceGrip,
                Load = w.Load
            };
        }

        private sealed class Wheel
        {
            public Vector3 Hardpoint;
            public bool Steered;
            public bool Driven;
            public bool Front;
            public double Omega;

            /// <summary>Total rotation since the car was built (rad).</summary>
            /// <remarks>
            /// Accumulated rather than derived, because the only thing that
            /// wants it is a renderer and a renderer needs an angle, not a
            /// rate. Kept here rather than in the view so it advances with
            /// the physics step and not with the frame rate — at 30 fps a
            /// view integrating its own would show a wheel turning at half
            /// speed.
            /// </remarks>
            public double Spin;

            public double Compression;
            public double LastCompression;
            public double SteerAngle;
            public double RelaxedSlipAngle;
            public bool Grounded;
            public double Load;
            public double SlipRatio;
            public double SlipAngle;
            public double SurfaceGrip = 1.0;
            public TireCondition Condition;
            public Vector3 ContactPoint;

            /// <summary>
            /// Where this wheel was on the centreline last tick.
            /// </summary>
            /// <remarks>
            /// Per wheel rather than per car, and deliberately: at a hairpin
            /// the inside and outside wheels are metres apart along the lap,
            /// and it is exactly there that one is on the kerb while the
            /// other is not.
            /// </remarks>
            public double SplineHint;
        }

        private void Awake()
        {
            _body = GetComponent<Rigidbody>();
            _body.mass = Mass;
            _body.linearDamping = 0f;
            _body.angularDamping = 0.08f;
            _body.inertiaTensor = Inertia;
            _body.inertiaTensorRotation = Quaternion.identity;
            _body.interpolation = RigidbodyInterpolation.Interpolate;
            _body.collisionDetectionMode = CollisionDetectionMode.ContinuousDynamic;
            _body.automaticInertiaTensor = false;
            _body.automaticCenterOfMass = false;
            _body.centerOfMass = Vector3.zero;

            /* Front axle sits ahead of the CG by the distance the weight
               bias implies: more weight on the front means the CG is
               closer to it. Forward is +Z in Unity, where the web version
               used -Z, so the signs are mirrored here and nowhere else. */
            float front = Wheelbase * (1f - FrontWeightBias);
            float rear = -Wheelbase * FrontWeightBias;

            _wheels[FL] = Make(-TrackFront / 2f, front, true, false, true);
            _wheels[FR] = Make(TrackFront / 2f, front, true, false, true);
            _wheels[RL] = Make(-TrackRear / 2f, rear, false, true, false);
            _wheels[RR] = Make(TrackRear / 2f, rear, false, true, false);
        }

        private Wheel Make(float x, float z, bool steered, bool driven, bool isFront) =>
            new Wheel
            {
                Hardpoint = new Vector3(x, HardpointY, z),
                Steered = steered,
                Driven = driven,
                Front = isFront,
                Condition = TireThermal.Fresh(_thermal)
            };

        /// <summary>Put the car back on the road, upright and stopped.</summary>
        public void Reset(Vector3 position, float headingDeg)
        {
            transform.SetPositionAndRotation(position, Quaternion.Euler(0f, headingDeg, 0f));
            _body.linearVelocity = Vector3.zero;
            _body.angularVelocity = Vector3.zero;
            _drivetrain.Reset();
            foreach (Wheel w in _wheels)
            {
                w.Omega = 0;
                w.Compression = 0;
                w.LastCompression = 0;
                w.RelaxedSlipAngle = 0;
            }
        }


        /// <summary>
        /// The nearest thing under a wheel that is not this car.
        /// </summary>
        /// <remarks>
        /// A plain <c>Physics.Raycast</c> returns the closest hit of any
        /// kind, and the closest thing under a hardpoint is the car's own
        /// collision box. The hardpoints sit at y = 0.16 and the box reaches
        /// 0.14, so every ray hit two centimetres of car before it had left
        /// the car — which reads as the ground being two centimetres away,
        /// on all four corners, on the very first tick.
        ///
        /// The result was a stationary car firing itself off the grid and
        /// tumbling down the road, with no error anywhere: the suspension was
        /// working perfectly on the numbers it was given. It cost a WebGL
        /// build and a screenshot to see, because nothing about it is visible
        /// in a test that does not have a rigid body in a world.
        ///
        /// Layers would be the usual answer and are not available here — a
        /// named layer lives in <c>ProjectSettings/TagManager.asset</c>, and
        /// this project keeps no generated settings files. Sorting the hits
        /// costs nothing at four wheels and needs no project-wide state.
        /// </remarks>
        /// <summary>
        /// How far the ground actually is, and what it is.
        /// </summary>
        /// <remarks>
        /// The suspension ray is deliberately short — it only wants ground
        /// the spring can reach — so when it comes back empty it cannot say
        /// whether the road is a centimetre out of reach or two hundred
        /// metres above. That distinction is the whole diagnosis, and
        /// guessing at it from a screenshot has now cost two build cycles.
        /// So this casts the same ray two hundred metres, both ways, and
        /// records what it found. It runs once a tick for one wheel and only
        /// exists to be read on the F3 line.
        /// </remarks>
        private void Probe(Vector3 origin)
        {
            ProbeDown = -1;
            ProbeUp = -1;
            ProbeHit = "-";

            if (CastToGround(origin, Vector3.down, 200f, out RaycastHit below))
            {
                ProbeDown = below.distance;
                ProbeHit = below.collider.name;
            }

            if (CastToGround(origin, Vector3.up, 200f, out RaycastHit above))
            {
                ProbeUp = above.distance;
                if (ProbeDown < 0) ProbeHit = above.collider.name;
            }
        }

        /// <summary>Metres to the nearest surface straight down, or −1.</summary>
        public double ProbeDown { get; private set; } = -1;

        /// <summary>Metres to the nearest surface straight up, or −1.</summary>
        public double ProbeUp { get; private set; } = -1;

        /// <summary>What the probe found.</summary>
        public string ProbeHit { get; private set; } = "-";

        private bool CastToGround(Vector3 origin, Vector3 direction, float distance, out RaycastHit hit)
        {
            hit = default;

            int found = Physics.RaycastNonAlloc(
                origin, direction, _hits, distance, GroundMask, QueryTriggerInteraction.Ignore);

            var nearest = float.PositiveInfinity;
            var any = false;

            for (int i = 0; i < found; i++)
            {
                /* Ours, whether it is the chassis box or anything else ever
                   attached to the same body. Comparing rigidbodies rather
                   than colliders means a second collider added later cannot
                   quietly reintroduce this. */
                if (_hits[i].collider.attachedRigidbody == _body) continue;

                if (_hits[i].distance >= nearest) continue;

                nearest = _hits[i].distance;
                hit = _hits[i];
                any = true;
            }

            return any;
        }

        private void FixedUpdate()
        {
            double dt = Time.fixedDeltaTime;
            Vector3 up = transform.up;
            Vector3 forward = transform.forward;
            Vector3 velocity = _body.linearVelocity;

            double speedAlongForward = Vector3.Dot(velocity, forward);
            SpeedMs = speedAlongForward;

            // --- aerodynamics -----------------------------------------
            AeroMode mode = Controls.StraightMode ? AeroMode.Straight : AeroMode.Corner;
            AeroForces air = Aero.Solve(
                _aero, System.Math.Abs(speedAlongForward), mode,
                _rideHeightFront, _rideHeightRear);
            Downforce = air.Downforce;

            float frontZ = Wheelbase * (1f - FrontWeightBias);
            float rearZ = -Wheelbase * FrontWeightBias;
            _body.AddForceAtPosition(-up * (float)air.DownforceFront,
                transform.TransformPoint(new Vector3(0f, 0f, frontZ)));
            _body.AddForceAtPosition(-up * (float)air.DownforceRear,
                transform.TransformPoint(new Vector3(0f, 0f, rearZ)));

            float speedMag = velocity.magnitude;
            if (speedMag > 0.1f)
            {
                _body.AddForce(velocity * (float)(-air.Drag / speedMag));
            }

            // --- steering, with lock reduced as speed rises ------------
            double kmh = System.Math.Abs(speedAlongForward) * MathUtil.Kmh;
            double lockScale = 1.0 - (1.0 - SteerSpeedFactor) * MathUtil.Clamp(kmh / 300.0, 0, 1);
            double steerAngle = Controls.Steer * MaxSteerAngleDeg * MathUtil.Rad * lockScale;

            // --- suspension: cast every ray before applying anything ---
            double maxRay = _suspension.RestLength + WheelRadius + _suspension.MaxTravel;

            foreach (Wheel w in _wheels)
            {
                w.SteerAngle = w.Steered ? steerAngle : 0.0;
                Vector3 origin = transform.TransformPoint(w.Hardpoint);
                w.LastCompression = w.Compression;

                bool found = CastToGround(origin, -up, (float)maxRay, out RaycastHit hit);

                if (w == _wheels[FL])
                {
                    RayDistance = found ? hit.distance : -1;
                    RayFacing = found ? Vector3.Dot(hit.normal, up) : -1;
                    Probe(origin);
                }

                if (found)
                {
                    /* Ground the wheel could stand on, or a wall it has
                       been pushed against? A car turned onto its side
                       aims the ray along the road rather than at it, and
                       a spring pushing off a wall is a catapult — four
                       corners at the ceiling is forty g. Eighty degrees
                       off the suspension axis carries nothing. */
                    if (Vector3.Dot(hit.normal, up) < GroundFacing)
                    {
                        w.Grounded = false;
                        w.Compression = -_suspension.MaxTravel;
                        continue;
                    }

                    w.Grounded = true;
                    w.ContactPoint = hit.point;
                    w.Compression = _suspension.RestLength - (hit.distance - WheelRadius);
                    w.SurfaceGrip = SurfaceGripAt(hit, w);
                }
                else
                {
                    w.Grounded = false;
                    w.Compression = -_suspension.MaxTravel;
                }
            }

            // Floor height at each axle, for ground effect.
            double floorOffset = FloorY - HardpointY;
            _rideHeightFront = System.Math.Max(0,
                (FloorHeight(_wheels[FL], floorOffset) + FloorHeight(_wheels[FR], floorOffset)) / 2);
            _rideHeightRear = System.Math.Max(0,
                (FloorHeight(_wheels[RL], floorOffset) + FloorHeight(_wheels[RR], floorOffset)) / 2);

            double arbFront = Suspension.AntiRoll(
                _suspension.AntiRollFront, _wheels[FL].Compression, _wheels[FR].Compression);
            double arbRear = Suspension.AntiRoll(
                _suspension.AntiRollRear, _wheels[RL].Compression, _wheels[RR].Compression);

            // --- driver aids ------------------------------------------
            /* Read from the slip the *last* step measured, because this
               step's is a consequence of the throttle being decided here.
               That is one tick of lag on a controller running at 120 Hz. */
            double throttle = Controls.Throttle;

            if (TractionControl)
            {
                Vector3 local = transform.InverseTransformDirection(velocity);
                double sideslip = System.Math.Atan2(local.x, local.z);

                /* Below walking pace it does nothing and forgets what it was
                   holding. Without that, a car stopped on the grass walks its
                   own ceiling to the floor and can never pull away — the
                   ceiling decays faster than it restores on a low-grip
                   surface, and the car is stuck there for good. */
                if (System.Math.Abs(speedAlongForward) < 3.0)
                {
                    _assist.Reset();
                }
                else
                {
                    throttle = Assists.TractionControl(
                        throttle, DrivenSlip, _assist, dt, _traction,
                        sliding: System.Math.Abs(sideslip) > _yaw.Deadband);
                }
            }

            // --- drivetrain -------------------------------------------
            DriveTorques drive = _drivetrain.Step(
                throttle, Controls.ShiftUp, Controls.ShiftDown, Controls.Overtake,
                _wheels[RL].Omega, _wheels[RR].Omega, dt);
            _drivetrain.BrakeTorques(Controls.Brake, out double brakeFront, out double brakeRear);

            // --- per wheel --------------------------------------------
            for (int i = 0; i < 4; i++)
            {
                Wheel w = _wheels[i];
                if (!w.Grounded)
                {
                    w.Load = 0;

                    /* Still driven, and still braked. A wheel in the air has
                       nothing to push against but it does have a shaft
                       turning it, and a real one spins up — which is what
                       keeps the engine off its idle stop over a kerb, and
                       what makes landing on a spinning tyre behave the way it
                       should. Skipping this left the drivetrain reading zero
                       wheel speed whenever a wheel was light, and reading it
                       for ever when the ray never found the road at all. */
                    double freeTorque = w.Driven ? (i == RL ? drive.Left : drive.Right) : 0.0;
                    double freeBrake = w.Front ? brakeFront : brakeRear;
                    w.Omega += (freeTorque - System.Math.Sign(w.Omega) * freeBrake)
                        / WheelInertia * dt;
                    w.Spin += w.Omega * dt;
                    w.SlipRatio = 0;

                    // An airborne tyre still cools in the airstream.
                    TireThermal.Step(_thermal, w.Condition, 0, speedMag, dt, false);
                    continue;
                }

                double compressionVelocity = (w.Compression - w.LastCompression) / dt;
                double stiffness = w.Front ? _suspension.StiffnessFront : _suspension.StiffnessRear;
                double damping = w.Front ? _suspension.DampingFront : _suspension.DampingRear;

                double load = Suspension.Force(
                    stiffness, damping, w.Compression, compressionVelocity, _suspension.MaxTravel);
                double arb = w.Front ? arbFront : arbRear;
                load += (i == FL || i == RL) ? arb : -arb;
                load = System.Math.Max(0, load);
                w.Load = load;

                _body.AddForceAtPosition(up * (float)load, w.ContactPoint);

                // Contact patch kinematics.
                Vector3 patch = _body.GetPointVelocity(w.ContactPoint);
                Vector3 local = transform.InverseTransformDirection(patch);
                double cos = System.Math.Cos(w.SteerAngle);
                double sin = System.Math.Sin(w.SteerAngle);
                double vLong = local.z * cos + local.x * sin;
                double vLat = local.x * cos - local.z * sin;

                double denom = System.Math.Max(System.Math.Abs(vLong), SlipSpeedFloor);
                double geometric = System.Math.Atan2(vLat, denom);

                /* Relaxation: the carcass takes about half a metre of
                   rolling to build its cornering force, so the effective
                   slip angle chases the geometric one at a rate set by
                   distance travelled rather than by time. */
                double relax = MathUtil.Clamp(
                    (System.Math.Abs(vLong) * dt) / RelaxationLength, 0, 1);
                w.RelaxedSlipAngle += (geometric - w.RelaxedSlipAngle) * relax;
                w.SlipAngle = w.RelaxedSlipAngle;

                double gripScale = w.SurfaceGrip
                    * TireThermal.ConditionGrip(_thermal, w.Condition);

                // Wheel spin, sub-stepped: a wheel carries very little
                // inertia against thousands of newton-metres, so at the
                // outer step the slip ratio can jump clean past the grip
                // peak and run away into permanent wheelspin.
                const int sub = 8;
                double subDt = dt / sub;
                double sumLong = 0, sumLat = 0;

                for (int s = 0; s < sub; s++)
                {
                    double rolling = w.Omega * WheelRadius;
                    double slipRatio = (rolling - vLong)
                        / System.Math.Max(System.Math.Abs(vLong), SlipSpeedFloor);
                    slipRatio = MathUtil.Clamp(slipRatio, -4, 4);

                    TireForces f = Tire.Solve(_tire, slipRatio, w.SlipAngle, load, gripScale);
                    sumLong += f.Long;
                    sumLat += f.Lat;

                    double torque = w.Driven ? (i == RL ? drive.Left : drive.Right) : 0.0;
                    double brake = w.Front ? brakeFront : brakeRear;
                    double applied = torque
                        - System.Math.Sign(w.Omega) * brake
                        - f.Long * WheelRadius;
                    w.Omega += (applied / WheelInertia) * subDt;
                    w.SlipRatio = slipRatio;
                }

                w.Spin += w.Omega * dt;

                double fLong = sumLong / sub;
                double fLat = sumLat / sub;

                Vector3 wheelForward = transform.TransformDirection(
                    new Vector3((float)sin, 0f, (float)cos));
                Vector3 wheelRight = transform.TransformDirection(
                    new Vector3((float)cos, 0f, (float)-sin));

                _body.AddForceAtPosition(
                    wheelForward * (float)fLong + wheelRight * (float)fLat, w.ContactPoint);

                // Heat and wear from what the patch is actually sliding.
                double slideSpeed = MathUtil.Hypot(
                    vLat, (w.Omega * WheelRadius) - vLong);
                double frictionPower = System.Math.Abs(
                    MathUtil.Hypot(fLong, fLat) * slideSpeed);
                TireThermal.Step(_thermal, w.Condition, frictionPower, speedMag, dt, true);
            }
        }

        private double FloorHeight(Wheel w, double floorOffset)
            => WheelRadius + (_suspension.RestLength - w.Compression) + floorOffset;

        /// <summary>
        /// Grip under a wheel.
        /// </summary>
        /// <remarks>
        /// Read from the circuit's own lateral profile, by projecting the
        /// contact point onto the centreline — which is how the web version
        /// does it, and the only thing that can work here: tarmac, kerb,
        /// run-off and grass are one mesh on purpose, so there is no
        /// per-collider answer to give.
        ///
        /// The fallback is for anything that is not the circuit — the ground
        /// plane, a kerb prop, whatever gets added later. It is not dead
        /// code; it is what a wheel standing on something the circuit has
        /// never heard of grips like.
        /// </remarks>
        private double SurfaceGripAt(RaycastHit hit, Wheel w)
        {
            if (Track != null)
            {
                return Track.GripAt(hit.point, ref w.SplineHint);
            }

            var surface = hit.collider.GetComponent<SurfaceGrip>();
            return surface != null ? surface.Grip : 1.0;
        }

        /// <summary>Cosine of eighty degrees — see the note in the ray loop.</summary>
        private const double GroundFacing = 0.17;

        /// <summary>Below this speed slip is ill-conditioned.</summary>
        private const double SlipSpeedFloor = 3.0;

        /// <summary>Tyre relaxation length (m).</summary>
        private const double RelaxationLength = 0.5;
    }

    /// <summary>Normalised driver input for one step.</summary>
    public struct Controls
    {
        public double Throttle;
        public double Brake;
        public double Steer;
        public bool ShiftUp;
        public bool ShiftDown;
        public bool StraightMode;
        public bool Overtake;
    }

    /// <summary>Marks a collider as a surface with a grip multiplier.</summary>
    public class SurfaceGrip : MonoBehaviour
    {
        public double Grip = 1.0;
    }
}
