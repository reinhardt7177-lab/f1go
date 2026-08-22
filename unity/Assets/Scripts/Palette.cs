using UnityEngine;

namespace MumuF1.Game
{
    /// <summary>
    /// What colour a part of an imported model should actually be.
    /// </summary>
    /// <remarks>
    /// A pack keeps colour in one of two places, and the roadside used to
    /// decide between them by looking at the colour itself: a white or grey
    /// material meant the colour lived in a palette texture, and anything
    /// else was taken as chosen on purpose and kept. That rule is right about
    /// where the colour is and wrong about whether to trust it.
    ///
    /// Kenney's nature models are the counter-example, and they are in this
    /// game. `tree_oak.mtl` declares a material called `leafsGreen` whose
    /// diffuse value is 0.16, 0.79, 0.67 — mint, not green — and `woodBark`
    /// is 0.89, 0.51, 0.34, which is salmon, not bark. The models are meant
    /// to be drawn with the palette texture that ships beside them, and the
    /// `Kd` values in the material file were never the real colours. They are
    /// saturated, so the old rule read them as deliberate and kept them, and
    /// the result was a forest of mint lollipops on orange sticks.
    ///
    /// The *names* in those files are right where the values are wrong, which
    /// is what this uses. A material called something with "leaf" in it is
    /// foliage whatever number sits next to it, and gets the house green. The
    /// value is still the fallback, for a pack that names nothing recognisably
    /// and does carry real colours.
    ///
    /// It is a heuristic over somebody else's file, and it will not know
    /// every name. That is why the last resort is the house colour for the
    /// kind rather than anything read off the model: being one flat colour is
    /// a worse tree and a fine one, and being mint is neither.
    /// </remarks>
    public static class Palette
    {
        public static readonly Color Foliage = new Color(0.24f, 0.50f, 0.26f);
        public static readonly Color FoliageDark = new Color(0.17f, 0.38f, 0.22f);
        public static readonly Color Bark = new Color(0.35f, 0.25f, 0.17f);
        public static readonly Color Concrete = new Color(0.72f, 0.73f, 0.75f);
        public static readonly Color Asphalt = new Color(0.24f, 0.25f, 0.27f);
        public static readonly Color Warning = new Color(0.78f, 0.16f, 0.15f);
        public static readonly Color Glass = new Color(0.30f, 0.40f, 0.50f);
        public static readonly Color Chalk = new Color(0.90f, 0.91f, 0.93f);

        /// <summary>
        /// The colour for one material slot on an imported model.
        /// </summary>
        /// <param name="named">The material's name, as the pack wrote it.</param>
        /// <param name="own">Its diffuse value.</param>
        /// <param name="fallback">The house colour for the kind of thing it is part of.</param>
        public static Color ForPart(string named, Color own, Color fallback)
        {
            Color byName;
            if (Named(named, out byName)) return byName;

            /* Nothing recognisable in the name. Back to the old question,
               which is still the right one when there is nothing else to go
               on: white, black and grey are what a model wears when its
               colour lives in a texture, so they mean "use the house
               colour" and anything else is taken at face value. */
            return Paint.Deliberate(own) ? own : fallback;
        }

        private static bool Named(string named, out Color colour)
        {
            colour = default;
            if (string.IsNullOrEmpty(named)) return false;

            /* Lowercased and matched by substring, because Unity appends
               " (Instance)" to a material it has had to copy and packs are
               not consistent about case. */
            string n = named.ToLowerInvariant();

            if (Has(n, "leafsdark") || Has(n, "leavesdark")) { colour = FoliageDark; return true; }
            if (Has(n, "leaf") || Has(n, "leaves") || Has(n, "foliage")) { colour = Foliage; return true; }
            if (Has(n, "bark") || Has(n, "trunk") || Has(n, "wood")) { colour = Bark; return true; }
            if (Has(n, "glass") || Has(n, "window")) { colour = Glass; return true; }
            if (Has(n, "road") || Has(n, "asphalt") || Has(n, "tarmac")) { colour = Asphalt; return true; }
            if (Has(n, "red")) { colour = Warning; return true; }
            if (Has(n, "checker")) { colour = Chalk; return true; }
            if (Has(n, "grey") || Has(n, "gray") || Has(n, "concrete")) { colour = Concrete; return true; }

            /* Deliberately not matched: "colormap", "_defaultMat", "tankco".
               Those are the names a model wears when its colour is in a
               texture, and the caller's fallback is the right answer for
               them — which is what happens when nothing here matches. */
            return false;
        }

        private static bool Has(string haystack, string needle) =>
            haystack.IndexOf(needle, System.StringComparison.Ordinal) >= 0;
    }
}
