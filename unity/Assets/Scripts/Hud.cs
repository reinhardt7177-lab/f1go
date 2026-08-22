using System;
using UnityEngine;

namespace MumuF1.Game
{
    /// <summary>
    /// The read-out: speed, gear, lap, sector, position, and the five lights.
    /// </summary>
    /// <remarks>
    /// Drawn with IMGUI, which is a deliberate choice rather than a shortcut.
    /// A canvas-based HUD needs a font asset, a canvas prefab and a handful of
    /// serialised references, and every one of those is a file that cannot be
    /// written or reviewed as text — this project is authored on a machine
    /// with no editor to click in, and a prefab full of GUIDs is exactly the
    /// kind of thing that rots silently. IMGUI needs none of it and costs a
    /// few allocations a frame on a screen that is already drawing a circuit.
    ///
    /// Nothing here decides anything either. Every number comes from
    /// <see cref="RaceDirector"/>, which gets them from the core.
    /// </remarks>
    public class Hud : MonoBehaviour
    {
        private RaceDirector _race;
        private CarController _car;

        // The house palette, from the web version's HUD.
        private static readonly Color Ink = new Color(0.93f, 0.95f, 0.97f);
        private static readonly Color Dim = new Color(0.62f, 0.66f, 0.72f);
        private static readonly Color Panel = new Color(0.04f, 0.05f, 0.07f, 0.72f);
        private static readonly Color Up = new Color(0.35f, 0.85f, 0.45f);
        private static readonly Color Down = new Color(0.95f, 0.42f, 0.38f);
        private static readonly Color Amber = new Color(0.98f, 0.72f, 0.18f);
        private static readonly Color LampOn = new Color(0.92f, 0.16f, 0.16f);
        private static readonly Color LampOff = new Color(0.13f, 0.11f, 0.12f);

        private Texture2D _white;
        private GUIStyle _big;
        private GUIStyle _small;
        private GUIStyle _label;

        public static Hud Build(Transform parent, RaceDirector race, CarController car)
        {
            var go = new GameObject("HUD");
            go.transform.SetParent(parent);

            var hud = go.AddComponent<Hud>();
            hud._race = race;
            hud._car = car;
            return hud;
        }

        private void EnsureStyles()
        {
            if (_white == null)
            {
                _white = new Texture2D(1, 1);
                _white.SetPixel(0, 0, Color.white);
                _white.Apply();
                _white.hideFlags = HideFlags.HideAndDontSave;
            }

            if (_big != null) return;

            /* Scaled off the short edge rather than a fixed point size. The
               same build runs on a phone held sideways and on a desktop
               window, and a HUD sized for one is unreadable or absurd on the
               other. */
            int unit = Mathf.Max(12, Mathf.RoundToInt(Mathf.Min(Screen.width, Screen.height) / 22f));

            _big = Typeface.Style(unit * 2, FontStyle.Bold, TextAnchor.UpperLeft);
            _small = Typeface.Style(Mathf.RoundToInt(unit * 0.85f), FontStyle.Normal, TextAnchor.UpperLeft);
            _label = Typeface.Style(Mathf.RoundToInt(unit * 0.55f), FontStyle.Bold, TextAnchor.UpperLeft);
        }

        private void OnGUI()
        {
            if (_race == null || _race.Session == null) return;

            /* Nothing to read while the card is up: the clock has not
               started, no lap is running, and a HUD full of zeroes over a
               menu is just clutter. The web version hides it for the same
               reason. */
            if (TitleCard.Up) return;

            EnsureStyles();

            float unit = Mathf.Max(12f, Mathf.Min(Screen.width, Screen.height) / 22f);
            float pad = unit * 0.6f;

            DrawSpeed(unit, pad);
            DrawTiming(unit, pad);
            DrawLights(unit);
        }

        // ---- The speed block, bottom left ------------------------------

        private void DrawSpeed(float unit, float pad)
        {
            float w = unit * 7f;
            float h = unit * 3.4f;
            var box = new Rect(pad, Screen.height - h - pad, w, h);

            Fill(box, Panel);

            double kmh = Math.Abs(_car.SpeedMs) * MathUtil.Kmh;
            Text(new Rect(box.x + pad, box.y + pad * 0.2f, w, unit * 2.2f),
                Mathf.RoundToInt((float)kmh).ToString(), _big, Ink);
            Text(new Rect(box.x + pad, box.y + unit * 2.1f, w, unit),
                "km/h", _label, Dim);

            /* Reverse is gear zero and neutral is not a gear the box has, so
               R and a number is the whole vocabulary. */
            string gear = _car.Gear == 0 ? "R" : _car.Gear.ToString();
            Text(new Rect(box.xMax - unit * 2.2f, box.y + pad * 0.2f, unit * 2f, unit * 2.2f),
                gear, _big, Amber);
        }

        // ---- Timing, top left --------------------------------------------

        private void DrawTiming(float unit, float pad)
        {
            LapTimer timer = _race.Timer;
            SessionState state = _race.Session.State(timer);

            float w = unit * 8.5f;
            float line = unit * 0.95f;
            int rows = 4;
            if (_race.Field != null) rows++;
            if (_race.Ghost != null) rows++;

            var box = new Rect(pad, pad, w, line * rows + pad);
            Fill(box, Panel);

            float y = box.y + pad * 0.4f;

            Row(box, ref y, line, "LAP",
                state.LapsTotal == null
                    ? timer.Lap.ToString()
                    : timer.Lap + " / " + state.LapsTotal.Value,
                Ink);

            Row(box, ref y, line, "TIME", Clock(timer.LapTime), _race.OnTrack ? Ink : Down);

            Row(box, ref y, line, "BEST",
                timer.BestLap == null ? "--:--.---" : Clock(timer.BestLap.Time),
                timer.BestLap == null ? Dim : Ink);

            Row(box, ref y, line, "S" + (timer.Sector + 1),
                timer.CurrentSectors.Count > timer.Sector
                    ? Span(timer.LapTime - Sum(timer.CurrentSectors, timer.Sector))
                    : Span(timer.LapTime),
                Dim);

            if (_race.Field != null)
            {
                Row(box, ref y, line, "POS", _race.Position + " / " + (_race.Field.Rivals.Count + 1), Ink);
            }

            if (_race.Ghost != null)
            {
                /* Null before the ghost reached here, which is the honest
                   answer rather than a clamped zero — and it is what the
                   first corner of a first lap actually looks like. */
                double? delta = _race.GhostDelta;
                Row(box, ref y, line, "GHOST",
                    delta == null ? "—" : (delta.Value >= 0 ? "+" : "") + Span(delta.Value),
                    delta == null ? Dim : (delta.Value <= 0 ? Up : Down));
            }
        }

        private void Row(Rect box, ref float y, float line, string label, string value, Color colour)
        {
            Text(new Rect(box.x + line * 0.6f, y, line * 3f, line), label, _label, Dim);
            Text(new Rect(box.x + line * 3.4f, y, box.width, line), value, _small, colour);
            y += line;
        }

        // ---- The gantry, top centre ---------------------------------------

        private void DrawLights(float unit)
        {
            Session session = _race.Session;

            /* Off screen a moment after the start rather than switched off,
               because a gantry going dark reads as the start being cancelled.
               Two seconds is long enough to see that all five lit. */
            if (session.Phase != SessionPhase.Formation && session.Elapsed > 2) return;

            int lit = session.Lights;
            float r = unit * 0.7f;
            float gap = r * 2.6f;
            float total = gap * (Session.StartLights - 1) + r * 2f;
            float x = (Screen.width - total) * 0.5f;
            float y = unit * 1.2f;

            Fill(new Rect(x - unit * 0.6f, y - unit * 0.6f, total + unit * 1.2f, r * 2f + unit * 1.2f),
                Panel);

            for (int i = 0; i < Session.StartLights; i++)
            {
                Fill(new Rect(x + gap * i, y, r * 2f, r * 2f), i < lit ? LampOn : LampOff);
            }
        }

        // ---- Drawing ---------------------------------------------------------

        private void Fill(Rect r, Color c)
        {
            Color was = GUI.color;
            GUI.color = c;
            GUI.DrawTexture(r, _white);
            GUI.color = was;
        }

        private static void Text(Rect r, string s, GUIStyle style, Color colour)
        {
            Color was = style.normal.textColor;
            style.normal.textColor = colour;
            GUI.Label(r, s, style);
            style.normal.textColor = was;
        }

        // ---- Numbers as text ----------------------------------------------------

        /// <summary>`m:ss.mmm`, which is how a lap time is read.</summary>
        private static string Clock(double seconds)
        {
            if (seconds < 0 || double.IsNaN(seconds)) return "--:--.---";

            int whole = (int)seconds;
            int minutes = whole / 60;
            int secs = whole % 60;
            int milli = (int)((seconds - whole) * 1000);

            return string.Format("{0}:{1:00}.{2:000}", minutes, secs, milli);
        }

        /// <summary>A gap or a sector: seconds and thousandths, no minutes.</summary>
        private static string Span(double seconds)
        {
            if (double.IsNaN(seconds)) return "—";
            return seconds.ToString("F3", System.Globalization.CultureInfo.InvariantCulture);
        }

        private static double Sum(System.Collections.Generic.IReadOnlyList<double> values, int upTo)
        {
            double total = 0;
            for (int i = 0; i < upTo && i < values.Count; i++) total += values[i];
            return total;
        }
    }
}
