using System;
using System.Collections.Generic;

namespace MumuF1
{
    /// <summary>A driver and what they have scored.</summary>
    public struct Standing
    {
        public string Name;
        public int Points;
    }

    /// <summary>
    /// Somewhere to keep a season and a set of best laps.
    /// </summary>
    /// <remarks>
    /// An interface for the same reason <see cref="IGhostStore"/> is one: the
    /// reference reaches straight for <c>localStorage</c>, and this assembly
    /// has no host to reach for anything in.
    ///
    /// Every method may fail silently. A corrupt or blocked store is not worth
    /// failing a race over — the race still happened, it just will not be
    /// remembered.
    /// </remarks>
    public interface ISeasonStore
    {
        IDictionary<string, int> LoadSeason();
        void SaveSeason(IDictionary<string, int> table);
        void ResetSeason();

        double? LoadBest(string circuitId);
        void SaveBest(string circuitId, double seconds);
    }

    /// <summary>
    /// Points across a season, ported from
    /// <c>f1sim/src/race/championship.ts</c>.
    /// </summary>
    /// <remarks>
    /// A single race is a lap time; a championship is a reason to come back.
    ///
    /// Scoring is deliberately dumb: it takes a finishing order and adds
    /// points. It knows nothing about circuits, physics or sessions, which is
    /// what lets it sit above both.
    /// </remarks>
    public sealed class Championship
    {
        /// <summary>The current Formula 1 allocation, first to tenth.</summary>
        public static readonly int[] Points = { 25, 18, 15, 12, 10, 8, 6, 4, 2, 1 };

        private readonly ISeasonStore _store;

        public Championship(ISeasonStore store)
        {
            _store = store;
        }

        /// <summary>Score a finishing order into the season table.</summary>
        /// <returns>the points the player took, for the results screen.</returns>
        public int Score(IReadOnlyList<ClassificationRow> order)
        {
            IDictionary<string, int> table = _store.LoadSeason() ?? new Dictionary<string, int>();
            var earned = 0;

            for (var i = 0; i < order.Count; i++)
            {
                var points = i < Points.Length ? Points[i] : 0;

                table.TryGetValue(order[i].Name, out var had);
                table[order[i].Name] = had + points;

                if (order[i].Player) earned = points;
            }

            _store.SaveSeason(table);
            return earned;
        }

        /// <summary>The table as a sorted list, for display.</summary>
        public IReadOnlyList<Standing> Standings()
        {
            IDictionary<string, int> table = _store.LoadSeason() ?? new Dictionary<string, int>();

            var rows = new List<Standing>(table.Count);
            foreach (KeyValuePair<string, int> entry in table)
            {
                rows.Add(new Standing { Name = entry.Key, Points = entry.Value });
            }

            /* By points, then by name. The reference sorts on points alone and
               inherits its tie-break from the insertion order of a JavaScript
               object; a Dictionary has no order to inherit, so two drivers
               level on points would come out differently on every run. Name is
               arbitrary, and being arbitrary once is the point. */
            rows.Sort((a, b) =>
            {
                var byPoints = b.Points.CompareTo(a.Points);
                return byPoints != 0
                    ? byPoints
                    : string.Compare(a.Name, b.Name, StringComparison.Ordinal);
            });

            return rows;
        }

        /// <summary>Records a lap and says whether it was a new best.</summary>
        public bool RecordLap(string circuitId, double seconds)
        {
            var best = _store.LoadBest(circuitId);
            if (best != null && seconds >= best.Value) return false;

            _store.SaveBest(circuitId, seconds);
            return true;
        }
    }
}
