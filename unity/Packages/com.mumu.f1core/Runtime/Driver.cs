using System;

namespace MumuF1
{
    public sealed class DriverOptions
    {
        /// <summary>Lookahead at a standstill (m).</summary>
        public double LookaheadBase { get; set; } = 6;

        /// <summary>How much it grows per m/s.</summary>
        public double LookaheadPerSpeed { get; set; } = 0.3;

        public double LookaheadMax { get; set; } = 30;

        /// <summary>Trim on the geometric steering angle; one is pure pursuit exactly.</summary>
        public double SteerGain { get; set; } = 1;

        /// <summary>How hard the car is pulled back onto the line, per metre of error.</summary>
        public double LineCorrection { get; set; } = 0.5;

        /// <summary>Seconds for the steering to reach a new position.</summary>
        public double SteerRate { get; set; } = 0.06;

        /// <summary>Fraction of the profile speed actually attempted.</summary>
        /// <remarks>
        /// Below one because the profile is what the car can do with a perfect
        /// driver, and this one is not perfect: every metre of line error and
        /// every degree of steering lag spends grip the profile assumed was
        /// available for cornering.
        /// </remarks>
        public double Pace { get; set; } = 0.75;

        /// <summary>Seconds stuck before asking to be recovered.</summary>
        public double RecoveryDelay { get; set; } = 2.5;

        /// <summary>Upshift when road speed in km/h exceeds this, times the gear.</summary>
        public double ShiftSpeedPerGear { get; set; } = 42;
    }

    /// <summary>
    /// The three chassis numbers the driver needs, mirrored as plain values.
    /// </summary>
    /// <remarks>
    /// The same discipline the steering limiter and the yaw limiter keep, and
    /// for the same reason: this assembly's driver has no business depending
    /// on the whole vehicle model to work out how much lock it has.
    ///
    /// One of these deliberately disagrees with <see cref="SteerLimiterParams"/>.
    /// The reference states the steering lock twice — <c>20 * RAD</c> in the
    /// chassis and a rounded <c>0.349</c> in the driver aids — and they differ
    /// in the sixth decimal. Both are carried across as they are, because
    /// making them agree here would quietly change what the ported car does
    /// against the one it is a port of.
    /// </remarks>
    public sealed class DriverCar
    {
        /// <summary>Axle to axle (m).</summary>
        public double Wheelbase { get; set; } = 3.6;

        /// <summary>Steering lock at a standstill (rad).</summary>
        public double MaxSteerAngle { get; set; } = 20 * MathUtil.Rad;

        /// <summary>Fraction of that lock still available at 300 km/h.</summary>
        public double SteerSpeedFactor { get; set; } = 0.45;
    }

    /// <summary>What the driver was thinking, for a telemetry overlay.</summary>
    public struct DriverDebug
    {
        /// <summary>Where on the circuit the driver thinks it is (m).</summary>
        public double Distance;

        /// <summary>Lateral error from the racing line (m).</summary>
        public double LineError;

        /// <summary>Speed the profile is asking for (m/s).</summary>
        public double TargetSpeed;

        /// <summary>Angle to the aim point (deg).</summary>
        public double AimAngle;

        public double Lookahead;
    }

    /// <summary>
    /// The AI driver, ported from <c>f1sim/src/ai/driver.ts</c>.
    /// </summary>
    /// <remarks>
    /// Reads where the car is, looks up where the racing line says it should
    /// be and how fast the profile says it should be going, and produces a
    /// <see cref="ControlState"/> — the same struct the keyboard produces.
    /// Nothing downstream can tell the difference, which is the point of
    /// having kept that boundary narrow since the beginning.
    ///
    /// Steering is pure pursuit: aim at a point on the racing line some
    /// distance ahead and turn towards it. The lookahead grows with speed,
    /// because at 300 km/h a fixed one would have the car reacting to
    /// something it is already on top of, and shrinking it in slow corners is
    /// what lets the car actually turn in.
    /// </remarks>
    public sealed class Driver
    {
        private readonly RacingLine _line;
        private readonly SpeedProfile _profile;
        private readonly DriverCar _car;

        public DriverOptions Options { get; }

        private AssistState _assist = new AssistState();
        private bool _shiftArmed = true;
        private double _steer;
        private double _stuckFor;

        /// <summary>
        /// Raised when the car has been stationary long enough that it is not
        /// coming back on its own.
        /// </summary>
        /// <remarks>
        /// The caller decides what to do. The driver has no business moving
        /// the car itself.
        /// </remarks>
        public bool NeedsRecovery { get; private set; }

        public DriverDebug Debug { get; private set; }

        public Driver(
            RacingLine line,
            SpeedProfile profile,
            DriverCar car = null,
            DriverOptions options = null)
        {
            _line = line;
            _profile = profile;
            _car = car ?? new DriverCar();
            Options = options ?? new DriverOptions();
        }

        /// <summary>Forget accumulated state, as after a respawn.</summary>
        public void Reset()
        {
            _assist = new AssistState();
            _steer = 0;
            _shiftArmed = true;
            _stuckFor = 0;
            NeedsRecovery = false;
        }

        /// <summary>Decide what to do this tick.</summary>
        /// <param name="state">the car.</param>
        /// <param name="position">where it is in the world (m).</param>
        /// <param name="rotation">which way it is pointing.</param>
        /// <param name="distance">where it is along the circuit (m).</param>
        /// <param name="lateral">its offset from the centreline (m).</param>
        /// <param name="gear">the gear engaged.</param>
        /// <param name="dt">the step (s).</param>
        /// <param name="onTrack">whether it is still on the road.</param>
        /// <remarks>
        /// Returns a copy rather than a shared buffer. The reference mutates
        /// and returns one long-lived object, which is fine in a single loop
        /// and would be a trap here — a caller that kept last tick's controls
        /// to compare against would find they had changed underneath it.
        /// </remarks>
        public ControlState Drive(
            VehicleState state,
            Vec3 position,
            Quat rotation,
            double distance,
            double lateral,
            int gear,
            double dt,
            bool onTrack = true)
        {
            DriverOptions o = Options;
            var speed = Math.Abs(state.Speed);

            /* Ask to be recovered whenever the car has been stationary for a
               while, on the road or off it. Off the road it has usually fallen
               past the end of the track mesh and has no route back; on the
               road it has spun and is sitting the wrong way round, which the
               controller cannot resolve either since it only ever steers
               towards a point ahead. Both look identical from here — the car
               is not moving and nothing it does is changing that. */
            if (speed < 2) _stuckFor += dt;
            else _stuckFor = 0;

            /* Off the road there is nothing to wait for; on it, give the car a
               moment in case it is simply coming out of a slow corner. */
            NeedsRecovery = _stuckFor > (onTrack ? o.RecoveryDelay : o.RecoveryDelay * 0.6);

            // --- where to aim -------------------------------------------
            var lookahead = Math.Min(o.LookaheadMax, o.LookaheadBase + speed * o.LookaheadPerSpeed);
            Vec3 aim = _line.PointAt(distance + lookahead);
            Vec3 local = rotation.RotateInverse(aim - position);
            var aimAngle = Math.Atan2(local.X, -local.Z);

            /* Pure pursuit proper: the steering angle that puts the car on a
               circular arc through the aim point,
             *
             *     delta = atan(2 L sin(alpha) / Ld)
             *
             * rather than a flat gain on the angle. The lookahead is in the
             * denominator, so the same geometric error asks for less lock the
             * faster the car is going. A flat gain has no such term and
             * oscillates down the straights — which is exactly what a first
             * pass here did at 300 km/h. */
            var geometric = Math.Atan2(
                2 * _car.Wheelbase * Math.Sin(aimAngle),
                Math.Max(1, lookahead));

            /* The steering rack loses lock with speed, so the same input means
               a smaller angle the faster you go; undo that to command an
               angle rather than a fraction of a shrinking range. */
            var lockScale =
                1 - (1 - _car.SteerSpeedFactor) * MathUtil.Clamp(speed * 3.6 / 300, 0, 1);
            var authority = Math.Max(1e-3, _car.MaxSteerAngle * lockScale);

            /* Aiming ahead converges on the line but can settle parallel to
               it, so the remaining offset is trimmed out directly. */
            var lineError = lateral - _line.OffsetAt(distance);
            var correction = MathUtil.Clamp(-lineError * o.LineCorrection / authority, -0.3, 0.3);

            /* Feedforward from the curvature of the line itself. Pure pursuit
               is a feedback term — it only acts once the car is already off
               the arc, so alone it enters every corner late and runs wide. The
               steady steering angle a curvature k needs is atan(L k);
               supplying that up front leaves the pursuit term to correct the
               difference rather than to discover the corner. */
            var feedforward =
                Math.Atan(_car.Wheelbase * _line.CurvatureAt(distance + lookahead * 0.5)) / authority;

            var wanted = MathUtil.Clamp(
                feedforward + geometric * o.SteerGain / authority + correction, -1, 1);
            _steer += (wanted - _steer) * MathUtil.Clamp(dt / o.SteerRate, 0, 1);

            // --- how fast ------------------------------------------------
            /* Braking has to start before the corner, so the target is the
               slowest point within stopping distance rather than the one
               here. */
            var stoppingDistance = 12 + speed * speed / (2 * 22);
            var target = _profile.Lookahead(distance, stoppingDistance) * o.Pace;

            double throttle = 0;
            double brake = 0;
            if (speed < target * 0.98)
            {
                throttle = MathUtil.Clamp((target - speed) * 0.4, 0.15, 1);
            }
            else if (speed > target * 1.02)
            {
                brake = MathUtil.Clamp((speed - target) * 0.25, 0.15, 1);
            }
            else
            {
                throttle = 0.35;
            }

            // --- gears ---------------------------------------------------
            /* Shift on road speed, not engine speed: during wheelspin the
               engine sits on the limiter while the car is barely moving, and
               an rpm-triggered shift would run through the whole gearbox at
               once. */
            var wantShift = speed * 3.6 > gear * o.ShiftSpeedPerGear;
            var shiftUp = wantShift && _shiftArmed;
            _shiftArmed = !wantShift;

            var drivenSlip = Math.Max(
                Math.Abs(state.Wheels[Wheel.Rl].SlipRatio),
                Math.Abs(state.Wheels[Wheel.Rr].SlipRatio));

            var controls = new ControlState();

            /* Traction control is what stops the car spinning its wheels off
               the line, but its throttle ceiling decays on a low-grip surface
               — so a car that has stopped in the grass can never restart,
               because every attempt spins the wheels and cuts the throttle
               further. Below walking pace it is bypassed and the ceiling
               reset. */
            if (speed < 3)
            {
                _assist.ThrottleLimit = 1;
                controls.Throttle = throttle;
            }
            else
            {
                controls.Throttle = Assists.TractionControl(throttle, drivenSlip, _assist, dt);
            }

            controls.Brake = brake;
            controls.Steer = _steer;
            controls.ShiftUp = shiftUp;
            controls.ShiftDown = false;

            /* Active aero is a judgement about the road ahead, not a reward
               for being close behind: recline the wings when there is no
               corner inside the distance it would take to react to one. */
            var straightAhead = true;
            for (double d = 0; d < 30 + speed * 2.5; d += 10)
            {
                if (Math.Abs(_line.CurvatureAt(distance + d)) > 1.0 / 400)
                {
                    straightAhead = false;
                    break;
                }
            }

            controls.StraightMode = straightAhead && speed > 30;
            controls.Overtake = false;

            Debug = new DriverDebug
            {
                Distance = distance,
                LineError = lineError,
                TargetSpeed = target,
                AimAngle = aimAngle * MathUtil.Deg,
                Lookahead = lookahead
            };

            return controls;
        }
    }
}
