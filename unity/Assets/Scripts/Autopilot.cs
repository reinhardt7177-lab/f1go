using UnityEngine;

namespace MumuF1.Game
{
    /// <summary>
    /// Drives the car round, so a lap can be watched rather than driven.
    /// </summary>
    /// <remarks>
    /// Two jobs, and the second is why it exists. It is an attract mode — the
    /// car goes round on its own while the title card is up, which is a
    /// better first impression than a stationary car — and it is the only way
    /// anything here has ever completed a lap under test. A harness can hold
    /// the throttle down; it cannot steer, because it cannot see where the
    /// car is. Cornering, braking, kerbs, sector splits and lap times were
    /// all unverified for that reason alone.
    ///
    /// It does not use <see cref="MumuF1.Driver"/>, which is the ported AI and
    /// is not wired to anything. That one aims with
    /// <c>atan2(local.X, -local.Z)</c>, the reference's forward axis, and
    /// every heading in this project is Unity's — the start heading, the
    /// roadside, the gantry, and now the rivals. Feeding it a Unity rotation
    /// steers the wrong way; reconciling it properly is its own job with its
    /// own tests. This is forty lines in the convention the engine actually
    /// uses, and it borrows the two things that carry the real knowledge:
    /// the racing line for where to go and the speed profile for how fast.
    ///
    /// Pure pursuit, which is the whole of it: aim at a point up the road and
    /// steer towards it. The lookahead grows with speed because a fixed one
    /// saws at the wheel on a straight and cuts every apex at three hundred.
    /// </remarks>
    [RequireComponent(typeof(CarController))]
    public class Autopilot : MonoBehaviour
    {
        /// <summary>Whether it is driving.</summary>
        public bool Engaged;

        /// <summary>How far up the road to aim, at a standstill (m).</summary>
        public double LookaheadBase = 14;

        /// <summary>And how much further per metre per second (s).</summary>
        public double LookaheadPerSpeed = 0.55;

        public double LookaheadMax = 70;

        /// <summary>
        /// How much of the lock a full-scale aim angle asks for.
        /// </summary>
        /// <remarks>
        /// The pursuit angle is the direction to the aim point, not a steering
        /// angle: at 20° of lock the car turns far more than 20° of aim over
        /// the lookahead distance. Dividing by the lock and easing the result
        /// keeps it from oscillating.
        /// </remarks>
        public double SteerGain = 1.6;

        /// <summary>How fast the wheel may move (per second).</summary>
        public double SteerRate = 4.0;

        private CarController _car;
        private RaceDirector _race;
        private double _steer;

        private void Awake()
        {
            _car = GetComponent<CarController>();
            _race = GetComponent<RaceDirector>();
        }

        private void Update()
        {
            if (Input.GetKeyDown(KeyCode.P)) Engaged = !Engaged;
            if (!Engaged || _race == null || _race.Line == null) return;

            double speed = System.Math.Abs(_car.SpeedMs);

            double lookahead = System.Math.Min(
                LookaheadMax, LookaheadBase + speed * LookaheadPerSpeed);

            Vec3 point = _race.Line.PointAt(_race.Distance + lookahead);
            Vector3 aim = transform.InverseTransformPoint(
                new Vector3((float)point.X, (float)point.Y, (float)point.Z));

            /* Unity's convention, and the only one in this file: x is right,
               z is forward, so the angle to the aim point is atan2(x, z). */
            double angle = System.Math.Atan2(aim.x, System.Math.Max(1.0, aim.z));

            double want = MathUtil.Clamp(
                angle / (_car.MaxSteerAngleDeg * MathUtil.Rad) * SteerGain, -1, 1);

            /* Eased rather than applied, for the same reason the human input
               is: a wheel that snaps to full lock unsettles the car more than
               the corner does. */
            double step = SteerRate * Time.deltaTime;
            _steer += MathUtil.Clamp(want - _steer, -step, step);

            /* And the pace the line is worth here, read a little up the road
               so the car brakes before the corner rather than at the apex. */
            double target = _race.Profile.Lookahead(_race.Distance, 40);

            double throttle = 0, brake = 0;
            if (speed < target - 1) throttle = MathUtil.Clamp((target - speed) / 6.0, 0, 1);
            else if (speed > target + 1) brake = MathUtil.Clamp((speed - target) / 12.0, 0, 1);

            /* Off the road, straighten up and coast back. Chasing the racing
               line from the grass steers into the barrier as often as out of
               it, and the recovery that matters is simply slowing down. */
            if (!_race.OnTrack)
            {
                throttle = System.Math.Min(throttle, 0.35);
                _steer *= 0.85;
            }

            _car.Controls = new Controls
            {
                Throttle = throttle,
                Brake = brake,
                Steer = _steer,
                ShiftUp = _car.Controls.ShiftUp,
                ShiftDown = _car.Controls.ShiftDown,
                StraightMode = _car.Controls.StraightMode,
                Overtake = _car.Controls.Overtake
            };
        }
    }
}
