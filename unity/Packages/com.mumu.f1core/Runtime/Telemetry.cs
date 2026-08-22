namespace MumuF1
{
    /// <summary>
    /// Which wheel is which. Ported from <c>f1sim/src/sim/types.ts</c>.
    /// </summary>
    /// <remarks>
    /// Plain constants rather than an enum, because every array these index
    /// is a fixed four and an enum would need a cast at each use. The order
    /// is the reference's and is load-bearing: the driven pair is the back
    /// two, and code that reads <c>Wheels[Rl]</c> for driven slip would be
    /// reading a front tyre if this were rearranged.
    /// </remarks>
    public static class Wheel
    {
        public const int Fl = 0;
        public const int Fr = 1;
        public const int Rl = 2;
        public const int Rr = 3;

        /// <summary>How many there are, so loops do not say 4.</summary>
        public const int Count = 4;
    }

    /// <summary>
    /// Normalised driver inputs. Everything upstream of the sim makes one.
    /// </summary>
    /// <remarks>
    /// A struct rather than a class, and that is the point: the reference
    /// spreads these (<c>{ ...desired, throttle }</c>) all through the driver
    /// aids, relying on each step getting a fresh copy rather than mutating
    /// what the caller passed. A C# class would alias, and an aid that
    /// rewrote the pedals would silently rewrite the caller's controls too.
    /// A struct copies on assignment, which is the same contract.
    /// </remarks>
    public struct ControlState
    {
        /// <summary>Zero to one.</summary>
        public double Throttle;

        /// <summary>Zero to one.</summary>
        public double Brake;

        /// <summary>Minus one (full left) to one (full right).</summary>
        public double Steer;

        /// <summary>Gear change asked for this tick, consumed by the drivetrain.</summary>
        public bool ShiftUp;

        public bool ShiftDown;

        /// <summary>
        /// Reclines the wings for a straight.
        /// </summary>
        /// <remarks>
        /// Under the 2026 rules this is not an overtaking aid and carries no
        /// proximity condition — every car may use it whenever the driver
        /// judges it safe, and paying for it in downforce is the whole
        /// decision.
        /// </remarks>
        public bool StraightMode;

        /// <summary>
        /// Overtake Mode: extra electrical energy, allowed within a second of
        /// the car ahead. This is what replaced DRS as the overtaking aid — a
        /// power boost rather than a drag reduction.
        /// </summary>
        public bool Overtake;

        /// <summary>Hands off everything.</summary>
        public static ControlState Neutral => default;
    }

    /// <summary>
    /// Per-wheel telemetry — the numbers you actually tune against.
    /// </summary>
    public struct WheelTelemetry
    {
        /// <summary>Vertical load through the contact patch (N).</summary>
        public double Load;

        /// <summary>Suspension compression; zero is fully extended (m).</summary>
        public double Compression;

        /// <summary>Slip angle (rad) — lateral velocity against heading at the patch.</summary>
        public double SlipAngle;

        /// <summary>Slip ratio — longitudinal. Zero rolling, positive driving, negative braking.</summary>
        public double SlipRatio;

        /// <summary>Tyre force along the wheel's own axis (N).</summary>
        public double ForceLong;

        /// <summary>Tyre force across it (N).</summary>
        public double ForceLat;

        /// <summary>How much of the available grip is in use, zero to one and beyond.</summary>
        public double GripUsage;

        /// <summary>Wheel spin rate (rad/s).</summary>
        public double Omega;

        public bool Grounded;

        /// <summary>Tread temperature (°C) — sets grip right now.</summary>
        public double SurfaceTemp;

        /// <summary>Carcass temperature (°C) — what the tread relaxes towards.</summary>
        public double CoreTemp;

        /// <summary>Zero is new, one is fully worn.</summary>
        public double Wear;

        /// <summary>Friction multiplier from surface, temperature and wear together.</summary>
        public double GripScale;

        /// <summary>Grip multiplier of the surface under this wheel alone.</summary>
        public double SurfaceGrip;

        /// <summary>
        /// A wheel in the air, at working temperature, on a clean surface.
        /// </summary>
        /// <remarks>
        /// Not <c>default</c>, because three of these fields are wrong at
        /// zero: a tyre at 0 °C is a tyre with no grip, and grip scales of
        /// zero would make the whole car frictionless on the first tick
        /// before anything had written to them.
        /// </remarks>
        public static WheelTelemetry Empty => new WheelTelemetry
        {
            SurfaceTemp = 80,
            CoreTemp = 80,
            GripScale = 1,
            SurfaceGrip = 1
        };
    }

    /// <summary>
    /// A complete snapshot of the car. The renderer only ever sees one of these.
    /// </summary>
    /// <remarks>
    /// A class rather than a struct, unlike the controls above. It is far too
    /// large to copy every time it is read, it is produced once a tick and
    /// read many times, and nothing downstream rewrites it — the aids take a
    /// state and return controls, which is the opposite direction.
    /// </remarks>
    public sealed class VehicleState
    {
        public Vec3 Position;
        public Quat Rotation = Quat.Identity;
        public Vec3 Velocity;
        public Vec3 AngularVelocity;

        /// <summary>Forward speed along the car's own axis (m/s).</summary>
        public double Speed;

        public double EngineRpm;

        /// <summary>The engaged gear. Zero is reverse.</summary>
        public int Gear;

        public readonly WheelTelemetry[] Wheels = new WheelTelemetry[Wheel.Count];

        /// <summary>Wheel steer angles (rad), for drawing the front wheels.</summary>
        public readonly double[] SteerAngles = new double[Wheel.Count];

        /// <summary>Accumulated wheel rotation (rad), for spinning the wheel meshes.</summary>
        public readonly double[] WheelSpin = new double[Wheel.Count];

        public double Downforce;
        public double Drag;

        /// <summary>Floor height above the road at the front axle (m).</summary>
        public double RideHeightFront;

        /// <summary>And at the rear (m).</summary>
        public double RideHeightRear;

        /// <summary>Downforce multiplier the floor is producing at the front.</summary>
        public double GroundEffectFront;

        /// <summary>And at the rear.</summary>
        public double GroundEffectRear;

        /// <summary>Longitudinal acceleration in g, as a driver would feel it.</summary>
        public double GLong;

        /// <summary>Lateral, likewise.</summary>
        public double GLat;

        public AeroMode AeroMode;
        public bool OvertakeDeploying;

        /// <summary>Overtake energy left in the current allocation, zero to one.</summary>
        public double OvertakeCharge;

        public VehicleState()
        {
            for (var i = 0; i < Wheel.Count; i++) Wheels[i] = WheelTelemetry.Empty;
        }

        /// <summary>
        /// The angle between where the car points and where it is going (rad).
        /// </summary>
        /// <remarks>
        /// Positive when the car is travelling to the right of its own nose.
        /// Forward is -Z, hence the sign on the z term.
        ///
        /// This is the signal the yaw assist runs on, and the reason to prefer
        /// it to a yaw-rate error is that its target is exactly zero: it needs
        /// no reference model and no invented understeer gradient.
        /// </remarks>
        public double Sideslip()
        {
            Vec3 local = Rotation.RotateInverse(Velocity);
            return System.Math.Atan2(local.X, -local.Z);
        }
    }
}
