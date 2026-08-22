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

            /* No skybox. The first attempt built one out of
               `Shader.Find("Skybox/Panoramic")` and got a flat grey sky,
               because a shader reached for by name at runtime is not
               referenced by anything the build can see and is stripped —
               precisely the way the toon shader was stripped before it was
               moved into Resources. Rather than find somewhere to declare a
               second shader, the sky is a *thing in the world*, drawn with
               the shader this project already ships. */
            RenderSettings.skybox = null;

            if (camera != null)
            {
                /* Cleared to a solid colour rather than to a skybox that is
                   not there. The dome below covers every direction the camera
                   can look, so this shows only on the frame it fails — and a
                   pale horizon is a much better failure than black. */
                camera.clearFlags = CameraClearFlags.SolidColor;
                camera.backgroundColor = Horizon;
            }

            Dome(parent);
        }

        /// <summary>
        /// A graded sky, as a sphere seen from inside.
        /// </summary>
        /// <remarks>
        /// The same shape the web version uses, and for the reason it gives:
        /// a background is painted flat behind everything and cannot put the
        /// pale band on the horizon and the deep blue overhead. A dome can,
        /// because it has an up.
        ///
        /// Banded rather than blended, to match the shading on everything
        /// under it — a smooth ramp over a drawn car reads as two different
        /// pictures in one frame.
        ///
        /// It is unlit, unfogged and drawn before everything else. Fogging it
        /// would be fogging the thing the fog is tinted to.
        /// </remarks>
        private static void Dome(Transform parent)
        {
            var go = new GameObject("Sky");
            go.transform.SetParent(parent);

            /* Big enough to sit outside the far scenery and inside the
               camera's far plane, which is 4 km. */
            const float radius = 3600f;

            var mesh = new Mesh { name = "SkyDome" };

            const int rings = 24;
            const int segments = 32;

            var vertices = new Vector3[(rings + 1) * (segments + 1)];
            var colours = new Color[vertices.Length];
            var triangles = new int[rings * segments * 6];

            for (int y = 0; y <= rings; y++)
            {
                /* From straight down to straight up. */
                float v = y / (float)rings;
                float polar = Mathf.PI * (1f - v);
                float sinP = Mathf.Sin(polar);
                float cosP = Mathf.Cos(polar);

                /* The bands, in the order they are seen from the ground:
                   pale to the horizon, then a middle blue, then the zenith.
                   Repeated at each boundary so the step is hard. */
                Color band = v < 0.52f ? Horizon
                    : v < 0.58f ? Middle
                    : v < 0.74f ? Middle
                    : Zenith;

                for (int x = 0; x <= segments; x++)
                {
                    float u = x / (float)segments;
                    float azimuth = u * Mathf.PI * 2f;

                    int i = y * (segments + 1) + x;
                    vertices[i] = new Vector3(
                        radius * sinP * Mathf.Cos(azimuth),
                        radius * cosP,
                        radius * sinP * Mathf.Sin(azimuth));
                    colours[i] = band;
                }
            }

            int t = 0;
            for (int y = 0; y < rings; y++)
            {
                for (int x = 0; x < segments; x++)
                {
                    int a = y * (segments + 1) + x;
                    int b = a + segments + 1;

                    /* Wound inwards, because this is seen from inside. The
                       outward winding draws a sphere that is invisible from
                       every point the camera can ever be. */
                    triangles[t++] = a;
                    triangles[t++] = a + 1;
                    triangles[t++] = b;

                    triangles[t++] = a + 1;
                    triangles[t++] = b + 1;
                    triangles[t++] = b;
                }
            }

            mesh.vertices = vertices;
            mesh.colors = colours;
            mesh.triangles = triangles;
            mesh.RecalculateNormals();
            /* Told its own size rather than made to work it out, because a
               sphere centred on the origin has no bounds Unity can infer that
               would not cull it the moment the car drives away from the
               middle of the circuit. */
            mesh.bounds = new Bounds(Vector3.zero, Vector3.one * radius * 4f);

            go.AddComponent<MeshFilter>().sharedMesh = mesh;

            MeshRenderer renderer = go.AddComponent<MeshRenderer>();
            renderer.sharedMaterial = Paint.FromVertices(0f);
            renderer.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            renderer.receiveShadows = false;

            /* Drawn first, so everything else lands on top of it whatever
               order the renderer would otherwise pick. */
            renderer.sharedMaterial.renderQueue = 1000;

            /* Carried with the camera, so a sphere of finite radius never
               runs out. The circuits are kilometres across and this is
               3.6 km; without it, driving to the far end of Monza puts the
               car through the wall of the sky. */
            go.AddComponent<SkyFollowsCamera>();
        }

        private static Color Rgb(int hex) => new Color(
            ((hex >> 16) & 0xFF) / 255f,
            ((hex >> 8) & 0xFF) / 255f,
            (hex & 0xFF) / 255f);
    }

    /// <summary>
    /// Keeps the sky centred on whatever is looking at it.
    /// </summary>
    /// <remarks>
    /// A dome of finite radius is a wall if it stays put. These circuits are
    /// kilometres across and this one is 3.6 km, so driving to the far end of
    /// Monza would take the car through it. Following the camera in
    /// <c>LateUpdate</c> — after the chase camera has moved — means the sky is
    /// always exactly as far away as it was a frame ago, which is what a sky
    /// is.
    ///
    /// Position only. Rotating it would drag the horizon band around with the
    /// car.
    /// </remarks>
    public class SkyFollowsCamera : MonoBehaviour
    {
        private Transform _eye;

        private void LateUpdate()
        {
            if (_eye == null)
            {
                Camera main = Camera.main;
                if (main == null)
                {
                    Camera[] all = Camera.allCameras;
                    if (all.Length == 0) return;
                    main = all[0];
                }

                _eye = main.transform;
            }

            transform.position = _eye.position;
        }
    }
}
