using System;
using UnityEngine;

namespace MumuF1.Game
{
    /// <summary>
    /// The thing that makes it a race rather than a car on a road.
    /// </summary>
    /// <remarks>
    /// Everything it owns comes from <c>MumuF1.Core</c> and is tested there
    /// without an editor: the lap timer, the session rules, the racing line
    /// and its speed profile, the field of rivals, the ghost. This file does
    /// three things and none of them are decisions — it projects the car onto
    /// the circuit, ticks those objects in the right order, and hands the
    /// answers to whatever is drawing.
    ///
    /// The projection is the part worth reading. Everything downstream indexes
    /// by <c>(s, t)</c> — distance along the centreline and offset from it —
    /// so the whole of timing, track limits, the rivals' positions and the
    /// ghost delta come from one <see cref="CenterlineSpline.Project"/> call a
    /// tick. No trigger volumes anywhere on the circuit, no sector colliders,
    /// no start-line box. That is why the core half needed no Unity to be
    /// written and needs none to be checked.
    /// </remarks>
    [RequireComponent(typeof(CarController))]
    public class RaceDirector : MonoBehaviour
    {
        /// <summary>What kind of session to run. Set before the scene loads.</summary>
        public static SessionKind Kind = SessionKind.TimeTrial;

        public TrackBuilder Track;

        public LapTimer Timer { get; private set; }
        public Session Session { get; private set; }
        public Field Field { get; private set; }
        public RacingLine Line { get; private set; }
        public SpeedProfile Profile { get; private set; }

        /// <summary>Where the car is on the circuit: metres along the centreline.</summary>
        public double Distance { get; private set; }

        /// <summary>And its offset from it (m), positive to the left.</summary>
        public double Lateral { get; private set; }

        public bool OnTrack { get; private set; } = true;

        /// <summary>Where the player sits in the field, one-based.</summary>
        public int Position { get; private set; } = 1;

        /// <summary>Metres to the car ahead, or null when leading.</summary>
        public double? GapAhead { get; private set; }

        /// <summary>
        /// Seconds up or down on the ghost at this point on the circuit.
        /// </summary>
        /// <remarks>
        /// Null when there is no ghost, or before it reached here. That last
        /// one is deliberate: a delta against a point the ghost never got to
        /// is not a delta, and clamping it would read as exactly zero in the
        /// place a driver is looking hardest.
        /// </remarks>
        public double? GhostDelta { get; private set; }

        /// <summary>The lap the ghost is driving, if there is one.</summary>
        public GhostLap Ghost { get; private set; }

        /// <summary>Where it is right now, for the renderer.</summary>
        public GhostFrame GhostNow { get; private set; }

        /// <summary>Set for one tick when a lap is completed.</summary>
        public CompletedLap JustFinished { get; private set; }

        /// <summary>True once this session's best beat the stored one.</summary>
        public bool BeatTheRecord { get; private set; }

        private CarController _car;
        private GhostRecorder _recorder;
        private PlayerPrefsStore _store;
        private Championship _season;

        /// <summary>Last tick's answer, which turns a whole-lap scan into a local one.</summary>
        private double _hint;

        private void Awake()
        {
            _car = GetComponent<CarController>();
            _store = new PlayerPrefsStore();
            _season = new Championship(_store);
            _recorder = new GhostRecorder();
        }

        /// <summary>
        /// Build everything that depends on the circuit.
        /// </summary>
        /// <remarks>
        /// Separate from <c>Awake</c> because the track has to exist first, and
        /// the racing line takes six hundred relaxation passes over it — which
        /// is a fraction of a second and much too long to be doing twice.
        /// </remarks>
        public void Begin(TrackBuilder track)
        {
            Track = track;

            Line = new RacingLine(track.Circuit);
            Profile = new SpeedProfile(Line);
            Timer = new LapTimer(track.Circuit);
            Session = new Session(MumuF1.Session.Preset(Kind));

            /* A time trial races a ghost and nothing else; the other kinds put
               a field on the road. Building one in a time trial would be nine
               cars driving a lap nobody is scored against. */
            if (Kind != SessionKind.TimeTrial)
            {
                Field = new Field(Line, Profile, track.Circuit.Length);
            }

            Ghost = _store.Load(TrackBuilder.CircuitId);

            /* Deliberately not begun here. `TitleCard` calls it, because
               nothing should run while the card is up — not the clock, not
               the lights, not track limits. The session having begun and the
               lights having gone out are two different facts, and folding
               the first into construction is exactly the bug the web version
               had: the countdown ran behind the card and the race started
               without the player. */
        }

        private void FixedUpdate()
        {
            if (Session == null) return;

            double dt = Time.fixedDeltaTime;

            // --- where the car is on the circuit -------------------------
            Vector3 p = transform.position;
            Projection where =
                Track.Circuit.Spline.Project(new Vec3(p.x, p.y, p.z), _hint);

            _hint = where.S;
            Distance = where.S;
            Lateral = where.T;
            OnTrack = Track.Circuit.IsOnTrack(where.S, where.T);

            /* Nothing is timed until the session has been let go, and that
               includes the lap clock. `Session.Update` has guarded itself
               against running behind the title card since it was written —
               its comment says so, "not the lights, not the clock, not track
               limits" — but the lap timer is ticked here, a line above it,
               and was never covered by that guard. So the clock ran from the
               moment the world loaded and a first lap carried however long
               anybody had spent looking at the menu. The run that found it
               read a lap time of sixteen seconds on a stationary car with the
               starting lights still counting down.

               Where the car is stays live above, because the camera and the
               read-out want it while the card is up. */
            if (!Session.Started) return;

            // --- timing ---------------------------------------------------
            JustFinished = Timer.Update(where.S, OnTrack, dt);
            Session.Update(dt, OnTrack, JustFinished, Timer);

            // --- the ghost -------------------------------------------------
            TickGhost(dt);

            // --- the rest of the grid ---------------------------------------
            if (Field != null)
            {
                Field.Update(dt, Session.Elapsed, Session.Config.Laps, Session.OnGrid);
                Position = Field.PositionOf(Timer.Lap, where.S, null);
                GapAhead = Field.GapAhead(Timer.Lap, where.S);
            }

            if (JustFinished != null) BankTheLap(JustFinished);
        }

        private void TickGhost(double dt)
        {
            /* Recorded against the lap clock rather than a tick counter, so a
               sample lands at a known second whatever the frame rate did. */
            _recorder.Record(Timer.LapTime, new GhostSample
            {
                X = transform.position.x,
                Y = transform.position.y,
                Z = transform.position.z,
                Heading = transform.eulerAngles.y * Mathf.Deg2Rad,
                Distance = (float)Distance
            });

            if (Ghost == null)
            {
                GhostDelta = null;
                return;
            }

            GhostNow = MumuF1.Ghost.Sample(Ghost, Timer.LapTime);

            /* Compared at the same *point*, never at the same instant. Two
               cars at the same moment are in different places, so an instant
               comparison answers a question nobody asked. */
            double? was = MumuF1.Ghost.TimeAtDistance(Ghost, Distance);
            GhostDelta = was == null ? (double?)null : Timer.LapTime - was.Value;
        }

        private void BankTheLap(CompletedLap lap)
        {
            /* An invalid lap is not a lap. Recording one would put a ghost on
               the road that cuts the corner it was invalidated for, and then
               ask the player to chase it. */
            if (!lap.Valid) { _recorder.Reset(); return; }

            if (_season.RecordLap(TrackBuilder.CircuitId, lap.Time))
            {
                BeatTheRecord = true;

                GhostLap recorded = _recorder.Take(lap.Time);
                if (recorded != null)
                {
                    Ghost = recorded;
                    _store.Save(TrackBuilder.CircuitId, recorded);
                }
            }

            _recorder.Reset();
        }
    }
}
