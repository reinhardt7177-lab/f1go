using UnityEngine;

namespace MumuF1.Game
{
    /// <summary>
    /// The card in front of everything, until somebody presses start.
    /// </summary>
    /// <remarks>
    /// It is not decoration. The session does not begin until this is
    /// dismissed — not the clock, not the five lights, not track limits —
    /// which is a stronger claim than the grid makes and the reason
    /// <see cref="Session.Begin"/> exists separately from the constructor.
    /// The web version learned it the hard way: the countdown ran behind the
    /// card, so you tapped to find yourself already several seconds late off
    /// a grid you never saw.
    ///
    /// It is also where the circuit and the session kind are chosen, because
    /// this is the only moment at which changing either is free — nothing has
    /// been timed yet, so tearing the world down and building another costs
    /// nobody anything.
    /// </remarks>
    public class TitleCard : MonoBehaviour
    {
        private static readonly string[] Circuits =
        {
            "oval", "redbullring", "interlagos", "monza", "proving"
        };

        private static readonly string[] CircuitNames =
        {
            "Practice Oval", "Red Bull Ring", "Interlagos", "Monza", "Proving Ground"
        };

        private static readonly SessionKind[] Kinds =
        {
            SessionKind.Practice, SessionKind.TimeTrial, SessionKind.Race
        };

        /* Korean, matching the web version's card. The rest of the interface
           is numbers and place names, which need no translation. */
        private static readonly string[] KindNames = { "연습", "타임 트라이얼", "레이스" };

        /// <summary>
        /// True while a card is up anywhere.
        /// </summary>
        /// <remarks>
        /// Static because there is exactly one, and because the HUD needs to
        /// know without holding a reference — it is built before the card is
        /// and would otherwise need the two wired together in an order that
        /// exists for no other reason.
        /// </remarks>
        public static bool Up { get; private set; }

        private RaceDirector _race;
        private bool _dismissed;

        private Texture2D _white;
        private GUIStyle _title, _maker, _button, _chosen, _start, _hint;

        private static readonly Color Ink = new Color(0.93f, 0.95f, 0.97f);
        private static readonly Color Dim = new Color(0.55f, 0.60f, 0.66f);
        private static readonly Color Veil = new Color(0.02f, 0.03f, 0.04f, 0.55f);
        private static readonly Color Slab = new Color(0.10f, 0.11f, 0.13f, 0.95f);
        private static readonly Color Red = new Color(0.85f, 0.09f, 0.11f);

        public static TitleCard Build(Transform parent, RaceDirector race)
        {
            var go = new GameObject("Title");
            go.transform.SetParent(parent);

            var card = go.AddComponent<TitleCard>();
            card._race = race;
            Up = true;
            return card;
        }

        /// <summary>True while the card is up, so the HUD can stay out of the way.</summary>
        public bool Showing => !_dismissed;

        private void EnsureStyles(float unit)
        {
            if (_white == null)
            {
                _white = new Texture2D(1, 1) { hideFlags = HideFlags.HideAndDontSave };
                _white.SetPixel(0, 0, Color.white);
                _white.Apply();
            }

            if (_title != null) return;

            int u = Mathf.RoundToInt(unit);

            _title = Centred(u * 2, FontStyle.Bold);
            _maker = Centred(Mathf.RoundToInt(u * 0.55f), FontStyle.Normal);
            _button = Centred(Mathf.RoundToInt(u * 0.7f), FontStyle.Bold);
            _chosen = Centred(Mathf.RoundToInt(u * 0.7f), FontStyle.Bold);
            _start = Centred(Mathf.RoundToInt(u * 1.3f), FontStyle.Bold);
            _hint = Centred(Mathf.RoundToInt(u * 0.5f), FontStyle.Normal);
        }

        private static GUIStyle Centred(int size, FontStyle weight) =>
            Typeface.Style(size, weight, TextAnchor.MiddleCenter);

        private void OnGUI()
        {
            if (_dismissed) return;

            /* Scaled off the short edge, like the HUD. The same build runs on
               a phone held sideways and in a desktop window, and a card sized
               for one is unreadable or absurd on the other. */
            float unit = Mathf.Max(14f, Mathf.Min(Screen.width, Screen.height) / 20f);
            EnsureStyles(unit);

            /* Over the live world rather than over black, so the circuit you
               are about to drive is the thing behind the menu. */
            Fill(new Rect(0, 0, Screen.width, Screen.height), Veil);

            float mid = Screen.width * 0.5f;
            float y = Screen.height * 0.18f;

            Text(new Rect(0, y, Screen.width, unit * 2.4f), "F1 mumu 리그", _title, Ink);
            y += unit * 2.6f;
            Text(new Rect(0, y, Screen.width, unit), "made by 불곰코끼리그리거", _maker, Dim);
            y += unit * 1.6f;

            y = Row(y, unit, mid, CircuitNames, IndexOf(Circuits, TrackBuilder.CircuitId),
                (i) =>
                {
                    if (TrackBuilder.CircuitId == Circuits[i]) return;
                    TrackBuilder.CircuitId = Circuits[i];

                    /* Rebuilt now rather than on start, so the card sits in
                       front of the circuit it is offering. */
                    Bootstrap.Rebuild();
                });

            y = Row(y, unit, mid, KindNames, IndexOf(Kinds, RaceDirector.Kind),
                (i) =>
                {
                    if (RaceDirector.Kind == Kinds[i]) return;
                    RaceDirector.Kind = Kinds[i];
                    Bootstrap.Rebuild();
                });

            y += unit * 0.4f;

            float sw = unit * 7f;
            float sh = unit * 2f;
            var startAt = new Rect(mid - sw * 0.5f, y, sw, sh);

            Fill(startAt, Red);
            Text(startAt, "START", _start, Ink);

            if (Clicked(startAt)) Dismiss();

            y += sh + unit * 0.8f;

            /* `Input.touchSupported` used to be part of this and should not
               have been. Every Chromium exposes touch events whether or not
               anything can touch it, so a laptop was being told where to put
               its thumbs. The platform is the honest question: a machine with
               a keyboard is better served by the keyboard hint even when it
               also has a touchscreen, and the pads draw themselves the moment
               a finger actually lands. */
            Text(new Rect(0, y, Screen.width, unit),
                Application.isMobilePlatform
                    ? "왼쪽 엄지 조향 · 오른쪽 엄지 위 스로틀 / 아래 브레이크"
                    : "A D 또는 ← → 조향 · W 스로틀 · S 브레이크 · T 트랙션 · R 리셋",
                _hint, Dim);
        }

        /// <summary>A row of choices, one of them lit.</summary>
        private float Row(float y, float unit, float mid, string[] labels, int chosen,
            System.Action<int> pick)
        {
            float h = unit * 1.4f;
            float gap = unit * 0.25f;

            /* Measured, not divided. The names are different lengths — "Monza"
               against "Red Bull Ring" — and equal boxes would leave one
               cramped and the other half empty. */
            var widths = new float[labels.Length];
            float total = 0;
            for (int i = 0; i < labels.Length; i++)
            {
                widths[i] = Mathf.Max(unit * 2.6f, _button.CalcSize(new GUIContent(labels[i])).x + unit);
                total += widths[i] + (i > 0 ? gap : 0);
            }

            /* One row if it fits, otherwise wrapped — a phone in portrait
               cannot hold five circuit names across. */
            float maxRow = Screen.width * 0.94f;
            float x = mid - Mathf.Min(total, maxRow) * 0.5f;
            float rowTop = y;

            for (int i = 0; i < labels.Length; i++)
            {
                if (x + widths[i] > mid + maxRow * 0.5f && i > 0)
                {
                    y += h + gap;
                    x = mid - Mathf.Min(total, maxRow) * 0.5f;
                }

                var at = new Rect(x, y, widths[i], h);
                bool lit = i == chosen;

                Fill(at, lit ? Red : Slab);
                Text(at, labels[i], lit ? _chosen : _button, lit ? Ink : Dim);

                if (Clicked(at)) pick(i);

                x += widths[i] + gap;
            }

            return y + h + unit * 0.5f + (y - rowTop) * 0;
        }

        /// <summary>
        /// A press inside a rectangle, from a mouse or a finger.
        /// </summary>
        /// <remarks>
        /// Not <c>GUI.Button</c>, because everything else on this card is
        /// drawn rather than skinned and a default-skinned button in the
        /// middle of it would look like it came from somewhere else. The test
        /// is the same one the touch driver uses — geometry — and it reads
        /// touches directly so a tap works before Unity has decided whether
        /// to synthesise a mouse event for it.
        /// </remarks>
        private static bool Clicked(Rect area)
        {
            Event e = Event.current;
            if (e != null && e.type == EventType.MouseDown && area.Contains(e.mousePosition))
            {
                e.Use();
                return true;
            }

            for (int i = 0; i < Input.touchCount; i++)
            {
                Touch t = Input.GetTouch(i);
                if (t.phase != TouchPhase.Began) continue;

                // Touch coordinates start at the bottom left; GUI at the top.
                var at = new Vector2(t.position.x, Screen.height - t.position.y);
                if (area.Contains(at)) return true;
            }

            return false;
        }

        private void Dismiss()
        {
            _dismissed = true;
            Up = false;

            /* The one call that starts everything. Until now the session has
               been constructed and inert. */
            if (_race != null && _race.Session != null) _race.Session.Begin();

            /* And the soundtrack, here rather than at startup, because this
               press is the user gesture every browser insists on before it
               will let a page make a sound. Called on Awake it gets a
               suspended audio context and silence for the whole session. */
            Music.Begin();
        }

        private static int IndexOf<T>(T[] all, T value)
        {
            for (int i = 0; i < all.Length; i++)
            {
                if (Equals(all[i], value)) return i;
            }

            return 0;
        }

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
    }
}
