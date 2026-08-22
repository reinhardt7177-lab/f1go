using UnityEngine;

namespace MumuF1.Game
{
    /// <summary>
    /// The soundtrack.
    /// </summary>
    /// <remarks>
    /// The only sampled audio in the build, and the exception that explains
    /// the rule: the engine, the wind, the tyre scrub and the kerb rumble are
    /// all synthesised from the simulation's own output, because a note that
    /// has to follow the revs continuously cannot be a recording. Music does
    /// not have to react to anything, so a file is exactly right for it.
    ///
    /// Loaded by path rather than by a serialised reference, like everything
    /// else here, so there is no GUID for a moved file to break.
    ///
    /// The part that needs care is when it is allowed to start. Every browser
    /// refuses to play audio until the page has had a real user gesture — a
    /// click or a touch, not a timer — and a build that calls Play on Awake
    /// gets a suspended audio context and silence for the rest of the
    /// session, with nothing in the console to say why. So it starts on the
    /// press that dismisses the title card, which is a genuine gesture and is
    /// also exactly when the player wants it.
    /// </remarks>
    public class Music : MonoBehaviour
    {
        private const string Track = "Music/ThirdGearSunrise";

        /// <summary>
        /// Well under the engine.
        /// </summary>
        /// <remarks>
        /// The engine note is the instrument that tells you what the car is
        /// doing — where the revs are, whether the rears are lit, whether you
        /// have lifted. Music that competes with it is not atmosphere, it is
        /// interference.
        /// </remarks>
        public float Volume = 0.34f;

        private static Music _instance;

        private AudioSource _source;
        private bool _muted;

        public static Music Build(Transform parent)
        {
            var go = new GameObject("Music");
            go.transform.SetParent(parent);

            var music = go.AddComponent<Music>();
            _instance = music;
            return music;
        }

        private void Awake()
        {
            var clip = Resources.Load<AudioClip>(Track);

            _source = gameObject.AddComponent<AudioSource>();
            _source.clip = clip;
            _source.loop = true;

            /* Flat 2D, so it does not swing around the listener with the
               chase camera. */
            _source.spatialBlend = 0f;
            _source.volume = Volume;

            /* Deliberately not played here. See the note above on why a
               browser will not let it. */
            _source.playOnAwake = false;

            if (clip == null)
            {
                /* Missing is survivable and stays quiet about it. Deleting
                   the file should cost the soundtrack and nothing else —
                   the same contract the model kit has. */
                enabled = false;
            }
        }

        /// <summary>Start it, if a gesture has just happened.</summary>
        public static void Begin()
        {
            if (_instance == null || _instance._source == null) return;
            if (_instance._source.clip == null) return;
            if (_instance._source.isPlaying) return;

            _instance._source.Play();
        }

        private void Update()
        {
            /* One key, because a soundtrack somebody cannot turn off is a
               soundtrack they close the tab over. */
            if (Input.GetKeyDown(KeyCode.M))
            {
                _muted = !_muted;
                _source.volume = _muted ? 0f : Volume;
            }
        }
    }
}
