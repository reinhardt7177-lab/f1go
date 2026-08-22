using System;
using NUnit.Framework;

namespace MumuF1.Tests
{
    /// <summary>
    /// Sessions — practice, qualifying, race — ported from
    /// <c>f1sim/src/race/session.ts</c>.
    /// </summary>
    /// <remarks>
    /// Carried across case for case from the reference's own suite. What is
    /// pinned here is not much arithmetic but a set of rules, and rules are
    /// the kind of thing a port breaks quietly: a strike counted per tick
    /// rather than per excursion still produces a number, and a clock that
    /// starts a moment early still produces a lap time.
    /// </remarks>
    [TestFixture]
    public class SessionTests
    {
        private const double Dt = 1.0 / 120.0;

        private static readonly Circuit Track = Circuits.Get("proving");

        private LapTimer _timer;

        [SetUp]
        public void SetUp()
        {
            _timer = new LapTimer(Track);
            _timer.Update(0, true, Dt);
        }

        /// <summary>
        /// A session with the player already in it.
        /// </summary>
        /// <remarks>
        /// Nothing runs until <c>Begin</c>, because the title card is still up
        /// when a session is constructed — the subject of the last block in
        /// this file. Every test above it is about what happens once you are
        /// playing, so they all start from here.
        /// </remarks>
        private static Session Started(SessionConfig config)
        {
            var session = new Session(config);
            session.Begin();
            return session;
        }

        /// <summary>A session of this kind, already past the lights.</summary>
        private static SessionConfig UnderWay(SessionKind kind)
        {
            SessionConfig c = Session.Preset(kind);
            c.FormationHold = 0;
            return c;
        }

        private static SessionConfig Racing()
        {
            SessionConfig c = Session.Preset(SessionKind.Race);
            c.FormationHold = 0;
            return c;
        }

        /// <summary>Drive the timer round the lap at a constant speed.</summary>
        private void Lap(Session session, double speed, bool onTrack = true)
        {
            var steps = (int)Math.Ceiling(Track.Length / (speed * Dt));
            for (var i = 0; i < steps; i++)
            {
                var s = (i + 1) * speed * Dt % Track.Length;
                CompletedLap done = _timer.Update(s, onTrack, Dt);
                session.Update(Dt, onTrack, done, _timer);
            }
        }

        private void Hold(Session session, double seconds, bool onTrack = true)
        {
            for (var i = 0; i < seconds / Dt; i++) session.Update(Dt, onTrack, null, _timer);
        }

        // ---- Practice ---------------------------------------------------

        [Test]
        public void PracticeNeverEndsOnItsOwn()
        {
            Session session = Started(UnderWay(SessionKind.Practice));
            Hold(session, 600);

            Assert.That(session.Phase, Is.EqualTo(SessionPhase.Green));
            Assert.That(session.State(_timer).Remaining, Is.Null);
        }

        [Test]
        public void PracticeReportsTheBestLapAsItsResult()
        {
            Session session = Started(UnderWay(SessionKind.Practice));
            Lap(session, 40);

            Assert.That(session.Result(_timer).Time.Value,
                Is.EqualTo(_timer.BestLap.Time).Within(1e-3));
        }

        // ---- Qualifying -------------------------------------------------

        private static SessionConfig Qualifying()
        {
            SessionConfig c = UnderWay(SessionKind.Qualifying);
            c.Duration = 120;
            return c;
        }

        [Test]
        public void QualifyingCountsDownAndThrowsTheFlagWhenTimeIsUp()
        {
            Session session = Started(Qualifying());
            Assert.That(session.State(_timer).Remaining.Value, Is.EqualTo(120).Within(0.1));

            Hold(session, 121);
            Assert.That(session.Phase, Is.EqualTo(SessionPhase.Chequered));
            Assert.That(session.State(_timer).Remaining.Value, Is.EqualTo(0).Within(0));
        }

        /// <summary>
        /// The flag has fallen but the run still counts, as it does in
        /// reality.
        /// </summary>
        [Test]
        public void QualifyingLetsTheLapInProgressFinishAfterTheFlag()
        {
            Session session = Started(Qualifying());
            Hold(session, 121);
            Assert.That(session.Phase, Is.EqualTo(SessionPhase.Chequered));

            Lap(session, 60);
            Assert.That(session.Phase, Is.EqualTo(SessionPhase.Finished));
            Assert.That(_timer.History.Count, Is.EqualTo(1));
        }

        [Test]
        public void StopsUpdatingOnceFinished()
        {
            Session session = Started(Qualifying());
            Hold(session, 121);
            Lap(session, 60);

            var frozen = session.Elapsed;
            Hold(session, 30);

            Assert.That(session.Elapsed, Is.EqualTo(frozen).Within(1e-6));
        }

        // ---- Race -------------------------------------------------------

        private static SessionConfig TwoLapRace()
        {
            SessionConfig c = Racing();
            c.Laps = 2;
            return c;
        }

        [Test]
        public void ARaceFinishesOnTheLastLap()
        {
            Session session = Started(TwoLapRace());

            Lap(session, 60);
            Assert.That(session.Phase, Is.EqualTo(SessionPhase.Chequered));
            Assert.That(session.State(_timer).LapsDone, Is.EqualTo(1));

            Lap(session, 60);
            Assert.That(session.Phase, Is.EqualTo(SessionPhase.Finished));
            Assert.That(session.State(_timer).LapsDone, Is.EqualTo(2));
        }

        [Test]
        public void ARaceReportsElapsedTimePlusPenaltiesAsTheResult()
        {
            Session session = Started(TwoLapRace());
            Lap(session, 60);
            Lap(session, 60);

            SessionResult result = session.Result(_timer);
            Assert.That(result.Time.Value,
                Is.EqualTo(session.Elapsed + session.PenaltyTime).Within(1e-6));
        }

        // ---- Track limits -----------------------------------------------

        /// <summary>
        /// One strike per excursion, not per tick. At 120 Hz the difference is
        /// a single strike against three hundred and sixty.
        /// </summary>
        [Test]
        public void CountsOneStrikePerExcursionNotPerTick()
        {
            SessionConfig config = Racing();
            config.StrikesAllowed = 5;
            Session session = Started(config);

            Hold(session, 1, true);
            Hold(session, 3, false);   // one long excursion
            Hold(session, 1, true);
            Assert.That(session.Strikes, Is.EqualTo(1));

            Hold(session, 2, false);   // a second, separate one
            Hold(session, 1, true);
            Assert.That(session.Strikes, Is.EqualTo(2));
        }

        [Test]
        public void AppliesAPenaltyOnceTheAllowanceIsUsedUp()
        {
            SessionConfig config = Racing();
            config.StrikesAllowed = 1;
            config.PenaltySeconds = 5;
            Session session = Started(config);

            for (var i = 0; i < 3; i++)
            {
                Hold(session, 0.5, true);
                Hold(session, 0.5, false);
            }

            Hold(session, 0.5, true);

            Assert.That(session.Strikes, Is.EqualTo(3));
            Assert.That(session.Penalties, Is.EqualTo(2));
            Assert.That(session.PenaltyTime, Is.EqualTo(10).Within(0));
        }

        /// <summary>
        /// Practice still counts the excursions and charges nothing for them,
        /// which is the point of a practice session.
        /// </summary>
        [Test]
        public void LeavesPracticeUnpunished()
        {
            Session session = Started(UnderWay(SessionKind.Practice));

            for (var i = 0; i < 5; i++)
            {
                Hold(session, 0.5, true);
                Hold(session, 0.5, false);
            }

            Assert.That(session.Strikes, Is.EqualTo(5));
            Assert.That(session.Penalties, Is.EqualTo(0));
        }

        // ---- Pit stops ---------------------------------------------------

        [Test]
        public void APitStopIsRefusedWhileTheCarIsMoving()
        {
            Session session = Started(Racing());

            Assert.That(session.RequestPit(40), Is.False);
            Assert.That(session.InPitStop, Is.False);
        }

        [Test]
        public void HoldsTheCarForTheServiceTimeThenReleasesIt()
        {
            SessionConfig config = Racing();
            config.PitStopDuration = 22;
            Session session = Started(config);

            Assert.That(session.RequestPit(1), Is.True);
            Assert.That(session.InPitStop, Is.True);

            Hold(session, 10);
            Assert.That(session.InPitStop, Is.True);
            Assert.That(session.PitTimeRemaining.Value, Is.GreaterThan(0));

            Hold(session, 13);
            Assert.That(session.InPitStop, Is.False);
            Assert.That(session.PitStops, Is.EqualTo(1));
        }

        /// <summary>
        /// The finish signal is set for exactly one tick, because whatever
        /// listens for it fits tyres — and fitting them every tick for the
        /// rest of the session would be a car that never wears out.
        /// </summary>
        [Test]
        public void SignalsExactlyOnceSoTyresAreFittedOnce()
        {
            SessionConfig config = Racing();
            config.PitStopDuration = 2;
            Session session = Started(config);
            session.RequestPit(0);

            var signals = 0;
            for (var i = 0; i < 120 * 5; i++)
            {
                session.Update(Dt, true, null, _timer);
                if (session.PitStopJustFinished) signals++;
            }

            Assert.That(signals, Is.EqualTo(1));
        }

        /// <summary>The clock runs through a stop; that is what makes it a cost.</summary>
        [Test]
        public void CostsTheSessionClockTheFullStop()
        {
            SessionConfig config = Racing();
            config.PitStopDuration = 22;
            Session session = Started(config);

            session.RequestPit(0);
            Hold(session, 22.5);

            Assert.That(session.Elapsed, Is.GreaterThan(22));
        }

        [Test]
        public void APitStopCannotBeStacked()
        {
            Session session = Started(Racing());

            Assert.That(session.RequestPit(0), Is.True);
            Assert.That(session.RequestPit(0), Is.False);
        }

        // ---- The start ---------------------------------------------------
        //
        // Before this existed a race went green the instant the page finished
        // loading: the clock was already running while the physics was still
        // settling, and the first thing a driver did was discover they were
        // late. What is pinned here is not the animation but the two facts it
        // stands on — nothing counts until the lights go out, and the lights
        // go out at a time you cannot quite predict.

        [Test]
        public void HoldsTheRaceOnTheGridBeforeItGoesGreen()
        {
            Session session = Started(Session.Preset(SessionKind.Race));

            Assert.That(session.Phase, Is.EqualTo(SessionPhase.Formation));
            Assert.That(session.OnGrid, Is.True);

            Hold(session, 1);

            // The one thing a start procedure must not do is charge you for it.
            Assert.That(session.Elapsed, Is.EqualTo(0).Within(0));
            Assert.That(session.State(_timer).LapsDone, Is.EqualTo(0));
        }

        /// <summary>
        /// Four fill on a fixed cadence and stop there however long the gantry
        /// waits; then the fifth comes on and the car is released in the same
        /// instant.
        /// </summary>
        /// <remarks>
        /// Not the real Formula 1 signal — which is all five going out — and
        /// deliberately so: the extinguishing only reads as a flag to someone
        /// who already knows the sport. All lit means go.
        ///
        /// Sampled in the middle of each light's interval rather than on the
        /// boundary. Stepping at 1/120 s never lands exactly on a multiple of
        /// 0.9, so a sample taken at the edge reads whichever side the
        /// accumulated float happens to fall — which would fail this test for
        /// a reason that has nothing to do with the lights.
        /// </remarks>
        [Test]
        public void CountsDownOnFourLightsAndGoesOnTheFifth()
        {
            SessionConfig config = Session.Preset(SessionKind.Race);
            Session session = Started(config);
            Assert.That(session.Lights, Is.EqualTo(0));

            var seen = new int[Session.CountdownLights];
            var held = 0.0;
            for (var i = 0; i < Session.CountdownLights; i++)
            {
                var target = (i + 1.5) * Session.LightInterval;
                Hold(session, target - held);
                held = target;
                seen[i] = session.Lights;
            }

            Assert.That(seen, Is.EqualTo(new[] { 1, 2, 3, Session.CountdownLights }));

            Hold(session, config.FormationHold + Dt);
            Assert.That(session.Phase, Is.EqualTo(SessionPhase.Green));
            Assert.That(session.Lights, Is.EqualTo(Session.StartLights));
        }

        [Test]
        public void AnnouncesTheStartExactlyOnce()
        {
            Session session = Started(Session.Preset(SessionKind.Race));

            var signals = 0;
            for (var i = 0; i < 120 * 12; i++)
            {
                session.Update(Dt, true, null, _timer);
                if (session.LightsJustWentOut) signals++;
            }

            Assert.That(signals, Is.EqualTo(1));
        }

        /// <summary>
        /// A stationary car on its slot passes the speed test for a stop, so
        /// without an explicit refusal the whole field could be serviced
        /// before the lights went out — and the clock, which is not running
        /// yet, would charge nothing for it.
        /// </summary>
        [Test]
        public void RefusesAPitStopAndIgnoresTrackLimitsOnTheGrid()
        {
            Session session = Started(Session.Preset(SessionKind.Race));

            Assert.That(session.RequestPit(0), Is.False);

            Hold(session, 1, false);
            Assert.That(session.Strikes, Is.EqualTo(0));
        }

        /// <summary>
        /// Practice used to skip the lights, on the reasoning that it is for
        /// going out and driving. That dropped a ten-year-old straight into a
        /// moving car with no sign that anything had begun — the exact
        /// confusion the phase exists to remove — so every session now starts
        /// the same way.
        /// </summary>
        [TestCase(SessionKind.Practice)]
        [TestCase(SessionKind.Qualifying)]
        [TestCase(SessionKind.Race)]
        [TestCase(SessionKind.TimeTrial)]
        public void HoldsEverySessionOnTheGridNotJustARace(SessionKind kind)
        {
            Session session = Started(Session.Preset(kind));

            Assert.That(session.Phase, Is.EqualTo(SessionPhase.Formation));
            Assert.That(session.OnGrid, Is.True);
            Assert.That(session.FormationDuration, Is.GreaterThan(3));
        }

        /// <summary>
        /// The hold is the unpredictable part, so it is a parameter rather
        /// than a draw inside the class — which is what lets this assert that
        /// a longer one delays the green and nothing else.
        /// </summary>
        [Test]
        public void CostsTheSameWhereverTheHoldFalls()
        {
            SessionConfig fast = Session.Preset(SessionKind.Race);
            fast.FormationHold = 0.2;
            SessionConfig slow = Session.Preset(SessionKind.Race);
            slow.FormationHold = 2;

            Session quick = Started(fast);
            Session late = Started(slow);

            var until = Session.CountdownLights * Session.LightInterval + 0.3;
            Hold(quick, until);
            Hold(late, until);

            Assert.That(quick.Phase, Is.EqualTo(SessionPhase.Green));
            Assert.That(late.Phase, Is.EqualTo(SessionPhase.Formation));

            /* The clock on the quick one is only the time since its own lights
               went out, not the five seconds it spent watching them. */
            Assert.That(quick.Elapsed, Is.LessThan(0.2));
        }

        // ---- Before the player has entered --------------------------------
        //
        // The title card is up when the session is constructed: it asks for
        // fullscreen, it offers a choice of circuit, and until it is tapped
        // nobody is looking at the road. The session used to run anyway, so
        // the five lights counted down behind the card and the race started
        // without the player — tap, and you were already several seconds late
        // off a grid you never saw.

        [Test]
        public void RunsNothingAtAllBeforeTheCardIsTapped()
        {
            var session = new Session(Session.Preset(SessionKind.Race));
            Assert.That(session.HasBegun, Is.False);

            Hold(session, 20);

            Assert.That(session.Phase, Is.EqualTo(SessionPhase.Formation));
            Assert.That(session.Lights, Is.EqualTo(0));
            Assert.That(session.Elapsed, Is.EqualTo(0).Within(0));
        }

        /// <summary>
        /// A session configured without a start procedure goes green
        /// immediately, so the formation phase cannot be what holds it behind
        /// the title card. The gate has to be its own thing, or the run would
        /// be under way before anyone had pressed start.
        /// </summary>
        [Test]
        public void HoldsTheCarEvenInASessionWithNoLights()
        {
            var session = new Session(UnderWay(SessionKind.Practice));

            Assert.That(session.Phase, Is.EqualTo(SessionPhase.Green));
            Assert.That(session.OnGrid, Is.True);

            Hold(session, 5);
            Assert.That(session.Elapsed, Is.EqualTo(0).Within(0));
        }

        [Test]
        public void StartsTheLightsOnlyOnceTheCardIsTapped()
        {
            var session = new Session(Session.Preset(SessionKind.Race));

            Hold(session, 4);
            Assert.That(session.Lights, Is.EqualTo(0));

            session.Begin();
            Hold(session, 1.5 * Session.LightInterval);

            Assert.That(session.Lights, Is.EqualTo(1));
            Assert.That(session.OnGrid, Is.True);
        }
    }
}
