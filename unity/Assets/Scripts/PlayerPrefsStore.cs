using System;
using System.Collections.Generic;
using UnityEngine;

namespace MumuF1.Game
{
    /// <summary>
    /// Ghosts, best laps and a season, kept in <c>PlayerPrefs</c>.
    /// </summary>
    /// <remarks>
    /// The core half declares what it needs to store and nothing about where,
    /// because it has to compile and be tested with no host at all. This is
    /// the host. On WebGL <c>PlayerPrefs</c> is IndexedDB, which is the same
    /// place the web version's <c>localStorage</c> ends up — so a season
    /// started in one is not carried over to the other, but neither is lost.
    ///
    /// Every method swallows its failures, which is the same position the
    /// reference takes and for the same reason: private browsing, a quota, or
    /// a player who has turned storage off should not fail a race. The lap
    /// still happened. It just will not be remembered.
    ///
    /// The keys match the web version's, so a save from the arcade build is
    /// picked up rather than ignored.
    /// </remarks>
    public sealed class PlayerPrefsStore : IGhostStore, ISeasonStore
    {
        private const string SeasonKey = "f1go-season";

        private static string GhostKey(string circuitId) => "f1go-ghost-" + circuitId;
        private static string BestKey(string circuitId) => "f1go-best-" + circuitId;

        // ---- Ghosts -----------------------------------------------------

        public GhostLap Load(string circuitId)
        {
            try
            {
                string raw = PlayerPrefs.GetString(GhostKey(circuitId), "");
                if (string.IsNullOrEmpty(raw)) return null;

                /* Time and path in one entry, separated by a character base64
                   cannot contain. JsonUtility would do this too and would cost
                   a type declaration and a heap allocation to say the same
                   thing about two fields. */
                int split = raw.IndexOf('|');
                if (split <= 0) return null;

                if (!double.TryParse(
                        raw.Substring(0, split),
                        System.Globalization.NumberStyles.Float,
                        System.Globalization.CultureInfo.InvariantCulture,
                        out double time))
                {
                    return null;
                }

                return MumuF1.Ghost.Decode(time, raw.Substring(split + 1));
            }
            catch (Exception)
            {
                return null;
            }
        }

        public void Save(string circuitId, GhostLap lap)
        {
            try
            {
                string time = lap.Time.ToString(
                    "R", System.Globalization.CultureInfo.InvariantCulture);
                PlayerPrefs.SetString(GhostKey(circuitId), time + "|" + MumuF1.Ghost.Encode(lap));
                PlayerPrefs.Save();
            }
            catch (Exception)
            {
                /* See the note above. */
            }
        }

        public void Clear(string circuitId)
        {
            try
            {
                PlayerPrefs.DeleteKey(GhostKey(circuitId));
                PlayerPrefs.Save();
            }
            catch (Exception)
            {
                /* nothing to undo */
            }
        }

        // ---- The season --------------------------------------------------

        public IDictionary<string, int> LoadSeason()
        {
            var table = new Dictionary<string, int>();

            try
            {
                string raw = PlayerPrefs.GetString(SeasonKey, "");
                if (string.IsNullOrEmpty(raw)) return table;

                /* `NAME=points;NAME=points`. A driver name is a surname in
                   capitals and the player is YOU, so neither separator can
                   appear in one — and a hand-edited entry that breaks that
                   loses the season rather than throwing. */
                foreach (string entry in raw.Split(';'))
                {
                    if (entry.Length == 0) continue;

                    int eq = entry.IndexOf('=');
                    if (eq <= 0) continue;

                    if (int.TryParse(entry.Substring(eq + 1), out int points))
                    {
                        table[entry.Substring(0, eq)] = points;
                    }
                }
            }
            catch (Exception)
            {
                return new Dictionary<string, int>();
            }

            return table;
        }

        public void SaveSeason(IDictionary<string, int> table)
        {
            try
            {
                var text = new System.Text.StringBuilder();
                foreach (KeyValuePair<string, int> row in table)
                {
                    if (text.Length > 0) text.Append(';');
                    text.Append(row.Key).Append('=').Append(row.Value);
                }

                PlayerPrefs.SetString(SeasonKey, text.ToString());
                PlayerPrefs.Save();
            }
            catch (Exception)
            {
                /* See the note above. */
            }
        }

        public void ResetSeason()
        {
            try
            {
                PlayerPrefs.DeleteKey(SeasonKey);
                PlayerPrefs.Save();
            }
            catch (Exception)
            {
                /* nothing to undo */
            }
        }

        // ---- Best laps -----------------------------------------------------

        public double? LoadBest(string circuitId)
        {
            try
            {
                string raw = PlayerPrefs.GetString(BestKey(circuitId), "");
                if (string.IsNullOrEmpty(raw)) return null;

                /* Invariant culture, explicitly. A machine with a comma for a
                   decimal point would write "82,431" and read back nothing,
                   and the player would lose a record every time they set one
                   without ever seeing an error. */
                if (!double.TryParse(
                        raw,
                        System.Globalization.NumberStyles.Float,
                        System.Globalization.CultureInfo.InvariantCulture,
                        out double seconds))
                {
                    return null;
                }

                return double.IsNaN(seconds) || double.IsInfinity(seconds) ? (double?)null : seconds;
            }
            catch (Exception)
            {
                return null;
            }
        }

        public void SaveBest(string circuitId, double seconds)
        {
            try
            {
                PlayerPrefs.SetString(
                    BestKey(circuitId),
                    seconds.ToString("F3", System.Globalization.CultureInfo.InvariantCulture));
                PlayerPrefs.Save();
            }
            catch (Exception)
            {
                /* See the note above. */
            }
        }
    }
}
