using System.Collections.Generic;
using NUnit.Framework;

namespace MumuF1.Tests
{
    /// <summary>
    /// Points across a season, ported from
    /// <c>f1sim/src/race/championship.ts</c>.
    /// </summary>
    /// <remarks>
    /// The reference keeps the table in <c>localStorage</c> and its tests
    /// therefore cover the scoring only. Here the store is an interface, which
    /// means the whole thing can be checked — including the part the reference
    /// could not reach without a browser: that a season accumulates across
    /// races rather than being overwritten by the last one.
    /// </remarks>
    [TestFixture]
    public class ChampionshipTests
    {
        /// <summary>A season that lives for the length of one test.</summary>
        private sealed class Memory : ISeasonStore
        {
            private Dictionary<string, int> _table = new Dictionary<string, int>();
            private readonly Dictionary<string, double> _best = new Dictionary<string, double>();

            /// <summary>How many times a season has been written.</summary>
            public int Writes { get; private set; }

            public IDictionary<string, int> LoadSeason() => new Dictionary<string, int>(_table);

            public void SaveSeason(IDictionary<string, int> table)
            {
                _table = new Dictionary<string, int>(table);
                Writes++;
            }

            public void ResetSeason() => _table.Clear();

            public double? LoadBest(string circuitId) =>
                _best.TryGetValue(circuitId, out var v) ? v : (double?)null;

            public void SaveBest(string circuitId, double seconds) => _best[circuitId] = seconds;
        }

        private static IReadOnlyList<ClassificationRow> Order(params string[] names)
        {
            var rows = new List<ClassificationRow>(names.Length);
            foreach (var name in names)
            {
                rows.Add(new ClassificationRow { Name = name, Player = name == "YOU" });
            }

            return rows;
        }

        [Test]
        public void AwardsTheAllocationDownToTenthAndNothingBelow()
        {
            var store = new Memory();
            var season = new Championship(store);

            season.Score(Order(
                "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "YOU"));

            IReadOnlyList<Standing> table = season.Standings();

            Assert.That(table[0].Name, Is.EqualTo("A"));
            Assert.That(table[0].Points, Is.EqualTo(25));

            foreach (Standing row in table)
            {
                if (row.Name == "J") Assert.That(row.Points, Is.EqualTo(1), "tenth scored nothing");
                if (row.Name == "K") Assert.That(row.Points, Is.EqualTo(0), "eleventh scored");
                if (row.Name == "YOU") Assert.That(row.Points, Is.EqualTo(0), "twelfth scored");
            }
        }

        [Test]
        public void GivesBackWhatThePlayerScored()
        {
            var season = new Championship(new Memory());

            Assert.That(season.Score(Order("YOU", "A", "B")), Is.EqualTo(25));
            Assert.That(season.Score(Order("A", "YOU", "B")), Is.EqualTo(18));
            Assert.That(season.Score(Order(
                "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "YOU")), Is.EqualTo(0));
        }

        /// <summary>
        /// A season is the point of the thing, so the table has to add up
        /// across races rather than be replaced by the latest one.
        /// </summary>
        [Test]
        public void AccumulatesAcrossRaces()
        {
            var store = new Memory();
            var season = new Championship(store);

            season.Score(Order("YOU", "A"));   // 25 and 18
            season.Score(Order("A", "YOU"));   // 18 and 25 more

            foreach (Standing row in season.Standings())
            {
                Assert.That(row.Points, Is.EqualTo(43), $"{row.Name} did not carry a race over");
            }

            Assert.That(store.Writes, Is.EqualTo(2));
        }

        [Test]
        public void SortsTheStandingsByPoints()
        {
            var season = new Championship(new Memory());
            season.Score(Order("C", "A", "B"));

            IReadOnlyList<Standing> table = season.Standings();

            Assert.That(table[0].Name, Is.EqualTo("C"));
            Assert.That(table[1].Name, Is.EqualTo("A"));
            Assert.That(table[2].Name, Is.EqualTo("B"));
        }

        /// <summary>
        /// Two drivers level on points come out in a fixed order rather than
        /// whatever the dictionary happened to enumerate.
        /// </summary>
        /// <remarks>
        /// The reference sorts on points alone and inherits its tie-break from
        /// the insertion order of a JavaScript object. A Dictionary has no
        /// order to inherit, so without a second key the same season could
        /// display differently on two runs.
        /// </remarks>
        [Test]
        public void BreaksATieTheSameWayEveryTime()
        {
            var season = new Championship(new Memory());
            season.Score(Order("ZEBRA", "APPLE"));
            season.Score(Order("APPLE", "ZEBRA"));

            for (var i = 0; i < 5; i++)
            {
                IReadOnlyList<Standing> table = season.Standings();
                Assert.That(table[0].Name, Is.EqualTo("APPLE"));
                Assert.That(table[1].Name, Is.EqualTo("ZEBRA"));
            }
        }

        [Test]
        public void RecordsALapOnlyWhenItBeatsTheOneBefore()
        {
            var season = new Championship(new Memory());

            Assert.That(season.RecordLap("monza", 80.0), Is.True, "the first lap is always a best");
            Assert.That(season.RecordLap("monza", 80.5), Is.False);
            Assert.That(season.RecordLap("monza", 80.0), Is.False, "an equal lap is not a better one");
            Assert.That(season.RecordLap("monza", 79.9), Is.True);

            // And the circuits do not share a record.
            Assert.That(season.RecordLap("interlagos", 200.0), Is.True);
        }
    }
}
