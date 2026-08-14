/* ------------------------------------------------------------------
   Fullscreen and orientation for the arcade racer.

   The same job f1sim's viewport.ts does, written in the plain-script
   style the rest of this game uses. Both requests need a user gesture,
   and the orientation lock additionally needs the document to already
   be fullscreen — so it is one tap that does the two in order, and
   degrades quietly wherever one or both are refused.

   iOS is the case that matters: Safari has no orientation lock at all,
   and no fullscreen on iPhone. There the rotate prompt is the whole
   mechanism, which is why it is a prompt and not a nicety.
   ------------------------------------------------------------------ */
var Viewport = {
  coarse: function () {
    return typeof window.matchMedia === 'function' &&
      window.matchMedia('(pointer: coarse)').matches;
  },

  portrait: function () {
    return window.innerHeight > window.innerWidth;
  },

  isFullscreen: function () {
    return !!(document.fullscreenElement || document.webkitFullscreenElement);
  },

  /* Never throws: a platform saying no is a normal outcome here, not an
     error worth interrupting anyone over. */
  enter: function () {
    var el = document.documentElement;
    try {
      if (!Viewport.isFullscreen()) {
        var req = el.requestFullscreen || el.webkitRequestFullscreen;
        if (req) {
          var r = req.call(el, { navigationUI: 'hide' });
          if (r && r.catch) r.catch(function () {});
        }
      }
    } catch (e) { /* refused; still try the orientation below */ }

    try {
      if (screen.orientation && screen.orientation.lock) {
        var p = screen.orientation.lock('landscape');
        if (p && p.catch) p.catch(function () {});
      }
    } catch (e) { /* no lock here — the rotate prompt covers it */ }
  },

  exit: function () {
    try {
      if (screen.orientation && screen.orientation.unlock) screen.orientation.unlock();
    } catch (e) { /* nothing to undo */ }
    try {
      if (document.fullscreenElement && document.exitFullscreen) {
        var r = document.exitFullscreen();
        if (r && r.catch) r.catch(function () {});
      }
    } catch (e) { /* already out */ }
  },

  init: function () {
    var start = document.getElementById('start-card');
    var rotate = document.getElementById('rotate-prompt');
    var toggle = document.getElementById('btn-fullscreen');
    var menu = document.getElementById('menu');

    /* On a desktop there is nothing to ask for, and a click-through
       before you can drive would be pure friction. */
    if (Viewport.coarse()) {
      start.classList.remove('hidden');
      toggle.classList.add('shown');
    }

    var sync = function () {
      /* Only nag on a touch device, and only once the card is gone —
         otherwise the two overlays fight over the screen. */
      var show = Viewport.coarse() && Viewport.portrait() &&
        start.classList.contains('hidden');
      rotate.classList.toggle('hidden', !show);
      toggle.classList.toggle('on', Viewport.isFullscreen());
    };

    start.addEventListener('click', function () {
      Viewport.enter();
      start.classList.add('hidden');
      sync();
    });

    toggle.addEventListener('click', function (e) {
      e.stopPropagation();
      if (Viewport.isFullscreen()) Viewport.exit(); else Viewport.enter();
    });

    /* Starting a race is a user gesture too, so take it: a player who
       dismissed the card still ends up fullscreen when it counts. */
    if (menu) {
      var startBtn = document.getElementById('start-btn');
      if (startBtn) {
        startBtn.addEventListener('click', function () {
          if (Viewport.coarse()) Viewport.enter();
        });
      }
    }

    window.addEventListener('resize', sync);
    window.addEventListener('orientationchange', sync);
    document.addEventListener('fullscreenchange', sync);
    sync();
  }
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', function () { Viewport.init(); });
} else {
  Viewport.init();
}
