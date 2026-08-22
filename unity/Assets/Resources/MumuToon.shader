// Cartoon shading, ported from the web version's `render/toon.ts`.
//
// Two pieces make a drawing rather than a photograph: light that lands
// in a few flat bands instead of a smooth falloff, and a black line
// around the silhouette. Both are here, in two passes of one shader,
// and nothing else in the project needs to know how either works.
//
// The line is the important half. A racing game asks one question of its
// graphics twenty times a lap — *which car is that, and how far ahead is
// it* — and a photographic renderer answers it badly: at two hundred
// metres, through fog, a red car and an orange one are the same grey
// smear. Flat colour inside a black outline is still legible at forty
// pixels wide, which is what a rival looks like at the far end of a
// straight.
//
// The outline is an inverted hull: the same mesh drawn back-face-only,
// pushed out along its normals, in black. Everything the hull covers is
// overdrawn by the model itself, and what survives is a rim of exactly
// the thickness it was pushed by.
//
// ## Built-in, not URP, and why that is not a downgrade
//
// This was written against the Universal pipeline and rendered every
// object in the game bright magenta, which is Unity's way of saying a
// shader produced no usable subshader. URP is in the package manifest,
// but a project only *uses* it when a pipeline asset is assigned in
// Graphics Settings — and this project keeps no generated settings
// files, because they are large diffs of defaults that refer to
// everything by GUID and cannot be reviewed as text. So the game runs on
// the built-in pipeline, the URP subshader was skipped for not matching
// it, the fallback was also URP and was skipped too, and nothing was
// left.
//
// Writing it for built-in costs nothing here. There is no lightmapping,
// no reflection probe, no post-processing stack: the whole look is one
// directional light quantised into four bands over flat colour. What it
// buys is a shader that needs no project-wide state to work, which is
// the same reason the scene is empty and the world is built from code.

Shader "mumuF1/Toon"
{
    Properties
    {
        _BaseColor ("Colour", Color) = (0.8, 0.1, 0.1, 1)
        _Bands ("Bands of light", Range(2, 8)) = 4
        _Floor ("Darkest band", Range(0, 1)) = 0.42
        _Knee ("Highlight knee", Range(0.4, 1)) = 0.75
        _OutlineWeight ("Outline weight (px at 1080)", Range(0, 12)) = 2.4
        _OutlineColor ("Outline colour", Color) = (0, 0, 0, 1)
        [Toggle] _UseVertexColor ("Colour from vertices", Float) = 0
    }

    SubShader
    {
        Tags { "RenderType" = "Opaque" "Queue" = "Geometry" }

        // ---- The outline, first: an inverted hull ----------------------
        Pass
        {
            Name "Outline"
            Cull Front
            ZWrite On

            CGPROGRAM
            #pragma vertex OutlineVertex
            #pragma fragment OutlineFragment
            #pragma multi_compile_fog
            #include "UnityCG.cginc"

            float4 _OutlineColor;
            float _OutlineWeight;

            struct appdata
            {
                float4 vertex : POSITION;
                float3 normal : NORMAL;
            };

            struct v2f
            {
                float4 pos : SV_POSITION;
                UNITY_FOG_COORDS(0)
            };

            v2f OutlineVertex(appdata v)
            {
                v2f o;

                /* Pushed out in *clip* space rather than in the model's,
                   so the rim is a constant width on screen instead of
                   growing and shrinking with distance. A hull expanded in
                   object space vanishes on a car at the end of a straight,
                   which is the one place the outline is doing all the
                   work. */
                float4 clip = UnityObjectToClipPos(v.vertex);
                float3 normalVS = mul((float3x3)UNITY_MATRIX_IT_MV, v.normal);
                float2 offset = normalize(normalVS.xy);

                /* Against the projection's own scale, so field of view and
                   aspect ratio do not change the thickness either. The
                   1080 in the property name is what the weight is quoted
                   against; the division carries it to whatever the screen
                   actually is. */
                clip.xy += offset * (_OutlineWeight / 1080.0) * clip.w * 2.0;

                o.pos = clip;
                UNITY_TRANSFER_FOG(o, o.pos);
                return o;
            }

            fixed4 OutlineFragment(v2f i) : SV_Target
            {
                fixed4 col = _OutlineColor;
                /* Fogged with everything else, or a distant car keeps a
                   hard black edge while its body has already dissolved
                   into the horizon. */
                UNITY_APPLY_FOG(i.fogCoord, col);
                return col;
            }
            ENDCG
        }

        // ---- The body ---------------------------------------------------
        Pass
        {
            Name "Toon"
            Tags { "LightMode" = "ForwardBase" }

            Cull Back
            ZWrite On

            CGPROGRAM
            #pragma vertex ToonVertex
            #pragma fragment ToonFragment
            #pragma multi_compile_fwdbase
            #pragma multi_compile_fog
            #include "UnityCG.cginc"
            #include "Lighting.cginc"
            #include "AutoLight.cginc"

            float4 _BaseColor;
            float _Bands;
            float _Floor;
            float _Knee;
            float _UseVertexColor;

            struct appdata
            {
                float4 vertex : POSITION;
                float3 normal : NORMAL;
                float4 color  : COLOR;
            };

            struct v2f
            {
                float4 pos    : SV_POSITION;
                float3 normal : TEXCOORD0;
                float4 color  : COLOR;
                SHADOW_COORDS(1)
                UNITY_FOG_COORDS(2)
            };

            v2f ToonVertex(appdata v)
            {
                v2f o;
                o.pos = UnityObjectToClipPos(v.vertex);
                o.normal = UnityObjectToWorldNormal(v.normal);
                o.color = v.color;
                TRANSFER_SHADOW(o)
                UNITY_TRANSFER_FOG(o, o.pos);
                return o;
            }

            fixed4 ToonFragment(v2f i) : SV_Target
            {
                float3 lightDir = normalize(_WorldSpaceLightPos0.xyz);
                float ndotl = saturate(dot(normalize(i.normal), lightDir));
                ndotl *= SHADOW_ATTENUATION(i);

                /* Quantised to hard steps: four reads as drawn, and more
                   starts to look smooth again.

                   The darkest band is deliberately not black. Shadowed
                   bodywork outdoors is still lit by the sky, and a car
                   whose far side falls to nothing reads as a hole cut in
                   the picture rather than as a car. */
                float bands = max(2.0, floor(_Bands));
                float stepped = floor(ndotl * bands) / (bands - 1.0);
                float shade = _Floor + (1.0 - _Floor) * saturate(stepped);

                float3 albedo = lerp(_BaseColor.rgb, i.color.rgb, _UseVertexColor);
                float3 lit = albedo * shade * _LightColor0.rgb;

                /* A little ambient on top, so nothing is ever flat black.
                   `ShadeSH9` rather than a single colour, because the
                   ambient is trilight — sky above, ground below — and a
                   flat term would throw that away. */
                lit += albedo * ShadeSH9(float4(normalize(i.normal), 1.0)) * 0.5;

                /* A shoulder in the highlights, and nothing below the knee.
                   A sun at 1.4 with an ambient on top means any albedo past
                   about 0.6 leaves the top band above 1.0 and is simply cut
                   off — which is not a dimmer highlight, it is a *different
                   colour*. The kerbs showed it plainly: 0.88, 0.18, 0.18 red
                   clipped its red channel to 1.0 while green and blue kept
                   climbing, and a saturated red arrived on screen as pale
                   pink. Everything under 0.75 is left exactly as it was, so
                   the mid-tones and the four bands are untouched; above it
                   the curve bends towards 1.0 and never reaches it, which
                   keeps a bright surface bright and keeps its hue. */
                float knee = min(_Knee, 0.99);
                float room = 1.0 - knee;
                float3 rolled = knee + room * (1.0 - exp(-max(lit - knee, 0.0) / room));
                lit = lerp(lit, rolled, step(knee, lit));

                fixed4 col = fixed4(lit, _BaseColor.a);
                UNITY_APPLY_FOG(i.fogCoord, col);
                return col;
            }
            ENDCG
        }

        // Shadows, so the car is not floating.
        UsePass "Legacy Shaders/VertexLit/SHADOWCASTER"
    }

    Fallback "Diffuse"
}
