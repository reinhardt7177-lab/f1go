using UnityEngine;

namespace MumuF1.Game
{
    /// <summary>
    /// The one font this game draws with.
    /// </summary>
    /// <remarks>
    /// Named <c>Typeface</c> rather than the obvious <c>Ink</c>, because both
    /// surfaces that use it already have a private colour field called
    /// <c>Ink</c> — and a field hides a type of the same name inside its own
    /// class, so every call site read as <c>Color.Style(...)</c> and would
    /// not compile.
    /// </remarks>
    /// <remarks>
    /// Unity's built-in IMGUI font has no Hangul in it, and the failure is
    /// silent: the first playable build drew "F1 mumu" where it should have
    /// said "F1 mumu 리그", printed "made by" with nobody after it, and left
    /// the row of session buttons — 연습, 타임 트라이얼, 레이스 — as three
    /// boxes with nothing written on them. Nothing in the console, no missing
    /// asset, just absent text.
    ///
    /// So the font ships. It is Noto Sans KR, subset to exactly the
    /// characters the scripts contain — collected out of the string literals
    /// rather than listed by hand, so a new label cannot quietly reintroduce
    /// the same blank. That takes it from 4.6 MB to 68 KB, which is a
    /// reasonable thing to put in a build for the difference between a
    /// legible menu and an empty one.
    ///
    /// Loaded by path through <c>Resources</c>, like the music and the model
    /// kit, so there is no GUID for a moved file to break. Missing is
    /// survivable: the game falls back to the built-in font, which is exactly
    /// what it had before.
    /// </remarks>
    public static class Typeface
    {
        private const string Path = "NotoSansKR-Subset";

        private static Font _font;
        private static bool _looked;

        /// <summary>The game's font, or null to leave IMGUI on its own.</summary>
        public static Font Face
        {
            get
            {
                if (_looked) return _font;
                _looked = true;
                _font = Resources.Load<Font>(Path);
                return _font;
            }
        }

        /// <summary>A style in the game's font, centred or not.</summary>
        public static GUIStyle Style(int size, FontStyle weight, TextAnchor anchor)
        {
            var style = new GUIStyle(GUI.skin.label)
            {
                fontSize = size,
                fontStyle = weight,
                alignment = anchor,
                wordWrap = false
            };

            /* Left alone when the font is missing rather than set to null,
               which would draw nothing at all instead of falling back. */
            if (Face != null) style.font = Face;

            return style;
        }
    }
}
