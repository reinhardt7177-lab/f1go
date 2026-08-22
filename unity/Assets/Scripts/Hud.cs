using System;
using UnityEngine;

namespace MumuF1.Game
{
    /// <summary>
    /// The read-out: the rev bar, speed, gear, the timing tower and the
    /// five lights.
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
    /// What it draws was two grey boxes: a speed and a lap time, both true
    /// and neither of them telling you anything you could drive on. A racing
    /// read-out is not a list of numbers, it is three questions answered
    /// without being read — <em>should I change gear</em>, <em>am I quicker
    /// than last time</em>, <em>how did that lap go</em> — and each is
    /// answered here by a colour or a length rather than by a figure, because
    /// at two hundred and fifty kilometres an hour there is no time to read a
    /// figure. The rev bar has shift lights on it. The sector strip is
    /// coloured against your own best. The lap you just finished is thrown up
    /// in the middle of the screen for four seconds and then gets out of the
    /// way.
    ///
    /// Nothing here decides anything. Every number comes from
    /// <see cref="RaceDirector"/>, which gets them from the core, or from
    /// <see cref="CarController"/>, which gets them from the drivetrain.
    /// </remarks>
    public class Hud : MonoBehaviour
    {
        private RaceDirector _race;
        private CarController _car;

        // The house palette, from the web version's HUD.
        private static readonly Color Ink = new Color(0.95f, 0.96f, 0.98f);
        private static readonly Color Dim = new Color(0.58f, 0.63f, 0.70f);
        private static readonly Color Panel = new Color(0.04f, 0.05f, 0.07f, 0.78f);
        private static readonly Color Sunk = new Color(0.10f, 0.11f, 0.14f, 0.9f);
        private static readonly Color Shadow = new Color(0f, 0f, 0f, 0.55f);
        private static readonly Color Up = new Color(0.30f, 0.86f, 0.44f);
        private static readonly Color Down = new Color(0.96f, 0.42f, 0.38f);
        private static readonly Color Amber = new Color(0.99f, 0.74f, 0.16f);
        private static readonly Color LampOn = new Color(0.92f, 0.16f, 0.16f);
        private static readonly Color LampOff = new Color(0.13f, 0.11f, 0.12f);
        private static readonly Color House = new Color(0.88f, 0.16f, 0.13f);

        /// <summary>The best anyone has done here, in the colour it is always drawn.</summary>
        private static readonly Color Purple = new Color(0.71f, 0.36f, 1f);

        private Texture2D _white;

        /// <summary>The layout unit the styles were built for.</summary>
        private int _builtFor;

        private GUIStyle _speed;
        private GUIStyle _gear;
        private GUIStyle _value;
        private GUIStyle _label;
        private GUIStyle _tiny;
        private GUIStyle _banner;

        public static Hud Build(Transform parent, RaceDirector race, CarController car)
        {
            var go = new GameObject("HUD");
            go.transform.SetParent(parent);

            var hud = go.AddComponent<Hud>();
            hud._race = race;
            hud._car = car;
            return hud;
        }

        // ---- The lap that has just been driven -----------------------------

        private CompletedLap _shown;
        private bool _wasBest;
        private float _shownAt = -100f;

        /// <summary>How long a finished lap stays on screen (s).</summary>
        private const float BannerFor = 4.5f;

        /// <summary>
        /// Catch the lap on the frame it completes.
        /// </summary>
        /// <remarks>
        /// <c>JustFinished</c> is set for exactly one tick and overwritten on
        /// the next, so it has to be latched, and it has to be latched after
        /// the director has run. Script order is arbitrary between two
        /// <c>Update</c>s and defined between an <c>Update</c> and a
        /// <c>LateUpdate</c>, so this is a <c>LateUpdate</c>.
        /// </remarks>
        private void LateUpdate()
        {
            if (_race == null || _race.JustFinished == null) return;

            _shown = _race.JustFinished;
            _wasBest = _race.BeatTheRecord;
            _shownAt = Time.unscaledTime;
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

            /* Scaled off the short edge rather than a fixed point size. The
               same build runs on a phone held sideways and on a desktop
               window, and a HUD sized for one is unreadable or absurd on the
               other — and a phone can be *turned* while the game is running,
               which the first version of this did not survive: the styles
               were built once and kept, so rotating the device left the
               numbers at the size the other orientation had asked for. */
            int unit = Mathf.Max(12, Mathf.RoundToInt(Mathf.Min(Screen.width, Screen.height) / 22f));

            if (_speed != null && unit == _builtFor) return;
            _builtFor = unit;

            _speed = Typeface.Style(Mathf.RoundToInt(unit * 2.2f), FontStyle.Bold, TextAnchor.MiddleRight);
            _gear = Typeface.Style(Mathf.RoundToInt(unit * 2.1f), FontStyle.Bold, TextAnchor.MiddleCenter);
            /* Right-aligned, because a column of times is read down its last
               digit and a ragged right edge makes two lap times look
               different lengths. */
            _value = Typeface.Style(Mathf.RoundToInt(unit * 0.86f), FontStyle.Bold, TextAnchor.MiddleRight);
            _label = Typeface.Style(Mathf.RoundToInt(unit * 0.52f), FontStyle.Bold, TextAnchor.MiddleLeft);
            _tiny = Typeface.Style(Mathf.RoundToInt(unit * 0.46f), FontStyle.Bold, TextAnchor.MiddleCenter);
            _banner = Typeface.Style(Mathf.RoundToInt(unit * 1.05f), FontStyle.Bold, TextAnchor.MiddleCenter);
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

            DrawCluster(unit, pad);
            DrawTiming(unit, pad);
            DrawLights(unit);
            DrawBanner(unit);
            DrawDiagnostics(unit, pad);
        }

        // ---- The driver's cluster, bottom centre ---------------------------

        /// <summary>Lights on the rev bar.</summary>
        private const int Segments = 24;

        /// <summary>
        /// Where the rev bar starts, as a fraction of the limiter.
        /// </summary>
        /// <remarks>
        /// Just above the idle speed, and no higher. The engine idles at four
        /// thousand of its fifteen and never goes below, so a bar drawn from
        /// zero has its first quarter permanently lit and nothing to say.
        ///
        /// It was set at 0.55 on the theory that a shift-light strip only
        /// covers the top of the range, and measuring it killed that: at
        /// 5,200 rpm in second, accelerating hard out of a corner, the bar
        /// was completely dark. An instrument that reads empty through most
        /// of the range it is meant to describe is worse than no instrument,
        /// because the first thing it teaches is not to look at it. The
        /// shift point is carried by the colour bands instead, which is
        /// where it belongs.
        /// </remarks>
        private const float RevFloor = 0.27f;

        private void DrawCluster(float unit, float pad)
        {
            float w = unit * 15f;
            float h = unit * 4.3f;
            var box = new Rect((Screen.width - w) * 0.5f, Screen.height - h - pad * 0.7f, w, h);

            Fill(box, Panel);
            /* A bright edge along the top. It is what separates a panel from
               a dark patch of tarmac behind it. */
            Fill(new Rect(box.x, box.y, box.width, Mathf.Max(2f, unit * 0.05f)), House);

            DrawRevs(new Rect(box.x + pad, box.y + pad * 0.9f, box.width - pad * 2f, unit * 0.62f), unit);

            float row = box.y + unit * 1.9f;
            float rowHeight = unit * 2.1f;

            /* Speed, right-aligned, with its unit beside it rather than
               under it. Under it is where it was, and the number's own
               descender line is exactly where "KM/H" landed — at three
               digits the two were drawn through each other. Right-aligning
               also stops the number shifting sideways as it crosses from
               99 to 100. */
            double kmh = Math.Abs(_car.SpeedMs) * MathUtil.Kmh;
            var speedBox = new Rect(box.x + pad, row, unit * 4f, rowHeight);
            Text(speedBox, Mathf.RoundToInt((float)kmh).ToString(), _speed, Ink);
            Text(new Rect(speedBox.xMax + unit * 0.15f, row + rowHeight * 0.42f, unit * 1.5f, unit * 0.7f),
                "KM/H", _label, Dim);

            // The gear, on its own plate.
            var gearBox = new Rect(box.x + unit * 6.2f, row, unit * 2.1f, rowHeight);
            Fill(gearBox, Sunk);
            Fill(new Rect(gearBox.x, gearBox.y, gearBox.width, Mathf.Max(2f, unit * 0.05f)), Amber);
            /* Reverse is gear zero and neutral is not a gear the box has, so
               R and a number is the whole vocabulary. */
            Text(gearBox, _car.Gear == 0 ? "R" : _car.Gear.ToString(), _gear, Amber);

            DrawPedals(new Rect(box.x + unit * 8.9f, row + unit * 0.25f, unit * 2.9f, unit * 1.5f), unit);
            DrawEnergy(new Rect(box.xMax - pad - unit * 2.4f, row + unit * 0.25f, unit * 2.4f, unit * 1.5f), unit);
        }

        /// <summary>
        /// The rev bar, with shift lights on the end of it.
        /// </summary>
        /// <remarks>
        /// The one instrument a driver reads without looking. Green through
        /// amber to red along its length, and then the whole strip flashes
        /// when the limiter is reached — which is deliberately not just "the
        /// last segment goes red", because the thing being signalled is not
        /// "nearly there", it is <em>change gear now, you are losing time
        /// every metre</em>, and a change in kind carries that where a change
        /// in degree does not.
        /// </remarks>
        private void DrawRevs(Rect bar, float unit)
        {
            double redline = Math.Max(1.0, _car.Redline);
            float floor = (float)redline * RevFloor;
            float span = (float)redline - floor;
            float revs = Mathf.Clamp01(((float)_car.EngineRpm - floor) / Mathf.Max(1f, span));

            bool limiter = _car.EngineRpm >= redline * 0.995;
            bool flash = limiter && Mathf.Repeat(Time.unscaledTime * 10f, 1f) < 0.55f;

            float gap = Mathf.Max(1f, unit * 0.06f);
            float width = (bar.width - gap * (Segments - 1)) / Segments;

            Fill(new Rect(bar.x - gap, bar.y - gap, bar.width + gap * 2f, bar.height + gap * 2f), Sunk);

            for (int i = 0; i < Segments; i++)
            {
                float at = (i + 1) / (float)Segments;
                Color colour;

                if (flash) colour = new Color(0.62f, 0.80f, 1f);
                else if (at > revs) colour = new Color(0.15f, 0.16f, 0.19f);
                else if (at > 0.86f) colour = LampOn;
                else if (at > 0.62f) colour = Amber;
                else colour = Up;

                Fill(new Rect(bar.x + (width + gap) * i, bar.y, width, bar.height), colour);
            }
        }

        /// <summary>Throttle and brake, as two bars that fill from the left.</summary>
        /// <remarks>
        /// On a phone the pedals are analogue by travel and there is no
        /// pedal to look at, so how much of one you are actually asking for
        /// is otherwise unknowable — and "I thought I had lifted" is most of
        /// what goes wrong in a corner.
        /// </remarks>
        private void DrawPedals(Rect box, float unit)
        {
            float h = (box.height - unit * 0.2f) * 0.5f;

            Bar(new Rect(box.x, box.y, box.width, h), (float)_car.Controls.Throttle, Up);
            Bar(new Rect(box.x, box.y + h + unit * 0.2f, box.width, h), (float)_car.Controls.Brake, Down);
        }

        /// <summary>The energy store, and whether it is being spent.</summary>
        private void DrawEnergy(Rect box, float unit)
        {
            float h = box.height * 0.46f;

            Bar(new Rect(box.x, box.y, box.width, h), (float)_car.Energy,
                _car.Deploying ? Purple : new Color(0.25f, 0.62f, 0.95f));

            Text(new Rect(box.x, box.y + h + unit * 0.1f, box.width, unit * 0.7f),
                _car.Deploying ? "OVERTAKE" : "ERS", _tiny,
                _car.Deploying ? Purple : Dim);
        }

        private void Bar(Rect box, float fill, Color colour)
        {
            Fill(box, Sunk);
            Fill(new Rect(box.x, box.y, box.width * Mathf.Clamp01(fill), box.height), colour);
        }

        // ---- Timing, top left --------------------------------------------

        private void DrawTiming(float unit, float pad)
        {
            LapTimer timer = _race.Timer;
            SessionState state = _race.Session.State(timer);

            /* Measured off the font rather than assumed. The rows used a
               fraction of the layout unit, which was right for the built-in
               face and wrong the moment a real one shipped: Noto sits taller
               in its line box, so every value was clipped against the row
               above it and the top row against the panel. A style knows how
               tall its own line is; asking it costs nothing and cannot go
               stale when the font changes again. */
            float line = Mathf.Max(unit * 1.05f, _value.lineHeight * 1.18f);

            /* Wide enough for the widest thing that goes in it, which is a
               lap time with a sign on it, not the label. */
            float w = Mathf.Max(unit * 8.6f, _value.CalcSize(new GUIContent("+00.000")).x + unit * 4.4f);

            int rows = 3;
            if (_race.Field != null) rows++;
            if (_race.Ghost != null) rows++;

            float header = unit * 0.9f;
            float strip = line * 0.92f;
            var box = new Rect(pad, pad, w, header + line * rows + strip + pad * 0.8f);

            Fill(box, Panel);
            /* The house stripe down the left edge. Every broadcast timing
               graphic has one and it is not decoration: it is what makes a
               dark panel read as a card laid on the picture rather than as a
               hole in it. */
            Fill(new Rect(box.x, box.y, Mathf.Max(3f, unit * 0.12f), box.height), House);

            float inset = box.x + Mathf.Max(3f, unit * 0.12f) + unit * 0.45f;
            float right = box.xMax - unit * 0.45f;

            Text(new Rect(inset, box.y + unit * 0.1f, w, header), Title(state), _label, Dim);

            float y = box.y + header;

            Row(inset, right, ref y, line, "LAP",
                state.LapsTotal == null
                    ? timer.Lap.ToString()
                    : timer.Lap + " / " + state.LapsTotal.Value,
                Ink);

            /* The running clock is the biggest number here and the only one
               that changes every frame, so it is the one that goes off-white
               when a lap has been thrown away by cutting. */
            Row(inset, right, ref y, line, "TIME", Clock(timer.LapTime), _race.OnTrack ? Ink : Down);

            Row(inset, right, ref y, line, "BEST",
                timer.BestLap == null ? "--:--.---" : Clock(timer.BestLap.Time),
                timer.BestLap == null ? Dim : Purple);

            if (_race.Field != null)
            {
                Row(inset, right, ref y, line, "POS",
                    _race.Position + " / " + (_race.Field.Rivals.Count + 1), Ink);
            }

            if (_race.Ghost != null)
            {
                /* Null before the ghost reached here, which is the honest
                   answer rather than a clamped zero — and it is what the
                   first corner of a first lap actually looks like. */
                double? delta = _race.GhostDelta;
                Row(inset, right, ref y, line, "GHOST",
                    delta == null ? "—" : (delta.Value >= 0 ? "+" : "") + Span(delta.Value),
                    delta == null ? Dim : (delta.Value <= 0 ? Up : Down));
            }

            DrawSectors(new Rect(inset, y + line * 0.1f, right - inset, strip * 0.7f), unit, timer);
        }

        /// <summary>
        /// The three sectors, as blocks coloured against your own best.
        /// </summary>
        /// <remarks>
        /// This is the single thing a lap time cannot tell you: <em>where</em>
        /// it went. A lap two tenths down is a shrug; a lap two tenths down
        /// with a purple first sector and a yellow last one is a corner to go
        /// and work on. Purple is the convention for a best and it is used
        /// for a best here — there is no field-wide timing in this game, so
        /// the best that exists is your own.
        /// </remarks>
        private void DrawSectors(Rect box, float unit, LapTimer timer)
        {
            int count = Mathf.Max(1, timer.BestSectors.Count);
            float gap = unit * 0.18f;
            float w = (box.width * 0.62f - gap * (count - 1)) / count;

            for (int i = 0; i < count; i++)
            {
                Color colour;

                if (i > timer.Sector || i >= timer.CurrentSectors.Count)
                {
                    // Not run yet on this lap.
                    colour = i == timer.Sector ? Amber : new Color(0.17f, 0.18f, 0.22f);
                }
                else
                {
                    double best = timer.BestSectors[i];
                    double now = timer.CurrentSectors[i];
                    colour = best <= 0 || now <= best ? Purple : Up;
                    if (best > 0 && now > best * 1.01) colour = Amber;
                }

                Fill(new Rect(box.x + (w + gap) * i, box.y, w, box.height), colour);
            }

            Text(new Rect(box.x, box.y - unit * 0.15f, box.width, box.height + unit * 0.3f),
                "S" + (timer.Sector + 1) + "  " + Span(Running(timer)), _value, Dim);
        }

        /// <summary>Time spent in the sector now being driven.</summary>
        private static double Running(LapTimer timer)
        {
            double before = 0;
            for (int i = 0; i < timer.Sector && i < timer.CurrentSectors.Count; i++)
            {
                before += timer.CurrentSectors[i];
            }
            return timer.LapTime - before;
        }

        private void Row(float left, float right, ref float y, float line, string label, string value, Color colour)
        {
            Text(new Rect(left, y, right - left, line), label, _label, Dim);
            Text(new Rect(left, y, right - left, line), value, _value, colour);
            y += line;
        }

        /// <summary>What this session is, in the corner of its own card.</summary>
        private static string Title(SessionState state)
        {
            switch (state.Kind)
            {
                case SessionKind.Race:
                    return state.LapsTotal == null ? "RACE" : "RACE  " + state.LapsTotal.Value + " LAPS";
                case SessionKind.Qualifying: return "QUALIFYING";
                case SessionKind.TimeTrial: return "TIME TRIAL";
                default: return "PRACTICE";
            }
        }

        // ---- The lap you have just finished --------------------------------

        private void DrawBanner(float unit)
        {
            if (_shown == null) return;

            float age = Time.unscaledTime - _shownAt;
            if (age > BannerFor) return;

            /* Fades out over its last three-quarters of a second rather than
               vanishing, because something disappearing in the corner of the
               eye at speed reads as a glitch. */
            float alpha = Mathf.Clamp01((BannerFor - age) / 0.75f);

            float w = unit * 13f;
            float h = unit * 2.4f;
            var box = new Rect((Screen.width - w) * 0.5f, Screen.height * 0.24f, w, h);

            Color bed = _wasBest ? new Color(0.30f, 0.12f, 0.44f, 0.88f) : Panel;
            Fill(box, Fade(bed, alpha));
            Fill(new Rect(box.x, box.y, box.width, Mathf.Max(2f, unit * 0.06f)),
                Fade(_wasBest ? Purple : House, alpha));

            Text(new Rect(box.x, box.y + unit * 0.15f, box.width, unit * 0.9f),
                _wasBest ? "PERSONAL BEST" : (_shown.Valid ? "LAP " + _shown.Number : "LAP DELETED"),
                _tiny, Fade(_wasBest ? Purple : (_shown.Valid ? Dim : Down), alpha));

            Text(new Rect(box.x, box.y + unit * 0.95f, box.width, unit * 1.3f),
                Clock(_shown.Time), _banner,
                Fade(_wasBest ? Purple : (_shown.Valid ? Ink : Dim), alpha));
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

        /// <summary>
        /// What the car is actually doing, on a key.
        /// </summary>
        /// <remarks>
        /// Added because a build showed a stationary car with the throttle
        /// held and nothing to say why. Everything a guess would have been
        /// about is on one line: whether the input arrived, whether the
        /// engine is making anything of it, whether the wheels are touching
        /// the road, and what the tyres are being asked to carry.
        ///
        /// Off by default and on `F3`, because it is an instrument rather
        /// than part of the game.
        /// </remarks>
        private void DrawDiagnostics(float unit, float pad)
        {
            if (Input.GetKeyDown(KeyCode.F3) && Event.current.type == EventType.KeyDown)
            {
                _diagnostics = !_diagnostics;
            }

            if (!_diagnostics) return;

            var line = string.Format(
                "thr {0:F2}  brk {1:F2}  str {2:+0.00;-0.00; 0.00}  |  " +
                "rpm {3:F0}  gear {4}  |  grounded {5}/4  load {6:F0} N  slip {7:F2}  " +
                "tc {15}  grip {16:F2} {17:F0}\u00b0C  |  tq {18:F0}  f {19:F0} N  |  " +
                "ray {9:F2}  down {11:F2} {13}  |  {8:F1} m/s",
                _car.Controls.Throttle, _car.Controls.Brake, _car.Controls.Steer,
                _car.EngineRpm, _car.Gear,
                _car.GroundedWheels, _car.TotalLoad, _car.DrivenSlip, _car.SpeedMs,
                _car.RayDistance, _car.RayFacing,
                _car.ProbeDown, _car.ProbeUp, _car.ProbeHit,
                _car.transform.position.y,
                _car.Aids ? _car.ThrottleLimit.ToString("F2") : "off",
                _car.DrivenGrip, _car.DrivenTemp,
                _car.DrivenTorque, _car.DrivenForce);

            var box = new Rect(pad, Screen.height - unit * 6.1f, Screen.width - pad * 2, unit * 1.1f);
            Fill(box, Panel);
            Text(new Rect(box.x + pad, box.y, box.width, box.height), line, _label, Amber);
        }

        private bool _diagnostics;

        // ---- Drawing ---------------------------------------------------------

        private static Color Fade(Color c, float alpha) => new Color(c.r, c.g, c.b, c.a * alpha);

        private void Fill(Rect r, Color c)
        {
            Color was = GUI.color;
            GUI.color = c;
            GUI.DrawTexture(r, _white);
            GUI.color = was;
        }

        /// <summary>
        /// A label, on its own shadow.
        /// </summary>
        /// <remarks>
        /// The one line of this file that is worth more than the rest of it
        /// put together. A HUD is drawn over a picture it does not control,
        /// and pale text over a pale kerb is not dim, it is gone. A black
        /// copy a pixel down and right costs one more draw call and makes
        /// every number legible against every surface this game has.
        /// </remarks>
        private static void Text(Rect r, string s, GUIStyle style, Color colour)
        {
            Color was = style.normal.textColor;

            float lift = Mathf.Max(1f, style.fontSize * 0.05f);
            style.normal.textColor = new Color(0f, 0f, 0f, Shadow.a * colour.a);
            GUI.Label(new Rect(r.x + lift, r.y + lift, r.width, r.height), s, style);

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
    }
}
