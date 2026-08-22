using System.Runtime.InteropServices;
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
    /// It does not go through Unity's audio importer, and that is the whole
    /// design of this class. The importer transcodes every clip to AAC in an
    /// MP4 container for WebGL, since that is the one compressed format the
    /// WebGL backend can hand to the browser's decodeAudioData. The file it
    /// writes is correct. The problem is on the other side: AAC is licensed,
    /// and the open-source Chromium builds that ship on Linux and inside most
    /// headless and Electron environments are compiled without the decoder.
    /// There the call fails with "Unable to decode audio data" and the music
    /// is silently gone. MP3 has no such hole, so the file sits in
    /// StreamingAssets, which Unity copies byte for byte without importing,
    /// and the browser plays it directly. It streams rather than decoding
    /// whole into memory, and three quarters of a megabyte leaves the initial
    /// download.
    ///
    /// The remaining care is about when it may start. Every browser refuses
    /// to play audio until the page has had a real user gesture — a click or
    /// a touch, not a timer — and a build that plays on Awake gets a
    /// suspended context and silence for the rest of the session, with
    /// nothing in the console to say why. So it starts on the press that
    /// dismisses the title card, which is a genuine gesture and is also
    /// exactly when the player wants it.
    /// </remarks>
    public class Music : MonoBehaviour
    {
        private const string File = "ThirdGearSunrise.mp3";

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

#if UNITY_WEBGL && !UNITY_EDITOR
        [DllImport("__Internal")]
        private static extern void MumuMusicPlay(string url, float volume, int loop);

        [DllImport("__Internal")]
        private static extern void MumuMusicVolume(float volume);
#endif

        private static Music _instance;

        private bool _muted;
        private bool _started;

        /* Only used away from the browser. See Awake. */
        private AudioSource _source;

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
#if !UNITY_WEBGL || UNITY_EDITOR
            /* Off the browser there is no <audio> element to borrow, so the
               clip is fetched from the same file and played through an
               ordinary source. Nothing here runs in the shipped build; it
               exists so that pressing Play in the editor still has a
               soundtrack. */
            _source = gameObject.AddComponent<AudioSource>();
            _source.loop = true;
            _source.spatialBlend = 0f;
            _source.volume = Volume;
            _source.playOnAwake = false;
            StartCoroutine(LoadForEditor());
#endif
        }

#if !UNITY_WEBGL || UNITY_EDITOR
        private System.Collections.IEnumerator LoadForEditor()
        {
            var url = System.IO.Path.Combine(Application.streamingAssetsPath, File);
            if (!url.Contains("://")) url = "file://" + url;

            using (var request = UnityEngine.Networking.UnityWebRequestMultimedia
                       .GetAudioClip(url, AudioType.MPEG))
            {
                yield return request.SendWebRequest();

                if (request.result != UnityEngine.Networking.UnityWebRequest.Result.Success)
                {
                    /* Missing is survivable and stays quiet about it.
                       Deleting the file should cost the soundtrack and
                       nothing else — the same contract the model kit has. */
                    yield break;
                }

                _source.clip = UnityEngine.Networking.DownloadHandlerAudioClip
                    .GetContent(request);

                /* The gesture may already have happened while this was in
                   flight, in which case the press that would have started it
                   has been and gone. */
                if (_started && !_muted) _source.Play();
            }
        }
#endif

        /// <summary>Start it, if a gesture has just happened.</summary>
        public static void Begin()
        {
            if (_instance == null) return;
            _instance.Play();
        }

        private void Play()
        {
            if (_started) return;
            _started = true;

#if UNITY_WEBGL && !UNITY_EDITOR
            MumuMusicPlay(Application.streamingAssetsPath + "/" + File, Volume, 1);
#else
            if (_source != null && _source.clip != null) _source.Play();
#endif
        }

        private void Update()
        {
            /* One key, because a soundtrack somebody cannot turn off is a
               soundtrack they close the tab over. */
            if (!Input.GetKeyDown(KeyCode.M)) return;

            _muted = !_muted;
            var volume = _muted ? 0f : Volume;

#if UNITY_WEBGL && !UNITY_EDITOR
            MumuMusicVolume(volume);
#else
            if (_source != null) _source.volume = volume;
#endif
        }
    }
}
