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
// Bought nothing to do it. The asset store has good cel-shading packs,
// but this is thirty lines of HLSL and the web version already knows
// exactly which thirty — including the two details that make it hold up,
// both of which were paid for once already and are commented below.

Shader "mumuF1/Toon"
{
    Properties
    {
        _BaseColor ("Colour", Color) = (0.8, 0.1, 0.1, 1)
        _Bands ("Bands of light", Range(2, 8)) = 4
        _Floor ("Darkest band", Range(0, 1)) = 0.42
        _OutlineWeight ("Outline weight (px at 1080)", Range(0, 12)) = 2.4
        _OutlineColor ("Outline colour", Color) = (0, 0, 0, 1)
        [Toggle] _UseVertexColor ("Colour from vertices", Float) = 0
    }

    SubShader
    {
        Tags { "RenderType" = "Opaque" "RenderPipeline" = "UniversalPipeline" }

        // ---- the outline hull, first so the model overdraws it -------
        Pass
        {
            Name "Outline"
            Tags { "LightMode" = "SRPDefaultUnlit" }

            Cull Front
            ZWrite On

            HLSLPROGRAM
            #pragma vertex OutlineVertex
            #pragma fragment OutlineFragment
            #pragma multi_compile_instancing

            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"

            CBUFFER_START(UnityPerMaterial)
                float4 _BaseColor;
                float4 _OutlineColor;
                float _Bands;
                float _Floor;
                float _OutlineWeight;
                float _UseVertexColor;
            CBUFFER_END

            struct Attributes
            {
                float4 positionOS : POSITION;
                float3 normalOS   : NORMAL;
                UNITY_VERTEX_INPUT_INSTANCE_ID
            };

            struct Varyings
            {
                float4 positionCS : SV_POSITION;
            };

            Varyings OutlineVertex(Attributes input)
            {
                Varyings output;
                UNITY_SETUP_INSTANCE_ID(input);

                float3 positionVS = TransformWorldToView(
                    TransformObjectToWorld(input.positionOS.xyz));
                float3 normalVS = normalize(
                    TransformWorldToViewDir(TransformObjectToWorldNormal(input.normalOS)));

                /* The push is scaled by view depth, so a distant car keeps
                   a line of the same weight on screen rather than fading
                   to nothing.

                   The perspective divide takes a metre to (focal / -z)
                   pixels, so the push has to carry -z to come out constant
                   on screen. The 2.0 is the clip cube's height in NDC, and
                   UNITY_MATRIX_P[1][1] is the focal term. */
                float perPixel = (2.0 * -positionVS.z)
                    / (UNITY_MATRIX_P[1][1] * _ScreenParams.y);
                positionVS += normalVS * _OutlineWeight * perPixel;

                output.positionCS = TransformWViewToHClip(positionVS);
                return output;
            }

            half4 OutlineFragment(Varyings input) : SV_Target
            {
                return _OutlineColor;
            }
            ENDHLSL
        }

        // ---- the model itself, in flat bands ------------------------
        Pass
        {
            Name "Toon"
            Tags { "LightMode" = "UniversalForward" }

            Cull Back
            ZWrite On

            HLSLPROGRAM
            #pragma vertex ToonVertex
            #pragma fragment ToonFragment
            #pragma multi_compile_instancing
            #pragma multi_compile _ _MAIN_LIGHT_SHADOWS _MAIN_LIGHT_SHADOWS_CASCADE
            #pragma multi_compile_fragment _ _SHADOWS_SOFT

            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Lighting.hlsl"

            CBUFFER_START(UnityPerMaterial)
                float4 _BaseColor;
                float4 _OutlineColor;
                float _Bands;
                float _Floor;
                float _OutlineWeight;
                float _UseVertexColor;
            CBUFFER_END

            struct Attributes
            {
                float4 positionOS : POSITION;
                float3 normalOS   : NORMAL;
                float4 color      : COLOR;
                UNITY_VERTEX_INPUT_INSTANCE_ID
            };

            struct Varyings
            {
                float4 positionCS  : SV_POSITION;
                float3 normalWS    : TEXCOORD0;
                float3 positionWS  : TEXCOORD1;
                float4 color       : COLOR;
            };

            Varyings ToonVertex(Attributes input)
            {
                Varyings output;
                UNITY_SETUP_INSTANCE_ID(input);
                output.positionWS = TransformObjectToWorld(input.positionOS.xyz);
                output.positionCS = TransformWorldToHClip(output.positionWS);
                output.normalWS = TransformObjectToWorldNormal(input.normalOS);
                output.color = input.color;
                return output;
            }

            half4 ToonFragment(Varyings input) : SV_Target
            {
                float4 shadowCoord = TransformWorldToShadowCoord(input.positionWS);
                Light light = GetMainLight(shadowCoord);

                float ndotl = saturate(dot(normalize(input.normalWS), light.direction));
                ndotl *= light.shadowAttenuation;

                /* Quantised to hard steps: four reads as drawn, and more
                   starts to look smooth again.

                   The darkest band is deliberately not black. Shadowed
                   bodywork outdoors is still lit by the sky, and a car
                   whose far side falls to nothing reads as a hole cut in
                   the picture rather than as a car. */
                float bands = max(2.0, floor(_Bands));
                float step = floor(ndotl * bands) / (bands - 1.0);
                float shade = _Floor + (1.0 - _Floor) * saturate(step);

                float3 albedo = lerp(_BaseColor.rgb, input.color.rgb, _UseVertexColor);
                float3 lit = albedo * shade * light.color;

                // A little ambient on top, so nothing is ever flat black.
                lit += albedo * unity_AmbientSky.rgb * 0.35;

                return half4(lit, _BaseColor.a);
            }
            ENDHLSL
        }

        // Shadows, so the car is not floating.
        UsePass "Universal Render Pipeline/Lit/ShadowCaster"
        UsePass "Universal Render Pipeline/Lit/DepthOnly"
    }

    Fallback "Universal Render Pipeline/Lit"
}
