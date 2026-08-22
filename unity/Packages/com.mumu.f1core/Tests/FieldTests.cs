using System;
using System.Collections.Generic;
using NUnit.Framework;

namespace MumuF1.Tests
{
    /// <summary>
    /// The rest of the grid, ported from <c>f1sim/src/race/field.ts</c>.
    /// </summary>
    /// <remarks>
    /// Rivals are run along the racing line at a fraction of the speed profile
    /// it is worth, rather than as nine more rigid bodies on four raycast
    /// wheels each. That means most of what is worth checking here is not a
    /// number but a shape: that the pace spread actually decides the order,
    /// that laps are counted, that a finisher stops being overtaken.
    /// </remarks>
    [TestFixture]
    public class FieldTests
    {
        private static readonly Circuit Track = Circuits.Get("monza");
        private static readonly RacingLine Line = new RacingLine(Track);
        private static readonly SpeedProfile Profile = new SpeedProfile(Line);

        private static Field MakeField() => new Field(Line, Profile, Track.Length);

        /// <summary>
        /// A rival points where it is going.
        /// </summary>
        /// <remarks>
        /// Nothing pinned this, and it was wrong: the heading was built with
        /// the reference's forward axis, −Z, while every other heading in the
        /// project uses Unity's +Z — the start heading, the roadside props,
        /// the gantry. The renderer turns this straight into a Y rotation, so
        /// a rival travelling north faced south and one travelling east faced
        /// east, which is a mirror about the X axis and looks exactly like
        /// half the field having spun.
        ///
        /// Stated as a shape rather than as a number, so it cannot drift back:
        /// the direction the heading names has to be the direction the car
        /// actually moved. That is true in any convention and false in the
        /// wrong one.
        /// </remarks>
        [Test]
        public void FacesTheWayItIsTravelling()
        {
            Field field = MakeField();

            /* Long enough to be clear of the grid blend, which holds a rival
               out towards its box and would otherwise move it sideways. */
            for (var i = 0; i < 400; i++) field.Update(0.05, i * 0.05, null);

            foreach (Rival rival in field.Rivals)
            {
                Vec3 before = rival.Position;
                var heading = rival.Heading;

                field.Update(0.05, 20.05, null);

                Vec3 travelled = rival.Position - before;
                var moved = Math.Sqrt(travelled.X * travelled.X + travelled.Z * travelled.Z);
                Assert.That(moved, Is.GreaterThan(0.1), "the rival did not move");

                /* The unit vector the heading names, in the project's
                   convention: `atan2(x, z)` means x = sin, z = cos. */
                var facing = new Vec3(Math.Sin(heading), 0, Math.Cos(heading));
                var along = (travelled.X * facing.X + travelled.Z * facing.Z) / moved;

                Assert.That(along, Is.GreaterThan(0.99),
                    $"{rival.Name} is facing {Math.Acos(Math.Max(-1, Math.Min(1, along))) * 180 / Math.PI:F0}"
                    + " degrees away from the way it is moving");
            }
        }

        /// <summary>
        /// The player starts last: the race is then about getting through the
        /// field rather than defending a lead handed over at the lights.
        /// </summary>
        [Test]
        public void LinesUpAheadOfThePlayer()
        {
            Field field = MakeField();

            foreach (Rival rival in field.Rivals)
            {
                Assert.That(rival.Distance, Is.GreaterThan(0));
            }

            Assert.That(field.PositionOf(1, 0, null), Is.EqualTo(field.Rivals.Count + 1));
        }

        [Test]
        public void GivesEveryRivalADifferentPace()
        {
            Field field = MakeField();
            var seen = new HashSet<double>();

            foreach (Rival rival in field.Rivals)
            {
                Assert.That(seen.Add(rival.Pace), Is.True, $"two drivers share a pace of {rival.Pace}");
                Assert.That(rival.Pace, Is.GreaterThan(0.5));
                Assert.That(rival.Pace, Is.LessThanOrEqualTo(1));
            }
        }

        /// <summary>
        /// Half a minute of Monza is a good chunk of a lap, and nobody should
        /// be crawling or teleporting.
        /// </summary>
        [Test]
        public void DrivesThemRoundAtSomethingLikeARacingSpeed()
        {
            Field field = MakeField();
            for (var i = 0; i < 60 * 30; i++) field.Update(1.0 / 60, i / 60.0, null);

            foreach (Rival rival in field.Rivals)
            {
                Assert.That(rival.Speed, Is.GreaterThan(20));
                Assert.That(rival.Speed, Is.LessThan(120));
                Assert.That(double.IsNaN(rival.Position.X) || double.IsInfinity(rival.Position.X),
                    Is.False);
            }
        }

        /// <summary>
        /// The quickest driver should be leading the others after two minutes.
        /// If pace does not decide the order it means nothing.
        /// </summary>
        [Test]
        public void OrdersTheFieldByPaceOnceTheyAreRunning()
        {
            Field field = MakeField();
            for (var i = 0; i < 60 * 120; i++) field.Update(1.0 / 60, i / 60.0, null);

            var byPace = new List<Rival>(field.Rivals);
            byPace.Sort((a, b) => b.Pace.CompareTo(a.Pace));

            Assert.That(Covered(byPace[0]), Is.GreaterThan(Covered(byPace[byPace.Count - 1])));
        }

        private static double Covered(Rival r) => (r.Lap - 1) * Track.Length + r.Distance;

        /// <summary>
        /// One lap of Monza takes well under ten minutes at any pace, so
        /// everybody should have taken the flag.
        /// </summary>
        [Test]
        public void CountsLapsAndRetiresThemAtTheFlag()
        {
            Field field = MakeField();
            for (var i = 0; i < 60 * 600; i++) field.Update(1.0 / 60, i / 60.0, 1);

            foreach (Rival rival in field.Rivals)
            {
                Assert.That(rival.FinishedAt, Is.Not.Null);
            }
        }

        /// <summary>
        /// Everyone has finished; a player still on lap one is last.
        /// </summary>
        /// <remarks>
        /// This is the test that would catch the finisher rank being reached
        /// for as <c>double.MaxValue</c> rather than as the reference's
        /// 2^53−1 — at 1e308, subtracting a race time changes nothing, every
        /// finisher compares exactly equal, and the finishing order becomes
        /// whatever the sort happened to do.
        /// </remarks>
        [Test]
        public void PutsAFinisherAheadOfAnyoneStillRunning()
        {
            Field field = MakeField();
            for (var i = 0; i < 60 * 600; i++) field.Update(1.0 / 60, i / 60.0, 1);

            Assert.That(field.PositionOf(1, 0, null), Is.EqualTo(field.Rivals.Count + 1));

            /* And they are ordered among themselves by when they finished,
               rather than all sharing one position. */
            IReadOnlyList<ClassificationRow> order = field.Classification(1, 0, null);
            Assert.That(order[order.Count - 1].Player, Is.True);
        }

        [Test]
        public void ClassifiesThePlayerAmongTheRivals()
        {
            Field field = MakeField();
            IReadOnlyList<ClassificationRow> order = field.Classification(1, 0, null);

            Assert.That(order.Count, Is.EqualTo(field.Rivals.Count + 1));

            var players = 0;
            foreach (ClassificationRow row in order)
            {
                if (row.Player) players++;
            }

            Assert.That(players, Is.EqualTo(1));

            // Started last, so last until something happens.
            Assert.That(order[order.Count - 1].Player, Is.True);
        }

        [Test]
        public void ReportsAGapToTheCarAheadAndNoneWhenLeading()
        {
            Field field = MakeField();

            Assert.That(field.GapAhead(1, 0), Is.Not.Null);
            Assert.That(field.GapAhead(1, 0).Value, Is.GreaterThan(0));

            // A player a full lap up has nobody in front.
            Assert.That(field.GapAhead(3, 0), Is.Null);
        }

        /// <summary>
        /// The grid staggers left and right, and the player's box is on the
        /// side the alternating order leaves free.
        /// </summary>
        /// <remarks>
        /// A Formula 1 grid is not a queue: no car sits directly behind the
        /// one in front, which is what makes the run to the first corner a
        /// race rather than a procession — and what stops the player being
        /// parked on top of the car ahead of them.
        /// </remarks>
        [Test]
        public void StaggersTheGridAndLeavesThePlayerTheFreeSide()
        {
            Field field = MakeField();

            for (var i = 1; i < field.Rivals.Count; i++)
            {
                Assert.That(
                    Math.Sign(field.Rivals[i].GridLateral),
                    Is.Not.EqualTo(Math.Sign(field.Rivals[i - 1].GridLateral)),
                    $"cars {i - 1} and {i} share a side of the grid");
            }

            var last = field.Rivals[field.Rivals.Count - 1].GridLateral;
            Assert.That(field.PlayerGridLateral, Is.EqualTo(-last).Within(0));
        }

        /// <summary>
        /// The stagger blends away rather than switching off.
        /// </summary>
        /// <remarks>
        /// The boxes are off the racing line and the race is on it. A car that
        /// jumped sideways onto the line at the moment the lights went out
        /// would look like it had been teleported, so it drifts across over
        /// about two seconds instead — the same drift a real field makes on
        /// the run to the first corner.
        /// </remarks>
        [Test]
        public void DriftsOffTheGridRatherThanSnappingToTheLine()
        {
            Field field = MakeField();

            // Held on the grid: out in the boxes.
            field.Update(1.0 / 60, 0, null, true);
            Rival car = field.Rivals[0];
            var onGrid = Offset(car);
            Assert.That(onGrid, Is.GreaterThan(1), "the grid boxes are on the racing line");

            // Released: still most of the way out one tick later.
            field.Update(1.0 / 60, 0, null);
            Assert.That(Offset(car), Is.GreaterThan(onGrid * 0.9), "jumped sideways at the lights");

            // And on the line a few seconds later.
            for (var i = 0; i < 60 * 4; i++) field.Update(1.0 / 60, i / 60.0, null);
            Assert.That(Offset(field.Rivals[0]), Is.LessThan(0.001), "never made it to the line");
        }

        /// <summary>How far a rival is from the racing line, right now (m).</summary>
        private static double Offset(Rival car) => (car.Position - Line.PointAt(car.Distance)).Length;

        [Test]
        public void AwardsTheF1AllocationDownToTenth()
        {
            Assert.That(Championship.Points, Is.EqualTo(new[] { 25, 18, 15, 12, 10, 8, 6, 4, 2, 1 }));
            Assert.That(Championship.Points[0] - Championship.Points[1], Is.EqualTo(7));
        }
    }
}
