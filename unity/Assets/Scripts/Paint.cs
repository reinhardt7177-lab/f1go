using UnityEngine;

namespace MumuF1.Game
{
    /// <summary>
    /// The one place that knows which shader this game is drawn with.
    /// </summary>
    /// <remarks>
    /// Nothing was bought for this. The asset store has good cel-shading
    /// packs and they were looked at, but the web version already knew
    /// exactly which thirty lines of HLSL it needed — including the two
    /// details that make an inverted-hull outline hold up — so
    /// `Assets/Shaders/MumuToon.shader` is that, ported. A dependency
    /// avoided is also a download avoided, which on WebGL is the whole
    /// argument.
    /// </remarks>
    public static class Paint
    {
        private static Shader _toon;

        /// <summary>The house shader, or the best thing available if it is missing.</summary>
        /// <remarks>
        /// Loaded out of <c>Resources</c>, not found by name, and that is the
        /// whole point. A build only contains shaders something in a build
        /// scene references, or that live in a <c>Resources</c> folder, or
        /// that are listed in Graphics Settings — and this project's only
        /// scene is deliberately empty, so <c>Shader.Find</c> came back null
        /// in the player while working perfectly in the editor.
        ///
        /// What that looked like was not a missing shader. It was a white
        /// circuit: the fallback ignores vertex colours, so tarmac, kerbs,
        /// run-off, grass and every painted line came out the same blank
        /// white, and the trees and grandstands with them. Nothing errored.
        ///
        /// Graphics Settings would be the other answer and is not available:
        /// it lives in a generated <c>ProjectSettings</c> file that refers to
        /// the shader by GUID, and this project keeps neither.
        ///
        /// <c>Shader.Find</c> stays as the fallback, because in the editor it
        /// works whatever folder the file is in. The two after it are
        /// built-in pipeline shaders now: the Universal one used to be here
        /// and was never going to help, because a project with no pipeline
        /// asset assigned does not run URP at all — which is the same reason
        /// the toon shader itself had to be rewritten.
        /// </remarks>
        public static Shader Toon =>
            _toon != null ? _toon : _toon =
                Resources.Load<Shader>("MumuToon")
                ?? Shader.Find("mumuF1/Toon")
                ?? Shader.Find("Diffuse")
                ?? Shader.Find("Standard");

        private static readonly System.Collections.Generic.Dictionary<int, Material> Cache =
            new System.Collections.Generic.Dictionary<int, Material>();

        /// <summary>
        /// The same as <see cref="Flat"/>, but one material per colour.
        /// </summary>
        /// <remarks>
        /// The roadside instantiates hundreds of models and each one may have
        /// several materials on it — a tree is bark and leaves. A fresh
        /// Material per slot would be a thousand of them, none of which can
        /// batch with any other, which is the difference between one draw
        /// call for a forest and one per tree. Colours are quantised to a
        /// byte per channel before they are looked up, because two greens
        /// that differ in the eighth decimal place are one green.
        /// </remarks>
        public static Material Shared(Color colour, float outline = 2.4f)
        {
            int key = (Mathf.RoundToInt(Mathf.Clamp01(colour.r) * 255) << 24)
                    | (Mathf.RoundToInt(Mathf.Clamp01(colour.g) * 255) << 16)
                    | (Mathf.RoundToInt(Mathf.Clamp01(colour.b) * 255) << 8)
                    | Mathf.RoundToInt(Mathf.Clamp01(outline) * 8);

            if (Cache.TryGetValue(key, out Material cached) && cached != null) return cached;

            Material made = Flat(colour, outline);
            Cache[key] = made;
            return made;
        }

        /// <summary>
        /// Whether a material's colour was chosen or merely left at a default.
        /// </summary>
        /// <remarks>
        /// A pack keeps colour in one of two places. Kenney's nature models
        /// name their materials and give them real diffuse values — bark is
        /// brown and leaves are green — and throwing that away to paint a
        /// whole tree one colour would give it a green trunk. Its racing and
        /// car models put the colour in a palette texture instead and leave
        /// the material white, and honouring *that* would paint everything
        /// white.
        ///
        /// White, black and grey are what a model has when its colour lives
        /// somewhere else, so they are the signal to fall back.
        /// </remarks>
        public static bool Deliberate(Color colour)
        {
            float high = Mathf.Max(colour.r, Mathf.Max(colour.g, colour.b));
            float low = Mathf.Min(colour.r, Mathf.Min(colour.g, colour.b));
            return high > 0.08f && high - low > 0.06f;
        }

        /// <summary>Flat colour inside a black line.</summary>
        public static Material Flat(Color colour, float outline = 2.4f)
        {
            var material = new Material(Toon);
            Set(material, colour, outline, fromVertices: false);
            return material;
        }

        /// <summary>
        /// The same, but taking its colour from the mesh's vertices —
        /// which is how the circuit is painted, so that tarmac, kerb,
        /// run-off and grass are one draw call rather than four.
        /// </summary>
        public static Material FromVertices(float outline = 0f)
        {
            var material = new Material(Toon);
            Set(material, Color.white, outline, fromVertices: true);
            return material;
        }

        private static void Set(Material m, Color colour, float outline, bool fromVertices)
        {
            if (m.HasProperty("_BaseColor")) m.SetColor("_BaseColor", colour);
            if (m.HasProperty("_OutlineWeight")) m.SetFloat("_OutlineWeight", outline);
            if (m.HasProperty("_UseVertexColor")) m.SetFloat("_UseVertexColor", fromVertices ? 1f : 0f);
            m.color = colour;
        }
    }
}
