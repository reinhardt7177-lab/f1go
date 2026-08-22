using UnityEngine;

namespace MumuF1.Game
{
    /// <summary>
    /// The sky, and the fog that ties the distance to it.
    /// </summary>
    /// <remarks>
    /// The first Unity build had neither, and the difference is not
    /// decoration. A near-black camera background with a lit circuit on it
    /// reads as a void with a hard line across the middle rather than as
    /// outdoors — which is the exact note the web version's scene file
    /// records about its own first attempt, and it arrived here again by
    /// being ported without this file.
    ///
    /// Three colours, banded rather than blended, from the web version.
    /// Banded because everything under them is toon-shaded: a smooth ramp
    /// over a drawn car reads as two different pictures in one frame. Pushed
    /// up in saturation from near-photographic values for the same reason —
    /// under flat shading a desaturated sky reads as overcast rather than as
    /// restrained, and cars that are flat colour inside a black line need a
    /// sky confident enough to sit against.
    /// </remarks>
    public static class Sky
    {
        public static readonly Color Zenith = Rgb(0x2c7ac9);
        public static readonly Color Middle = Rgb(0x74b6ef);
        public static readonly Color Horizon = Rgb(0xdcecf7);

        /// <summary>Bounce off the ground, for the ambient term.</summary>
        private static readonly Color Ground = Rgb(0x44502f);

        /// <summary>Where fog starts and ends (m).</summary>
        /// <remarks>
        /// Pushed a long way back. Fog is a photographic effect and works by
        /// hiding the horizon, not by hiding the circuit — at 400 m it ate
        /// the next corner, which is the one thing a driver has to see.
        /// </remarks>
        private const float FogStart = 700f;
        private const float FogEnd = 2600f;

        public static void Build(Transform parent, Camera camera)
        {
            RenderSettings.skybox = Dome();
            RenderSettings.sun = null;

            /* Trilight ambient rather than a flat colour, so the underside of
               a car picks up the grass and the top picks up the sky. It is
               the cheapest thing in rendering that makes a flat-shaded object
               look like it is somewhere. */
            RenderSettings.ambientMode = UnityEngine.Rendering.AmbientMode.Trilight;
            RenderSettings.ambientSkyColor = Middle;
            RenderSettings.ambientEquatorColor = Color.Lerp(Middle, Horizon, 0.5f);
            RenderSettings.ambientGroundColor = Ground;
            RenderSettings.ambientIntensity = 1f;

            RenderSettings.fog = true;
            RenderSettings.fogMode = FogMode.Linear;
            /* Tinted to the horizon band, which is what makes the distance
               dissolve into the sky instead of into a wall of grey. */
            RenderSettings.fogColor = Horizon;
            RenderSettings.fogStartDistance = FogStart;
            RenderSettings.fogEndDistance = FogEnd;

            if (camera != null)
            {
                camera.clearFlags = CameraClearFlags.Skybox;
                camera.backgroundColor = Horizon;
            }
        }

        /// <summary>
        /// A gradient skybox, generated.
        /// </summary>
        /// <remarks>
        /// Unity's own Procedural skybox wants a sun and produces a
        /// physically-modelled sky, which is the opposite of what a
        /// flat-shaded game wants. This paints the three bands into a small
        /// texture and hands it to the panoramic skybox shader instead —
        /// which needs no asset, no cubemap, and no import settings, and so
        /// can be authored as text like everything else here.
        ///
        /// Four pixels wide because nothing varies with heading; the height
        /// is the whole picture.
        /// </remarks>
        private static Material Dome()
        {
            const int h = 256;
            var texture = new Texture2D(4, h, TextureFormat.RGBA32, false)
            {
                name = "SkyGradient",
                wrapMode = TextureWrapMode.Clamp,
                filterMode = FilterMode.Bilinear,
                hideFlags = HideFlags.HideAndDontSave
            };

            var pixels = new Color32[4 * h];
            for (int y = 0; y < h; y++)
            {
                /* Row 0 is the bottom of a Unity texture and the bottom of a
                   panoramic map is straight down, so the bands are laid out
                   from the ground up: horizon for the lower half, then the
                   middle band, then the zenith. Reading the web version's
                   canvas gradient the other way round — where row 0 is the
                   top — is how the pale band ends up buried under the ground
                   and the sky becomes one flat blue meeting the grass at a
                   hard line. */
                float up = y / (float)(h - 1);

                Color band = up < 0.58f ? Horizon
                    : up < 0.74f ? Middle
                    : Zenith;

                for (int x = 0; x < 4; x++) pixels[y * 4 + x] = band;
            }

            texture.SetPixels32(pixels);
            texture.Apply();

            Shader panoramic = Shader.Find("Skybox/Panoramic");
            if (panoramic == null)
            {
                /* No skybox shader in the build. Rather than leave the camera
                   on whatever it had, fall back to a flat horizon fill, which
                   is still a sky-coloured world rather than a black one. */
                return null;
            }

            var material = new Material(panoramic) { hideFlags = HideFlags.HideAndDontSave };
            material.SetTexture("_MainTex", texture);
            material.SetFloat("_Mapping", 1f);       // latitude-longitude
            material.SetFloat("_ImageType", 0f);     // 360 degrees
            material.SetFloat("_Exposure", 1f);
            return material;
        }

        private static Color Rgb(int hex) => new Color(
            ((hex >> 16) & 0xFF) / 255f,
            ((hex >> 8) & 0xFF) / 255f,
            (hex & 0xFF) / 255f);
    }
}
