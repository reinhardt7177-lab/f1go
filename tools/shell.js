'use strict';

/* ------------------------------------------------------------------
   The page around the game.

   Unity ships a default template, and it is a demo page: a 960 by 600
   canvas in the middle of a white document, a Unity logo, a progress
   bar in Unity's colours and a footer reading "unity". None of that is
   wrong for a template. All of it is wrong for a finished thing — the
   first impression of the game is a small rectangle with somebody
   else's branding underneath it.

   The proper place to fix that is a WebGL template inside the Unity
   project, and it cannot go there: selecting one is a field in
   ProjectSettings.asset, which this project does not have, because
   there is no editor here to write it. So the page is replaced after
   the build instead. Nothing is lost by that — the template's only job
   is to call createUnityInstance with the right four URLs, and those
   are read back out of the page it wrote.
   ------------------------------------------------------------------ */

/** The four build URLs Unity wrote into its own page. */
const urls = (html) => {
  const find = (key) => {
    const m = html.match(new RegExp(`${key}:\\s*buildUrl\\s*\\+\\s*"([^"]+)"`));
    return m ? `Build${m[1]}` : null;
  };

  const found = {
    loader: (html.match(/loaderUrl\s*=\s*buildUrl\s*\+\s*"([^"]+)"/) || [])[1],
    data: find('dataUrl'),
    framework: find('frameworkUrl'),
    code: find('codeUrl')
  };

  if (found.loader) found.loader = `Build${found.loader}`;

  const missing = Object.entries(found).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) {
    throw new Error(
      `could not read ${missing.join(', ')} out of Unity's index.html — ` +
      'the template changed shape and this needs to be taught the new one');
  }

  return found;
};

/** Append the build's stamp, so a changed player is a changed URL. */
const stamped = (url, version) => (version ? `${url}?v=${version}` : url);

/**
 * The page.
 *
 * One file, no external anything: the loading screen has to work before
 * a 17 MB wasm has arrived, so a font or a stylesheet from somewhere
 * else would be a second thing to wait for and a second thing to fail.
 */
const page = (u, version) => `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, height=device-height, initial-scale=1, user-scalable=no, viewport-fit=cover">
<meta name="theme-color" content="#0b0d10">
<meta name="description" content="무무 F1 — 브라우저에서 도는 F1 시뮬레이터">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<title>무무 F1</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%230b0d10'/%3E%3Cpath d='M4 20h24M4 20l4-6h9l3 6' stroke='%23e03a2f' stroke-width='3' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3Ccircle cx='10' cy='22' r='3.2' fill='%23f2f3f5'/%3E%3Ccircle cx='23' cy='22' r='3.2' fill='%23f2f3f5'/%3E%3C/svg%3E">
<style>
  :root {
    --ink: #f2f3f5;
    --dim: #8b939c;
    --bed: #0b0d10;
    --red: #e03a2f;
  }

  * { margin: 0; padding: 0; box-sizing: border-box; }

  html, body {
    width: 100%;
    height: 100%;
    overflow: hidden;
    background: var(--bed);
    color: var(--ink);
    font: 400 16px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI",
          "Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif;
    /* A racing game is held with two thumbs. Nothing on this page should
       ever pan, zoom, select or fire a double-tap zoom. */
    overscroll-behavior: none;
    touch-action: none;
    -webkit-user-select: none;
    user-select: none;
    -webkit-tap-highlight-color: transparent;
  }

  /* The canvas fills the window, and does so in the units that survive a
     phone's address bar sliding away — 100vh does not. */
  #canvas {
    display: block;
    width: 100%;
    height: 100%;
    background: var(--bed);
  }

  @supports (height: 100dvh) {
    html, body { height: 100dvh; }
  }

  #gate {
    position: fixed;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1.6rem;
    background: radial-gradient(120% 90% at 50% 40%, #161a20 0%, var(--bed) 70%);
    transition: opacity .45s ease;
    z-index: 2;
  }

  #gate.done { opacity: 0; pointer-events: none; }

  #mark {
    font: 800 clamp(2.2rem, 9vw, 4.4rem)/1 "Segoe UI", system-ui, sans-serif;
    letter-spacing: -.04em;
  }

  #mark span { color: var(--red); }

  #tagline { color: var(--dim); font-size: .95rem; letter-spacing: .02em; }

  #track {
    width: min(62vw, 320px);
    height: 4px;
    border-radius: 2px;
    background: #23282f;
    overflow: hidden;
  }

  #bar {
    width: 0;
    height: 100%;
    background: var(--red);
    transition: width .2s ease;
  }

  #note {
    min-height: 1.4em;
    font-size: .82rem;
    color: var(--dim);
    text-align: center;
    padding: 0 1.4rem;
    max-width: 34rem;
  }

  #note.bad { color: #ff8b7f; }

  /* Which build this is, shown for a moment once the game is up.
     There is no other way to tell from the outside: Unity's output has
     fixed filenames, so two different builds look identical in the URL
     bar, and "did my change reach the site" has cost more time on this
     project than any bug in it. Four seconds, bottom corner, dim. */
  #stamp {
    position: fixed;
    right: .7rem;
    bottom: .55rem;
    font: 400 .68rem/1 ui-monospace, SFMono-Regular, Menlo, monospace;
    letter-spacing: .06em;
    color: var(--dim);
    opacity: .55;
    pointer-events: none;
    transition: opacity 1s ease .6s;
    z-index: 1;
  }

  #stamp.gone { opacity: 0; }
</style>
</head>
<body>

<canvas id="canvas" tabindex="-1"></canvas>

<div id="stamp">build ${version || 'dev'}</div>

<div id="gate">
  <div id="mark">무무 <span>F1</span></div>
  <div id="tagline">GRAND PRIX SIMULATOR</div>
  <div id="track"><div id="bar"></div></div>
  <div id="note">불러오는 중…</div>
</div>

<script>
(function () {
  var canvas = document.getElementById('canvas');
  var gate = document.getElementById('gate');
  var bar = document.getElementById('bar');
  var note = document.getElementById('note');

  var say = function (text, bad) {
    note.textContent = text;
    note.className = bad ? 'bad' : '';
  };

  /* Unity sizes its render target from the canvas's CSS box times the
     device pixel ratio. On a phone that is a 3x buffer of a full screen
     — eight million pixels for a scene that does not need them — so it
     is capped. The engine's own quality tier scales further from there. */
  var config = {
    dataUrl: ${JSON.stringify(stamped(u.data, version))},
    frameworkUrl: ${JSON.stringify(stamped(u.framework, version))},
    codeUrl: ${JSON.stringify(stamped(u.code, version))},
    streamingAssetsUrl: 'StreamingAssets',
    companyName: 'mumu',
    productName: '무무 F1',
    productVersion: '1.0',
    devicePixelRatio: Math.min(window.devicePixelRatio || 1, 2),
    showBanner: function (msg, type) {
      if (type === 'error') say(msg, true);
    }
  };

  var script = document.createElement('script');
  script.src = ${JSON.stringify(stamped(u.loader, version))};

  script.onerror = function () {
    say('플레이어를 불러오지 못했습니다. 새로고침해 주세요.', true);
  };

  script.onload = function () {
    createUnityInstance(canvas, config, function (progress) {
      bar.style.width = (progress * 100).toFixed(1) + '%';
      if (progress > 0.92) say('시동 거는 중…');
    }).then(function () {
      gate.classList.add('done');
      /* Removed rather than left behind: a fixed element covering the
         canvas still swallows the first touch even at zero opacity, and
         the first touch is the one that starts the race. */
      setTimeout(function () { gate.remove(); }, 500);
      canvas.focus();

      var stamp = document.getElementById('stamp');
      if (stamp) {
        setTimeout(function () { stamp.classList.add('gone'); }, 4000);
        setTimeout(function () { stamp.remove(); }, 6000);
      }
    }).catch(function (message) {
      say(String(message), true);
    });
  };

  document.body.appendChild(script);

  /* The keys the game uses are also the keys the browser scrolls with.
     Unity's own template leaves that alone because its canvas is a
     rectangle in a document; here the canvas is the document. */
  window.addEventListener('keydown', function (e) {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].indexOf(e.key) >= 0) {
      e.preventDefault();
    }
  }, { passive: false });
})();
</script>

</body>
</html>
`;

module.exports = { urls, page };
