using System;
using UnityEngine;

namespace MumuF1.Game
{
    /// <summary>
    /// The engine, synthesised.
    /// </summary>
    /// <remarks>
    /// No samples. A recorded engine loop has to be pitched to the revs and
    /// crossfaded between load layers, which needs several minutes of audio
    /// nobody here has a licence to and which never quite tracks a
    /// continuously-variable note anyway. Adding sixteen sine waves does, and
    /// it costs a few hundred multiplies a buffer.
    ///
    /// It is also the only way this fits the project. Every audio file would
    /// be an asset to import, give a GUID and reference from a serialised
    /// field, and this is written on a machine with no editor to do any of
    /// that in.
    ///
    /// What each number means lives in <see cref="EngineAudio"/>, which has
    /// no UnityEngine in it and is tested without a sound card. This file is
    /// the oscillator bank and nothing else.
    /// </remarks>
    [RequireComponent(typeof(CarController))]
    public class CarAudio : MonoBehaviour
    {
        /// <summary>Overall level.</summary>
        public float Volume = 0.22f;

        /// <summary>
        /// The firing frequency the engine clip is baked at (Hz).
        /// </summary>
        /// <remarks>
        /// Chosen so the clip is a whole number of periods at 44.1 kHz — one
        /// second is exactly two hundred of them — which is what makes the
        /// loop seamless. Everything above and below is reached by pitching
        /// it: idle is 200 Hz and the limiter is 750, so the widest stretch
        /// asked of the sample is under four to one.
        /// </remarks>
        private const float BakedHz = 200f;

        private const int BakeRate = 44100;

        private CarController _car;
        private AudioSource _engine;
        private AudioSource _air;

        private void Awake()
        {
            _car = GetComponent<CarController>();

            _engine = Source(EngineClip(), 1f);
            _air = Source(NoiseClip(), 0f);
        }

        private AudioSource Source(AudioClip clip, float volume)
        {
            var source = gameObject.AddComponent<AudioSource>();
            source.clip = clip;
            source.loop = true;

            /* Flat 2D. The listener is on the chase camera a few metres
               behind, and panning the player's own engine across the stereo
               field as the camera swings is a novelty that becomes nausea. */
            source.spatialBlend = 0f;
            source.volume = volume;
            source.playOnAwake = false;
            source.Play();
            return source;
        }

        /// <summary>
        /// One second of the engine's harmonic stack, at <see cref="BakedHz"/>.
        /// </summary>
        /// <remarks>
        /// The timbre is fixed at a middling load rather than followed live,
        /// and that is the compromise this whole file is. It used to be
        /// synthesised sample by sample in <c>OnAudioFilterRead</c>, which
        /// follows the load exactly and does not exist in WebGL: Unity's
        /// browser backend has no custom DSP callback at all, so the engine
        /// was not quiet there, it was absent. A baked loop moved by pitch
        /// and volume is the part of that which a browser can play.
        /// </remarks>
        private static AudioClip EngineClip()
        {
            double[] amps = EngineAudio.HarmonicAmplitudes(0.6);
            var data = new float[BakeRate];

            for (int i = 0; i < data.Length; i++)
            {
                double t = (double)i / BakeRate;
                double sample = 0;

                for (int n = 1; n <= EngineAudio.Harmonics; n++)
                {
                    sample += System.Math.Sin(2 * System.Math.PI * BakedHz * n * t) * amps[n];
                }

                data[i] = (float)System.Math.Max(-1.0, System.Math.Min(1.0, sample));
            }

            var clip = AudioClip.Create("Engine", data.Length, 1, BakeRate, false);
            clip.SetData(data, 0);
            return clip;
        }

        /// <summary>Two seconds of one-pole filtered noise, for everything unpitched.</summary>
        /// <remarks>
        /// Unfiltered white noise is a hiss; filtered, it is closer to air and
        /// to rubber. Two seconds because a shorter loop of noise has an
        /// audible period, and noise that ticks is worse than no noise.
        /// </remarks>
        private static AudioClip NoiseClip()
        {
            var data = new float[BakeRate * 2];
            uint seed = 0x9E3779B9;
            float value = 0f;

            for (int i = 0; i < data.Length; i++)
            {
                seed ^= seed << 13;
                seed ^= seed >> 17;
                seed ^= seed << 5;
                float white = seed / (float)uint.MaxValue * 2f - 1f;

                value += (white - value) * 0.35f;
                data[i] = value;
            }

            /* Crossfaded into itself over the last tenth of a second, so the
               join is not a click. */
            int blend = BakeRate / 10;
            for (int i = 0; i < blend; i++)
            {
                float k = (float)i / blend;
                int tail = data.Length - blend + i;
                data[tail] = data[tail] * (1f - k) + data[i] * k;
            }

            var clip = AudioClip.Create("Air", data.Length, 1, BakeRate, false);
            clip.SetData(data, 0);
            return clip;
        }

        private void Update()
        {
            if (_car == null || _engine == null) return;

            double rpm = _car.EngineRpm;
            double throttle = _car.Controls.Throttle;

            float hz = (float)EngineAudio.FiringHz(rpm);
            _engine.pitch = Mathf.Clamp(hz / BakedHz, 0.25f, 6f);
            _engine.volume = (float)EngineAudio.EngineGain(rpm, throttle) * Volume;

            /* The loudest complaining tyre, rather than a sum: four tyres
               scrubbing is not four times the noise, it is one slide. */
            double scrub = 0;
            double rumble = 0;
            for (int i = 0; i < 4; i++)
            {
                CarController.TyreSound w = _car.Tyre(i);
                scrub = System.Math.Max(scrub, EngineAudio.ScrubGain(w.SlipAngle, w.SlipRatio));
                rumble = System.Math.Max(rumble, EngineAudio.RumbleGain(w.SurfaceGrip, w.Load));
            }

            double wind = EngineAudio.WindGain(_car.SpeedMs);

            _air.volume = (float)(wind * 0.55 + scrub * 0.5 + rumble * 0.7) * Volume;

            /* Air rises in pitch with speed and rubber does not, so the two
               share a source and the wind decides. It is a cheap trick and it
               is the difference between "noise" and "going fast". */
            _air.pitch = Mathf.Clamp(0.8f + (float)(System.Math.Abs(_car.SpeedMs) / 120.0), 0.8f, 1.8f);
        }
    }
}
