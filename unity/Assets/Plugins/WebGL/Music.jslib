/* The soundtrack, played by the browser rather than by Unity.
 *
 * Unity's WebGL audio importer transcodes every clip to AAC in an MP4
 * container, because that is the one compressed format its WebGL backend
 * knows how to hand to decodeAudioData. The file it produces is correct —
 * ftyp/free/mdat/moov, real AAC — but AAC is a licensed codec, and the
 * open-source Chromium builds that ship on Linux and inside most headless
 * and Electron environments are compiled without it. There the decode
 * fails with "Unable to decode audio data" and the music is simply gone,
 * with the rest of the game none the wiser.
 *
 * MP3 has no such hole: every browser decodes it. So the file lives in
 * StreamingAssets, where Unity copies it byte for byte without importing
 * it, and an <audio> element plays it. That also means it streams instead
 * of being decoded whole into memory, and that three quarters of a
 * megabyte leaves the initial download.
 */
var MumuMusic = {

  $Mumu: {
    el: null,
    /* Remembered across a failed play() so a later gesture can retry with
       the volume the game last asked for, not the default. */
    volume: 0.34
  },

  MumuMusicPlay: function (urlPtr, volume, loop) {
    var url = UTF8ToString(urlPtr);
    Mumu.volume = volume;

    if (!Mumu.el) {
      Mumu.el = new Audio();
      Mumu.el.preload = 'auto';
      /* Same-origin here, but the build is also served from object
         storage in some deployments, and without this the element taints
         and the volume property stops applying. */
      Mumu.el.crossOrigin = 'anonymous';
      Mumu.el.src = url;
    }

    Mumu.el.loop = !!loop;
    Mumu.el.volume = volume;

    var p = Mumu.el.play();
    /* play() rejects when the page has not had a gesture yet. That is not
       an error worth a console entry — the game calls this again on the
       press that starts the race, which is a gesture, and it succeeds
       then. Swallowing the rejection keeps it out of the log without
       hiding a real failure, which would show up as silence either way. */
    if (p && p.catch) { p.catch(function () {}); }
  },

  MumuMusicVolume: function (volume) {
    Mumu.volume = volume;
    if (Mumu.el) { Mumu.el.volume = volume; }
  }
};

autoAddDeps(MumuMusic, '$Mumu');
mergeInto(LibraryManager.library, MumuMusic);
