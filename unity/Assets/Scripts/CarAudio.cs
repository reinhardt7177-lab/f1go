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
        /// <summary>Overall level, so the whole thing has one knob.</summary>
        public float Volume = 0.22f;

        private CarController _car;
        private AudioSource _source;

        /* Read by the audio thread and written by the game thread. Doubles
           and floats are written atomically on every platform this runs on,
           and the worst case is one buffer built from a mix of two ticks —
           which is 23 ms of a note that is already changing continuously. A
           lock here would be a lock held on the audio thread, which is the
           one place it must never be. */
        private volatile float _hz;
        private volatile float _gain;
        private volatile float _wind;
        private volatile float _scrub;
        private volatile float _rumble;

        private double[] _amplitudes = EngineAudio.HarmonicAmplitudes(0);

        /// <summary>Phase per harmonic, kept between buffers.</summary>
        private readonly double[] _phase = new double[EngineAudio.Harmonics + 1];

        private double _sampleRate = 48000;

        /// <summary>Noise state for the wind and scrub, one pole low-passed.</summary>
        private float _noise;
        private uint _seed = 0x9E3779B9;

        private void Awake()
        {
            _car = GetComponent<CarController>();
            _sampleRate = AudioSettings.outputSampleRate > 0 ? AudioSettings.outputSampleRate : 48000;

            _source = gameObject.AddComponent<AudioSource>();
            _source.clip = null;
            _source.playOnAwake = true;
            _source.loop = true;

            /* Flat 2D. The listener is on the chase camera a few metres
               behind, and panning the player's own engine across the stereo
               field as the camera swings is a novelty that becomes nausea. */
            _source.spatialBlend = 0f;
            _source.volume = 1f;
            _source.Play();
        }

        private void Update()
        {
            if (_car == null) return;

            var rpm = _car.EngineRpm;
            var throttle = _car.Controls.Throttle;

            _hz = (float)EngineAudio.FiringHz(rpm);
            _gain = (float)EngineAudio.EngineGain(rpm, throttle);
            _wind = (float)EngineAudio.WindGain(_car.SpeedMs);

            /* Timbre is recomputed on the game thread and handed over as a
               whole array, so the audio thread never sees a half-written
               one. Sixteen divides a frame is nothing. */
            _amplitudes = EngineAudio.HarmonicAmplitudes(throttle);

            /* The loudest complaining tyre, rather than a sum: four tyres
               scrubbing is not four times the noise, it is one slide. */
            double scrub = 0;
            double rumble = 0;
            for (int i = 0; i < 4; i++)
            {
                CarController.TyreSound w = _car.Tyre(i);
                scrub = Math.Max(scrub, EngineAudio.ScrubGain(w.SlipAngle, w.SlipRatio));
                rumble = Math.Max(rumble, EngineAudio.RumbleGain(w.SurfaceGrip, w.Load));
            }

            _scrub = (float)scrub;
            _rumble = (float)rumble;
        }

        /// <summary>
        /// Fill a buffer. This runs on the audio thread.
        /// </summary>
        /// <remarks>
        /// Nothing in here may allocate, block, or touch a Unity object. It
        /// reads five floats and an array reference and does arithmetic.
        /// </remarks>
        private void OnAudioFilterRead(float[] data, int channels)
        {
            double[] amps = _amplitudes;
            double step = _hz / _sampleRate * 2 * Math.PI;

            float engine = _gain * Volume;
            float wind = _wind * Volume * 0.55f;
            float scrub = _scrub * Volume * 0.5f;
            float rumble = _rumble * Volume * 0.7f;

            int frames = data.Length / channels;

            for (int f = 0; f < frames; f++)
            {
                double sample = 0;

                if (step > 0)
                {
                    for (int n = 1; n <= EngineAudio.Harmonics; n++)
                    {
                        _phase[n] += step * n;
                        /* Wrapped rather than left to grow. A double holds
                           enough digits for hours, but the sine of a large
                           argument loses precision long before it overflows,
                           and the note goes gritty on a long stint. */
                        if (_phase[n] > Math.PI * 2) _phase[n] -= Math.PI * 2;
                        sample += Math.Sin(_phase[n]) * amps[n];
                    }
                }

                sample *= engine;

                /* One-pole filtered white noise for everything that is not a
                   pitch. Unfiltered noise is a hiss; this is closer to air
                   and to rubber. */
                _noise += (White() - _noise) * 0.35f;
                sample += _noise * (wind + scrub);

                /* The rumble is lower, so it gets a slower filter — a kerb is
                   felt more than heard, and a bright rattle sounds like
                   gravel rather than like a car crossing a kerb. */
                sample += _noise * rumble * 0.6;

                var value = (float)Math.Max(-1.0, Math.Min(1.0, sample));
                for (int c = 0; c < channels; c++) data[f * channels + c] = value;
            }
        }

        /// <summary>White noise, from a generator that does not allocate.</summary>
        /// <remarks>
        /// <c>UnityEngine.Random</c> is not safe to call off the main thread
        /// and <c>System.Random</c> allocates and is not either. An xorshift
        /// on a field is three instructions and is fine on any thread that
        /// owns it — and this one is only ever touched by the audio thread.
        /// </remarks>
        private float White()
        {
            _seed ^= _seed << 13;
            _seed ^= _seed >> 17;
            _seed ^= _seed << 5;
            return _seed / (float)uint.MaxValue * 2f - 1f;
        }
    }
}
