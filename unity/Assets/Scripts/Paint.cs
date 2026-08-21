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
        public static Shader Toon =>
            _toon != null ? _toon : _toon =
                Shader.Find("mumuF1/Toon")
                ?? Shader.Find("Universal Render Pipeline/Lit")
                ?? Shader.Find("Standard");

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
