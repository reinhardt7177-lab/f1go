using System;
using System.Collections.Generic;

namespace MumuF1
{
    public enum SessionKind
    {
        Practice,
        Qualifying,
        Race,
        TimeTrial
    }

    public enum SessionPhase
    {
        /// <summary>On the grid, held, with the lights filling.</summary>
        Formation,

        /// <summary>Running.</summary>
        Green,

        /// <summary>Time or laps are up; the lap in progress is the last one.</summary>
        Chequered,

        /// <summary>Over.</summary>
        Finished
    }

    public sealed class SessionConfig
    {
        public SessionKind Kind { get; set; }

        /// <summary>Wall-clock length (s). Null means untimed.</summary>
        public double? Duration { get; set; }

        /// <summary>Race distance. Null outside a race.</summary>
        public int? Laps { get; set; }

        /// <summary>Track-limit strikes tolerated before a penalty lands.</summary>
        public int StrikesAllowed { get; set; } = 99;

        /// <summary>Seconds added to the result per penalty.</summary>
        public double PenaltySeconds { get; set; }

        /// <summary>Stationary time a pit stop costs (s).</summary>
        public double PitStopDuration { get; set; } = 12;

        /// <summary>
        /// Seconds the gantry waits on four lights before the fifth, or zero
        /// for no start procedure at all.
        /// </summary>
        /// <remarks>
        /// The first four are on a fixed cadence — that is what makes them a
        /// countdown you can time your launch against. The wait before the
        /// last one is the part that is <em>not</em> fixed, which is what
        /// stops a start being something you can anticipate exactly. It is a
        /// parameter rather than a random draw inside the class so a test can
        /// pin it, and so the same session run twice is the same session.
        /// </remarks>
        public double FormationHold { get; set; } = 0.8;
    }

    /// <summary>What the HUD needs to draw a session.</summary>
    public struct SessionState
    {
        public SessionKind Kind;
        public SessionPhase Phase;

        /// <summary>Seconds since the session went green.</summary>
        public double Elapsed;

        /// <summary>Seconds left, or null when untimed.</summary>
        public double? Remaining;

        public int LapsDone;
        public int? LapsTotal;

        public int Strikes;
        public int Penalties;

        /// <summary>Seconds of penalty to add to the result.</summary>
        public double PenaltyTime;

        /// <summary>Non-null while the car is stationary being serviced.</summary>
        public double? PitTimeRemaining;

        public int PitStops;

        /// <summary>Lights showing on the gantry, zero to five.</summary>
        public int Lights;
    }

    /// <summary>What a session is judged on.</summary>
    public struct SessionResult
    {
        public string Label;
        public double? Time;
    }

    /// <summary>
    /// Sessions — practice, qualifying, race, time trial. Ported from
    /// <c>f1sim/src/race/session.ts</c>.
    /// </summary>
    /// <remarks>
    /// A session is the set of rules wrapped around lap timing: how it ends,
    /// what counts as a result, what happens when you abuse track limits, and
    /// what a pit stop costs. It reads the lap timer and the car's position
    /// and owns nothing else, so it stays testable without a renderer.
    /// </remarks>
    public sealed class Session
    {
        /// <summary>Lights in the gantry.</summary>
        public const int StartLights = 5;

        /// <summary>Seconds between each coming on.</summary>
        public const double LightInterval = 0.9;

        /// <summary>
        /// How many light up as the countdown, before the one that means go.
        /// </summary>
        /// <remarks>
        /// Real Formula 1 fills all five and then extinguishes them, and the
        /// extinguishing is the flag. That is the correct grammar and it is
        /// deliberately not the one used here: it only reads as a start signal
        /// if you already know the sport, and a ten-year-old watching five
        /// lights disappear has been given no signal at all — they have been
        /// given the absence of one.
        ///
        /// So four count down and the fifth is the flag. The tension is
        /// identical, because the unpredictable wait now sits before the last
        /// lamp rather than after it, and the meaning is legible to someone
        /// who has never seen a grand prix: all lit, go.
        /// </remarks>
        public const int CountdownLights = StartLights - 1;

        public static SessionConfig Preset(SessionKind kind)
        {
            switch (kind)
            {
                case SessionKind.Practice:
                    return new SessionConfig
                    {
                        Kind = SessionKind.Practice,
                        StrikesAllowed = 99,
                        PenaltySeconds = 0,
                        PitStopDuration = 12,
                        /* Every session starts on the grid, practice included.
                         *
                         * This used to be zero, on the reasoning that practice
                         * is for going out and driving and that five lights in
                         * front of it would be ceremony. That was wrong about
                         * who is playing. The lights are the one piece of
                         * motor racing a child already knows how to read, and
                         * a session that skipped them dropped the player
                         * straight into a moving car with no idea a race had a
                         * beginning — precisely the confusion the phase was
                         * added to remove. */
                        FormationHold = 0.8
                    };

                case SessionKind.Qualifying:
                    return new SessionConfig
                    {
                        Kind = SessionKind.Qualifying,
                        Duration = 12 * 60,
                        StrikesAllowed = 2,
                        PenaltySeconds = 5,
                        PitStopDuration = 12,
                        FormationHold = 0.8
                    };

                case SessionKind.TimeTrial:
                    /*
                     * A time trial has no end, and that is the whole of its
                     * definition. With neither Laps nor Duration set, Update
                     * never reaches a finishing condition, so the session runs
                     * until the player stops — which is what you want when the
                     * opponent is your own best lap and the only question is
                     * whether this one is quicker. Track limits still
                     * invalidate a lap; they just cost nothing else, because
                     * there is no classification for a penalty to move you
                     * down.
                     */
                    return new SessionConfig
                    {
                        Kind = SessionKind.TimeTrial,
                        StrikesAllowed = 99,
                        PenaltySeconds = 0,
                        PitStopDuration = 12,
                        FormationHold = 0.8
                    };

                case SessionKind.Race:
                    return new SessionConfig
                    {
                        Kind = SessionKind.Race,
                        Laps = 5,
                        StrikesAllowed = 2,
                        PenaltySeconds = 5,
                        PitStopDuration = 22,
                        FormationHold = 0.8
                    };

                default:
                    throw new ArgumentOutOfRangeException(nameof(kind));
            }
        }

        public SessionConfig Config { get; }

        public SessionPhase Phase { get; private set; }
        public double Elapsed { get; private set; }
        public int Strikes { get; private set; }
        public int Penalties { get; private set; }
        public int PitStops { get; private set; }

        /// <summary>Seconds since the car was released onto the grid.</summary>
        private double _formationElapsed;

        /// <summary>
        /// Whether the player is actually here yet.
        /// </summary>
        /// <remarks>
        /// The session used to begin the moment it was constructed, which is
        /// some way before anyone is looking at it: the title card is still
        /// up, asking to be tapped for fullscreen and offering a choice of
        /// circuit. Behind it the lights were already counting down, so by the
        /// time you tapped, the start had happened without you.
        ///
        /// Nothing runs until <see cref="Begin"/>. That is a stronger claim
        /// than the formation phase makes — the formation phase says <em>the
        /// race has not started</em>, this says <em>the session has not</em>,
        /// and a practice run with no lights at all needs the second one just
        /// as much.
        /// </remarks>
        private bool _started;

        /// <summary>Set for one tick when the lights go out, so a start can be heard.</summary>
        public bool LightsJustWentOut { get; private set; }

        /// <summary>Seconds left of a stop in progress; null when not in the pits.</summary>
        public double? PitTimeRemaining { get; private set; }

        /// <summary>Set for one tick when a stop finishes, so fresh tyres can be fitted.</summary>
        public bool PitStopJustFinished { get; private set; }

        private bool _wasOnTrack = true;

        /// <summary>Guard so one long excursion counts as a single strike.</summary>
        private bool _strikeArmed = true;

        public Session(SessionConfig config)
        {
            Config = config;
            Phase = config.FormationHold > 0 ? SessionPhase.Formation : SessionPhase.Green;
        }

        /// <summary>Total length of the start procedure (s).</summary>
        public double FormationDuration =>
            Config.FormationHold > 0
                ? CountdownLights * LightInterval + Config.FormationHold
                : 0;

        /// <summary>
        /// Lights showing, zero to five.
        /// </summary>
        /// <remarks>
        /// Four fill on a fixed cadence, then the gantry waits, then the fifth
        /// comes on and the car is released in the same instant. All five lit
        /// <em>is</em> the flag — see <see cref="CountdownLights"/> for why
        /// this is deliberately not what Formula 1 does.
        ///
        /// They stay lit once the session is green, because the signal is the
        /// lamp being on. The gantry is taken off screen a moment later by the
        /// UI rather than being switched off here, which would read as the
        /// start being cancelled.
        /// </remarks>
        public int Lights
        {
            get
            {
                if (!_started) return 0;
                if (Phase != SessionPhase.Formation) return StartLights;
                return (int)Math.Min(
                    CountdownLights,
                    Math.Floor(_formationElapsed / LightInterval));
            }
        }

        /// <summary>True while the car must be held on its grid slot.</summary>
        public bool OnGrid => !_started || Phase == SessionPhase.Formation;

        /// <summary>
        /// True once the player has entered — the gantry has nothing to say
        /// before this, and neither has the clock.
        /// </summary>
        public bool HasBegun => _started;

        /// <summary>
        /// The player is here. Called from the tap that dismisses the title
        /// card, which is the first moment anyone is actually watching.
        /// </summary>
        public void Begin() => _started = true;

        /// <summary>Advance the session.</summary>
        /// <param name="dt">the step (s).</param>
        /// <param name="onTrack">whether the car is inside the white lines.</param>
        /// <param name="lapDone">the lap completed this tick, if any.</param>
        /// <param name="timer">the lap timer this session is wrapped around.</param>
        public void Update(double dt, bool onTrack, CompletedLap lapDone, LapTimer timer)
        {
            PitStopJustFinished = false;
            LightsJustWentOut = false;

            /* Nothing at all happens behind the title card — not the lights,
               not the clock, not track limits. */
            if (!_started) return;
            if (Phase == SessionPhase.Finished) return;

            /* The grid.
             *
             * `Elapsed` deliberately does not advance here, and that is the
             * whole point of the phase existing: the session used to go green
             * the instant the page finished loading, so the clock was already
             * running while the physics was still settling and the driver was
             * still working out which way the car faced. A race now starts
             * when the lights go out, which is both correct and the only way
             * the first lap time means anything. */
            if (Phase == SessionPhase.Formation)
            {
                _formationElapsed += dt;
                if (_formationElapsed >= FormationDuration)
                {
                    Phase = SessionPhase.Green;
                    LightsJustWentOut = true;
                }

                return;
            }

            // A stop holds the car and the clock keeps running — that is the cost.
            if (PitTimeRemaining != null)
            {
                PitTimeRemaining -= dt;
                if (PitTimeRemaining <= 0)
                {
                    PitTimeRemaining = null;
                    PitStopJustFinished = true;
                    PitStops++;
                }
            }

            Elapsed += dt;

            // --- track limits --------------------------------------------
            /* One strike per excursion, not per tick, and it only re-arms once
               the car is properly back on the road. */
            if (!onTrack && _wasOnTrack && _strikeArmed)
            {
                Strikes++;
                _strikeArmed = false;
                if (Strikes > Config.StrikesAllowed) Penalties++;
            }

            if (onTrack) _strikeArmed = true;
            _wasOnTrack = onTrack;

            // --- ending ---------------------------------------------------
            var lapsDone = timer.History.Count;

            if (Config.Laps != null)
            {
                // A race ends the moment the last lap is completed.
                if (lapsDone >= Config.Laps.Value)
                {
                    Phase = SessionPhase.Finished;
                    return;
                }

                if (lapsDone == Config.Laps.Value - 1) Phase = SessionPhase.Chequered;
            }

            if (Config.Duration != null && Elapsed >= Config.Duration.Value)
            {
                /* Time sessions let the lap in progress finish, as they do in
                   reality — the flag falls, but you get to complete your
                   run. */
                if (Phase == SessionPhase.Green) Phase = SessionPhase.Chequered;
                if (lapDone != null) Phase = SessionPhase.Finished;
            }
        }

        /// <summary>
        /// Ask for a pit stop. Only granted when the car is close to
        /// stationary, which stands in for pit-lane geometry until there is a
        /// pit lane.
        /// </summary>
        public bool RequestPit(double speed)
        {
            if (Phase == SessionPhase.Finished) return false;

            /* Nor on the grid. A stationary car on its slot passes the speed
               test below, so without this the whole field could take its stop
               before the lights went out — and the clock, which is not running
               yet, would charge nothing for it. */
            if (Phase == SessionPhase.Formation) return false;
            if (PitTimeRemaining != null) return false;
            if (Math.Abs(speed) > 5) return false;

            PitTimeRemaining = Config.PitStopDuration;
            return true;
        }

        /// <summary>True while the car should be held stationary.</summary>
        public bool InPitStop => PitTimeRemaining != null;

        public double PenaltyTime => Penalties * Config.PenaltySeconds;

        public SessionState State(LapTimer timer) => new SessionState
        {
            Kind = Config.Kind,
            Phase = Phase,
            Elapsed = Elapsed,
            Remaining = Config.Duration == null
                ? (double?)null
                : Math.Max(0, Config.Duration.Value - Elapsed),
            LapsDone = timer.History.Count,
            LapsTotal = Config.Laps,
            Strikes = Strikes,
            Penalties = Penalties,
            PenaltyTime = PenaltyTime,
            PitTimeRemaining = PitTimeRemaining,
            PitStops = PitStops,
            Lights = Lights
        };

        /// <summary>
        /// The number the session is judged on: best lap when qualifying,
        /// total elapsed plus penalties when racing, and nothing in practice.
        /// </summary>
        public SessionResult Result(LapTimer timer)
        {
            switch (Config.Kind)
            {
                case SessionKind.Race:
                    return new SessionResult
                    {
                        Label = "race time",
                        Time = timer.History.Count > 0 ? Elapsed + PenaltyTime : (double?)null
                    };

                default:
                    return new SessionResult
                    {
                        Label = "best lap",
                        Time = timer.BestLap?.Time
                    };
            }
        }

        /// <summary>Fraction of the session run, for a progress bar.</summary>
        public double Progress(LapTimer timer)
        {
            if (Config.Laps != null)
            {
                return MathUtil.Clamp(timer.History.Count / (double)Config.Laps.Value, 0, 1);
            }

            if (Config.Duration != null)
            {
                return MathUtil.Clamp(Elapsed / Config.Duration.Value, 0, 1);
            }

            return 0;
        }
    }
}
