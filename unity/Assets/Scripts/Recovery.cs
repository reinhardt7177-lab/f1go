using UnityEngine;

namespace MumuF1.Game
{
    /// <summary>
    /// Puts the car back on the road when it has no way back itself.
    /// </summary>
    /// <remarks>
    /// The track is a ribbon swept from a spline — tarmac, kerb, run-off,
    /// verge — and then it stops. Past the outside edge there is no ground at
    /// all, so a car that runs wide enough does not land, it falls, and goes
    /// on falling. Reset did not help: it lifted the car a metre and a half
    /// from wherever it was, which a hundred metres into the void is a
    /// hundred metres into the void.
    ///
    /// So there are two recoveries and this is both of them. Pressing R asks
    /// for one; falling for long enough gets one whether it was asked for or
    /// not, because a player who cannot see the circuit any more cannot know
    /// that a key would help.
    ///
    /// It puts the car on the racing line at the last distance the director
    /// knew about, pointing along it. Not at the start line: losing a lap
    /// for running wide is a harsher penalty than the mistake, and not where
    /// it went off either, because that is usually the outside of a corner
    /// with the barrier a metre away.
    /// </remarks>
    [RequireComponent(typeof(CarController))]
    [RequireComponent(typeof(RaceDirector))]
    public class Recovery : MonoBehaviour
    {
        /// <summary>
        /// How long the car may be off the ground before it is fetched (s).
        /// </summary>
        /// <remarks>
        /// Long enough to fly over a kerb, land off a crest, or be thrown by
        /// a wall without being interrupted — all of those are under a
        /// second — and short enough that falling out of the world is over
        /// quickly.
        /// </remarks>
        public float FallingFor = 2.0f;

        /// <summary>How long stuck and stationary before it is fetched (s).</summary>
        /// <remarks>
        /// The other way to be unable to continue: stopped, facing the wrong
        /// way, or resting on the bodywork with the wheels off the ground.
        /// From the driver's seat these are all the same thing — nothing is
        /// happening and nothing the driver does changes that.
        /// </remarks>
        public float StuckFor = 4.0f;

        private CarController _car;
        private RaceDirector _race;
        private Rigidbody _body;

        private float _airborne;
        private float _stopped;

        private void Awake()
        {
            _car = GetComponent<CarController>();
            _race = GetComponent<RaceDirector>();
            _body = GetComponent<Rigidbody>();
        }

        private void Update()
        {
            if (Input.GetKeyDown(KeyCode.R))
            {
                Rescue();
                return;
            }

            float dt = Time.deltaTime;
            bool grounded = _car.GroundedWheels > 0;

            /* Falling, rather than merely airborne. A car at the top of a
               jump is going up and is fine; one that has left the circuit is
               going down and is not coming back. */
            _airborne = !grounded && _body.linearVelocity.y < -1f ? _airborne + dt : 0f;

            /* Stopped on the road and going nowhere. Upright or not — a car
               on its roof reads exactly the same from here. */
            _stopped = grounded && _body.linearVelocity.magnitude < 1.5f
                       && Time.timeSinceLevelLoad > 5f
                ? _stopped + dt
                : 0f;

            if (_airborne > FallingFor || _stopped > StuckFor) Rescue();
        }

        /// <summary>Back onto the racing line, pointing along it.</summary>
        public void Rescue()
        {
            _airborne = 0f;
            _stopped = 0f;

            if (_race == null || _race.Line == null) return;

            double s = _race.Distance;
            Vec3 here = _race.Line.PointAt(s);
            Vec3 ahead = _race.Line.PointAt(s + 6);

            /* Unity's convention — atan2(x, z) — the same one the start
               heading, the roadside and the rivals use. */
            float heading = Mathf.Atan2(
                (float)(ahead.X - here.X), (float)(ahead.Z - here.Z)) * Mathf.Rad2Deg;

            _car.Reset(
                new Vector3((float)here.X, (float)here.Y, (float)here.Z)
                    + Vector3.up * _car.SpawnHeight,
                heading);
        }
    }
}
