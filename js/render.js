/* ------------------------------------------------------------------
   render.js - pseudo-3D road painter, procedural scenery, and the
   first-person cockpit that sits in front of it all.
   ------------------------------------------------------------------ */
'use strict';

var Render = {

  polygon: function (ctx, x1, y1, x2, y2, x3, y3, x4, y4, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.lineTo(x3, y3);
    ctx.lineTo(x4, y4);
    ctx.closePath();
    ctx.fill();
  },

  fog: function (ctx, x, y, width, height, fog, color) {
    if (fog < 1) {
      ctx.globalAlpha = 1 - fog;
      ctx.fillStyle = color;
      ctx.fillRect(x, y, width, height);
      ctx.globalAlpha = 1;
    }
  },

  /* ----------------------------------------------------------------
     One trapezoid of road: grass shoulder, rumble strips, tarmac,
     lane markings, and (on street circuits) the barriers.
     ---------------------------------------------------------------- */
  segment: function (ctx, width, lanes, x1, y1, w1, x2, y2, w2, fog, seg, theme) {
    var r1 = Render.rumbleWidth(w1, lanes);
    var r2 = Render.rumbleWidth(w2, lanes);
    var i = seg.dark ? 0 : 1;

    ctx.fillStyle = theme.grass[i];
    ctx.fillRect(0, y2, width, y1 - y2);

    /* grounding shadow where the verge meets the kerb */
    var s1 = r1 * 0.8, s2 = r2 * 0.8;
    Render.polygon(ctx, x1 - w1 - r1 - s1, y1, x1 - w1 - r1, y1, x2 - w2 - r2, y2, x2 - w2 - r2 - s2, y2, 'rgba(0,0,0,0.10)');
    Render.polygon(ctx, x1 + w1 + r1 + s1, y1, x1 + w1 + r1, y1, x2 + w2 + r2, y2, x2 + w2 + r2 + s2, y2, 'rgba(0,0,0,0.10)');

    Render.polygon(ctx, x1 - w1 - r1, y1, x1 - w1, y1, x2 - w2, y2, x2 - w2 - r2, y2, theme.rumble[i]);
    Render.polygon(ctx, x1 + w1 + r1, y1, x1 + w1, y1, x2 + w2, y2, x2 + w2 + r2, y2, theme.rumble[i]);
    Render.polygon(ctx, x1 - w1, y1, x1 + w1, y1, x2 + w2, y2, x2 - w2, y2, theme.road[i]);

    /* the rubbered-in racing groove down the middle of the tarmac */
    Render.polygon(ctx, x1 - w1 * 0.34, y1, x1 + w1 * 0.34, y1, x2 + w2 * 0.34, y2, x2 - w2 * 0.34, y2, 'rgba(0,0,0,0.07)');
    Render.polygon(ctx, x1 - w1 * 0.16, y1, x1 + w1 * 0.16, y1, x2 + w2 * 0.16, y2, x2 - w2 * 0.16, y2, 'rgba(0,0,0,0.06)');

    /* continuous white track-limit lines just inside the kerbs */
    Render.polygon(ctx, x1 - w1 * 0.985, y1, x1 - w1 * 0.935, y1, x2 - w2 * 0.935, y2, x2 - w2 * 0.985, y2, 'rgba(240,242,245,0.8)');
    Render.polygon(ctx, x1 + w1 * 0.935, y1, x1 + w1 * 0.985, y1, x2 + w2 * 0.985, y2, x2 + w2 * 0.935, y2, 'rgba(240,242,245,0.8)');

    /* No lane markings: a grand prix circuit is one unbroken ribbon
       of tarmac, not a motorway. */

    /* pit apron along the right of the opening straight */
    if (seg.pit) {
      Render.polygon(ctx, x1 + w1 + r1, y1, x1 + w1 * 1.66, y1, x2 + w2 * 1.66, y2, x2 + w2 + r2, y2, '#4a4e55');
      Render.polygon(ctx, x1 + w1 + r1, y1, x1 + w1 + r1 * 1.6, y1, x2 + w2 + r2 * 1.6, y2, x2 + w2 + r2, y2, '#e8ebee');
      /* pit boxes: dashed dark bays along the outside */
      if (seg.dark) {
        Render.polygon(ctx, x1 + w1 * 1.40, y1, x1 + w1 * 1.60, y1, x2 + w2 * 1.60, y2, x2 + w2 * 1.40, y2, 'rgba(0,0,0,0.18)');
      }
    }

    if (theme.walls) {
      /* One continuous barrier, the way a street circuit reads: a
         light face, a red accent band along the top, and no per-stripe
         colour changes or dark caps - those broke the wall into
         floating slabs once the haze ate the light faces. */
      var h1 = w1 * 0.36;
      var h2 = w2 * 0.36;
      var wc = theme.wallColor[0];
      var band1 = h1 * 0.16;
      var band2 = h2 * 0.16;
      var lx1 = x1 - w1 - r1, lx2 = x2 - w2 - r2;
      var rx1 = x1 + w1 + r1, rx2 = x2 + w2 + r2;

      Render.polygon(ctx, lx1, y1, lx1, y1 - h1, lx2, y2 - h2, lx2, y2, wc);
      Render.polygon(ctx, lx1, y1, lx1, y1 - h1 * 0.45, lx2, y2 - h2 * 0.45, lx2, y2, 'rgba(0,0,0,0.10)');
      Render.polygon(ctx, lx1, y1 - h1, lx1, y1 - h1 + band1, lx2, y2 - h2 + band2, lx2, y2 - h2, '#d43c3c');

      /* the right wall steps aside where the pit lane runs */
      if (!seg.pit) {
        Render.polygon(ctx, rx1, y1, rx1, y1 - h1, rx2, y2 - h2, rx2, y2, wc);
        Render.polygon(ctx, rx1, y1, rx1, y1 - h1 * 0.45, rx2, y2 - h2 * 0.45, rx2, y2, 'rgba(0,0,0,0.10)');
        Render.polygon(ctx, rx1, y1 - h1, rx1, y1 - h1 + band1, rx2, y2 - h2 + band2, rx2, y2 - h2, '#d43c3c');
      }
    }

    Render.fog(ctx, 0, y1, width, y2 - y1, fog, theme.haze);
  },

  rumbleWidth: function (projectedRoadWidth, lanes) {
    return projectedRoadWidth / Math.max(6, 2 * lanes);
  },

  /* 'rgba(r,g,b,a)' from a '#rrggbb' hex */
  rgba: function (hex, a) {
    var n = parseInt(hex.slice(1), 16);
    return 'rgba(' + (n >> 16 & 255) + ',' + (n >> 8 & 255) + ',' + (n & 255) + ',' + a + ')';
  },

  /* a darker (f<1) or lighter (f>1) version of a '#rrggbb' colour */
  shade: function (hex, f) {
    var n = parseInt(hex.slice(1), 16);
    return 'rgb(' +
      Math.min(255, Math.round((n >> 16 & 255) * f)) + ',' +
      Math.min(255, Math.round((n >> 8 & 255) * f)) + ',' +
      Math.min(255, Math.round((n & 255) * f)) + ')';
  },

  /* ----------------------------------------------------------------
     Sky: a plain gradient fading into haze at the horizon. No fake
     skyline, no props - a race circuit is about the road.
     ---------------------------------------------------------------- */
  background: function (ctx, width, height, theme) {
    var sky = ctx.createLinearGradient(0, 0, 0, height * 0.62);
    sky.addColorStop(0, theme.sky[0]);
    sky.addColorStop(0.6, theme.sky[1]);
    sky.addColorStop(1, theme.sky[2]);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, height);

    /* atmosphere pooling on the horizon, so road and sky meet softly
       instead of along a razor edge */
    var top = height * 0.36;
    var band = ctx.createLinearGradient(0, top, 0, height * 0.505);
    band.addColorStop(0, Render.rgba(theme.haze, 0));
    band.addColorStop(1, Render.rgba(theme.haze, 0.85));
    ctx.fillStyle = band;
    ctx.fillRect(0, top, width, height * 0.505 - top);
  },

  /* ----------------------------------------------------------------
     Trackside objects, all drawn from primitives.
     ---------------------------------------------------------------- */
  /* `side` is -1 (left of the anchor), +1 (right) or 0 (straddling the
     road, used by the start gantry). Sizes are expressed as multiples
     of the projected half-road-width, so scenery shrinks with distance
     exactly like the tarmac does. */
  sprite: function (ctx, width, height, roadWidth, type, scale, destX, destY, side, clipY, fog, seed) {
    var halfRoad = (scale * roadWidth * width) / 2;
    var w = halfRoad * Render.spriteSize(type);
    var h = w * Render.spriteRatio(type);
    if (w < 2 || h < 2) return;

    /* distant objects sink into the haze like the road does */
    var a = fog === undefined ? 1 : Util.limit(fog, 0, 1);
    if (a < 0.05) return;

    var x = destX + side * w * 0.5;
    var y = destY - h;
    if (y > height || x + w < 0 || x - w > width) return;

    ctx.save();
    ctx.globalAlpha = a;
    if (clipY) {
      var visible = clipY - y;
      if (visible <= 0) { ctx.restore(); return; }
      /* wider than the sprite box: roofs and side faces overhang it */
      ctx.beginPath();
      ctx.rect(x - w, y, w * 2, Math.min(h, visible));
      ctx.clip();
    }
    Render.drawSprite(ctx, type, x, y, w, h, seed || 0, side);
    ctx.restore();
  },

  spriteSize: function (type) {
    switch (type) {
      case 'gantry': return 2.7;
      case 'grandstand': return 2.3;
      case 'pitbuilding': return 1.7;
      case 'billboard': return 0.95;
      case 'board1': case 'board2': case 'board3': return 0.26;
      default: return 0.5;
    }
  },

  spriteRatio: function (type) {
    switch (type) {
      case 'gantry': return 0.5;
      case 'grandstand': return 0.40;
      case 'pitbuilding': return 0.42;
      case 'billboard': return 0.30;
      case 'board1': case 'board2': case 'board3': return 1.2;
      default: return 1.5;
    }
  },

  /* stable pseudo-random 0..1 from integers - crowds must not flicker */
  hash: function (n) {
    var s = Math.sin(n * 127.1) * 43758.5453;
    return s - Math.floor(s);
  },

  crowdColors: ['#e8535c', '#f2b134', '#4fc3f7', '#9ccc65', '#f48fb1', '#ce93d8', '#eeeeee', '#ffab61'],

  /* x,y is the top-centre of the sprite box; w,h its full size.
     `seed` keeps per-instance detail stable; `side` leans roofs and
     side faces toward the track for a polygonal sense of depth. */
  drawSprite: function (ctx, type, x, y, w, h, seed, side) {
    var hw = w * 0.5;
    var lean = side < 0 ? 1 : -1;   // the track-facing end of the sprite
    switch (type) {
      case 'grandstand': {
        /* A tiered wedge stepping down toward the circuit - seating
           bowl, not a building. Each step carries a scatter of tiny
           spectators; the whole thing sits under a cantilever roof. */
        var steps = 6;
        var topW = 0.62, frontW = 1.0;
        ctx.fillStyle = 'rgba(0,0,0,0.20)';
        ctx.fillRect(x - hw * 1.02, y + h * 0.86, w * 1.02, h * 0.05);

        for (var r = 0; r < steps; r++) {
          var t0 = r / steps, t1 = (r + 1) / steps;
          var sy0 = y + h * (0.24 + 0.62 * t0);
          var sy1 = y + h * (0.24 + 0.62 * t1);
          var w0 = hw * (topW + (frontW - topW) * t0);
          var w1b = hw * (topW + (frontW - topW) * t1);
          /* step face, as a trapezoid so the bowl visibly leans back */
          ctx.fillStyle = r % 2 ? '#454b53' : '#3d434b';
          ctx.beginPath();
          ctx.moveTo(x - w0, sy0);
          ctx.lineTo(x + w0, sy0);
          ctx.lineTo(x + w1b, sy1);
          ctx.lineTo(x - w1b, sy1);
          ctx.closePath();
          ctx.fill();

          /* the crowd: tiny stable specks, not windows */
          if (w > 60) {
            var cols = 24;
            for (var c = 0; c < cols; c++) {
              var jx = Render.hash(seed * 31 + r * 17 + c * 7);
              if (jx < 0.14) continue;      // empty seats here and there
              ctx.fillStyle = Render.crowdColors[
                Math.floor(jx * Render.crowdColors.length)];
              ctx.fillRect(
                x - w0 + (c + jx * 0.6) * (w0 * 2 / cols),
                sy0 + (sy1 - sy0) * 0.12,
                Math.max(1.5, w * 0.013),
                (sy1 - sy0) * 0.40
              );
            }
          } else {
            ctx.fillStyle = 'rgba(215,185,160,0.4)';
            ctx.fillRect(x - w0 * 0.94, sy0 + (sy1 - sy0) * 0.12, w0 * 1.88, (sy1 - sy0) * 0.35);
          }
        }

        /* end wall on the track-facing side, skewed for depth */
        ctx.fillStyle = '#2f353d';
        ctx.beginPath();
        if (lean > 0) {
          ctx.moveTo(x + hw * topW, y + h * 0.24);
          ctx.lineTo(x + hw * 1.14, y + h * 0.34);
          ctx.lineTo(x + hw * 1.14, y + h * 0.88);
          ctx.lineTo(x + hw, y + h * 0.86);
        } else {
          ctx.moveTo(x - hw * topW, y + h * 0.24);
          ctx.lineTo(x - hw * 1.14, y + h * 0.34);
          ctx.lineTo(x - hw * 1.14, y + h * 0.88);
          ctx.lineTo(x - hw, y + h * 0.86);
        }
        ctx.closePath();
        ctx.fill();

        /* cantilever roof, leaning over the seats toward the track */
        ctx.fillStyle = '#20242a';
        ctx.beginPath();
        ctx.moveTo(x - hw * (lean > 0 ? 0.70 : 1.10), y + h * 0.05);
        ctx.lineTo(x + hw * (lean > 0 ? 1.10 : 0.70), y + h * 0.05);
        ctx.lineTo(x + hw * (lean > 0 ? 1.16 : 0.74), y + h * 0.16);
        ctx.lineTo(x - hw * (lean > 0 ? 0.74 : 1.16), y + h * 0.16);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#e8ebee';
        ctx.fillRect(x - hw * (lean > 0 ? 0.74 : 1.16), y + h * 0.155,
                     hw * 1.9, h * 0.035);

        /* slender roof masts */
        ctx.fillStyle = '#59606a';
        ctx.fillRect(x - hw * 0.55, y + h * 0.16, Math.max(1.5, hw * 0.045), h * 0.24);
        ctx.fillRect(x + hw * 0.50, y + h * 0.16, Math.max(1.5, hw * 0.045), h * 0.24);
        break;
      }

      case 'billboard': {
        /* a low trackside hoarding, not a pole sign */
        ctx.fillStyle = 'rgba(0,0,0,0.18)';
        ctx.fillRect(x - hw * 0.98, y + h * 0.88, w * 0.98, h * 0.06);
        ctx.fillStyle = '#f2f3f5';
        ctx.fillRect(x - hw, y + h * 0.18, w, h * 0.64);
        var logos = ['#c62828', '#1a56b0', '#0b8f5a', '#20242a'];
        ctx.fillStyle = logos[Math.floor(Render.hash(seed * 13 + 5) * logos.length)];
        var lw2 = w * (0.4 + Render.hash(seed * 7 + 1) * 0.25);
        ctx.fillRect(x - hw * 0.88, y + h * 0.36, lw2, h * 0.28);
        ctx.fillStyle = '#20242a';
        ctx.fillRect(x - hw, y + h * 0.76, w, h * 0.06);
        break;
      }

      case 'pitbuilding': {
        /* the long low garage block behind the pit apron */
        ctx.fillStyle = '#9aa1a9';
        ctx.fillRect(x - hw, y + h * 0.18, w, h * 0.70);
        /* roof slab with a light fascia */
        ctx.fillStyle = '#282d34';
        ctx.fillRect(x - hw * 1.05, y + h * 0.10, w * 1.05, h * 0.12);
        ctx.fillStyle = '#e8ebee';
        ctx.fillRect(x - hw * 1.05, y + h * 0.20, w * 1.05, h * 0.045);
        /* garage bays, each with a team-coloured strip above the door */
        var bays = 4;
        for (var b2 = 0; b2 < bays; b2++) {
          var bx = x - hw * 0.92 + b2 * (w * 0.92 / bays) * 1.0;
          var bw2 = (w * 0.92 / bays) * 0.72;
          ctx.fillStyle = Render.crowdColors[
            Math.floor(Render.hash(seed * 19 + b2 * 11) * Render.crowdColors.length)];
          ctx.fillRect(bx, y + h * 0.30, bw2, h * 0.07);
          ctx.fillStyle = '#171b20';
          ctx.fillRect(bx, y + h * 0.38, bw2, h * 0.46);
        }
        ctx.fillStyle = 'rgba(0,0,0,0.20)';
        ctx.fillRect(x - hw, y + h * 0.85, w, h * 0.05);
        break;
      }

      case 'board1': case 'board2': case 'board3':
        ctx.fillStyle = '#20242a';
        ctx.fillRect(x - hw, y, w, h * 0.7);
        ctx.fillStyle = '#8b939c';
        ctx.fillRect(x - w * 0.06, y + h * 0.7, w * 0.12, h * 0.3);
        ctx.fillStyle = '#f5c518';
        var bars = type === 'board1' ? 1 : type === 'board2' ? 2 : 3;
        for (var bb = 0; bb < bars; bb++) {
          ctx.fillRect(x - hw * 0.55, y + h * (0.12 + bb * 0.18), w * 0.55, h * 0.10);
        }
        break;

      case 'gantry':
        ctx.fillStyle = '#2b3138';
        ctx.fillRect(x - hw, y, hw * 2, h * 0.28);
        ctx.fillRect(x - hw, y, hw * 0.16, h);
        ctx.fillRect(x + hw * 0.84, y, hw * 0.16, h);
        ctx.fillStyle = '#12161b';
        ctx.fillRect(x - hw * 0.55, y + h * 0.05, hw * 1.1, h * 0.18);
        ctx.fillStyle = '#e2000f';
        for (var lt = 0; lt < 5; lt++) {
          ctx.beginPath();
          ctx.arc(x - hw * 0.4 + lt * hw * 0.2, y + h * 0.14, h * 0.05, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
    }
  },

  /* ----------------------------------------------------------------
     A rival car, seen from behind: wing on its pylon with endplates,
     halo over the cockpit, shark-fin engine cover, diffuser strakes,
     and slick tyres with a compound-coloured sidewall band.
     ---------------------------------------------------------------- */
  car: function (ctx, width, height, roadWidth, color, scale, destX, destY, clipY, fog, tyreColor, persp) {
    /* an F1 car is roughly a sixth of the road's width - with the
       road at its full grand-prix width, that is 0.15 of a half */
    var halfRoad = (scale * roadWidth * width) / 2;
    var w = halfRoad * 0.15;          // half-width of the car in pixels
    var h = w * 1.05;
    var x = destX;
    var y = destY - h;
    if (h < 1.5) return;

    var a = fog === undefined ? 1 : Util.limit(fog, 0, 1);
    if (a < 0.05) return;

    /* one-point perspective: a car off to the side leans its upper
       bodywork toward the vanishing point while the tyres stay put,
       and its outer flank falls into shade */
    var p = Util.limit(persp || 0, -1, 1);
    var s = -p * w * 0.22;            // shift at wing height
    var s6 = s * 0.6;                 // shift at body-top height

    ctx.save();
    ctx.globalAlpha = a;
    if (clipY) {
      var visible = clipY - y;
      if (visible <= 0) { ctx.restore(); return; }
      ctx.beginPath();
      ctx.rect(x - w, y, w * 2, Math.min(h, visible));
      ctx.clip();
    }

    var dark = Render.shade(color, 0.62);

    /* shadow */
    ctx.fillStyle = 'rgba(0,0,0,0.32)';
    ctx.beginPath();
    ctx.ellipse(x, y + h * 0.97, w * 0.70, h * 0.09, 0, 0, Math.PI * 2);
    ctx.fill();

    /* floor and diffuser: a wide dark base under everything */
    ctx.fillStyle = '#0c0e11';
    ctx.fillRect(x - w * 0.56, y + h * 0.84, w * 1.12, h * 0.12);
    ctx.fillStyle = '#20242a';
    for (var d = -1; d <= 1; d++) {
      ctx.fillRect(x + d * w * 0.18 - w * 0.02, y + h * 0.85, w * 0.04, h * 0.11);
    }

    /* rear tyres: big, and clearly OUTSIDE the bodywork - the open
       wheels are what makes the silhouette read as a formula car */
    ctx.fillStyle = '#101317';
    ctx.fillRect(x - w * 0.66, y + h * 0.36, w * 0.29, h * 0.60);
    ctx.fillRect(x + w * 0.37, y + h * 0.36, w * 0.29, h * 0.60);
    if (tyreColor && h > 10) {
      ctx.fillStyle = tyreColor;
      ctx.fillRect(x - w * 0.66, y + h * 0.44, w * 0.29, h * 0.05);
      ctx.fillRect(x + w * 0.37, y + h * 0.44, w * 0.29, h * 0.05);
    }

    /* sidepod shoulders: low slabs in the shaded team colour */
    ctx.fillStyle = dark;
    ctx.fillRect(x - w * 0.37, y + h * 0.58, w * 0.30, h * 0.28);
    ctx.fillRect(x + w * 0.07, y + h * 0.58, w * 0.30, h * 0.28);

    /* engine cover: a narrow bright spine between the sidepods */
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x - w * 0.16, y + h * 0.86);
    ctx.lineTo(x + w * 0.16, y + h * 0.86);
    ctx.lineTo(x + w * 0.09 + s6, y + h * 0.30);
    ctx.lineTo(x - w * 0.09 + s6, y + h * 0.30);
    ctx.closePath();
    ctx.fill();

    /* the flank facing away from centre falls into shade */
    if (p && h > 6) {
      ctx.fillStyle = 'rgba(0,0,0,' + (Math.abs(p) * 0.30).toFixed(3) + ')';
      if (p > 0) {
        ctx.fillRect(x + w * 0.07, y + h * 0.58, w * 0.30, h * 0.28);
      } else {
        ctx.fillRect(x - w * 0.37, y + h * 0.58, w * 0.30, h * 0.28);
      }
    }

    /* shark fin, then the halo hooped over the cockpit */
    ctx.fillStyle = '#1a1e24';
    ctx.fillRect(x - w * 0.025 + s * 0.7, y + h * 0.12, w * 0.05, h * 0.24);
    if (h > 8) {
      ctx.strokeStyle = '#111418';
      ctx.lineWidth = Math.max(1, w * 0.075);
      ctx.beginPath();
      ctx.arc(x + s * 0.8, y + h * 0.42, w * 0.20, Math.PI, 0);
      ctx.stroke();
    }

    /* rear wing held high: dark flap over the coloured main plane,
       endplates dropping well below it */
    ctx.fillStyle = '#191d22';
    ctx.fillRect(x - w * 0.52 + s, y, w * 0.075, h * 0.30);
    ctx.fillRect(x + w * 0.445 + s, y, w * 0.075, h * 0.30);
    ctx.fillRect(x - w * 0.47 + s, y + h * 0.005, w * 0.94, h * 0.04);
    ctx.fillStyle = color;
    ctx.fillRect(x - w * 0.47 + s, y + h * 0.055, w * 0.94, h * 0.095);

    /* wing pylon with the rain light */
    ctx.fillStyle = '#14171b';
    ctx.fillRect(x - w * 0.03 + s * 0.9, y + h * 0.15, w * 0.06, h * 0.18);
    ctx.fillStyle = '#ff2a2a';
    ctx.fillRect(x - w * 0.035 + s * 0.85, y + h * 0.20, w * 0.07, h * 0.09);

    ctx.restore();
  },

  /* ----------------------------------------------------------------
     The cockpit: halo, mirrors, nose, and the steering wheel that
     turns with your input. This is what makes it first person.
     ---------------------------------------------------------------- */
  cockpit: function (ctx, width, height, state) {
    var steer = state.steer;          // -1 .. 1
    var bump = state.bump;            // vertical shake in px
    var wheelY = height * 0.945 + bump;
    var wheelW = width * 0.31;
    var wheelH = wheelW * 0.40;

    /* The bodywork rim the driver looks over. Kept low so the road,
       not the car, owns the screen. */
    var noseApex = height * 0.81;
    var rimCtrlY = noseApex - height * 0.075;

    ctx.save();
    ctx.translate(0, bump * 0.4);

    /* --- halo hoop ------------------------------------------------ */
    /* The hoop arcs across the TOP of the view - apex around 22% of
       the height, legs falling away at the extreme edges - so it
       frames the picture instead of cutting through the middle of it,
       which is where the road lives. */
    ctx.strokeStyle = '#15181d';
    ctx.lineWidth = height * 0.052;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-width * 0.02, height * 0.50);
    ctx.quadraticCurveTo(width * 0.5, -height * 0.06, width * 1.02, height * 0.50);
    ctx.stroke();

    /* a thin sheen along the hoop so it reads as carbon, not a void */
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth = height * 0.012;
    ctx.beginPath();
    ctx.moveTo(-width * 0.02, height * 0.485);
    ctx.quadraticCurveTo(width * 0.5, -height * 0.075, width * 1.02, height * 0.485);
    ctx.stroke();

    /* --- halo centre pillar: slim, apex down into the chassis ----- */
    var apexY = height * 0.215;
    ctx.fillStyle = '#15181d';
    ctx.beginPath();
    ctx.moveTo(width * 0.5 - width * 0.007, apexY);
    ctx.lineTo(width * 0.5 + width * 0.007, apexY);
    ctx.lineTo(width * 0.5 + width * 0.013, noseApex + height * 0.03);
    ctx.lineTo(width * 0.5 - width * 0.013, noseApex + height * 0.03);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    /* --- front tyres, turning with the wheel ---------------------- */
    /* The tops of the front wheels poke into view at the screen edges
       and visibly steer - the car has four corners, and from the seat
       you can see two of them working. */
    for (var fw = 0; fw < 2; fw++) {
      var fSide = fw === 0 ? -1 : 1;
      var fx = width * (fw === 0 ? 0.035 : 0.965);
      ctx.save();
      ctx.translate(fx, height * 0.70 + bump * 1.2);
      ctx.rotate(steer * 0.30);
      ctx.fillStyle = '#0e1114';
      Render.roundRect(ctx, -width * 0.034, -height * 0.115, width * 0.068, height * 0.30, width * 0.012);
      ctx.fill();
      /* sidewall sheen and a tread band, so it reads as a tyre */
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      ctx.fillRect(-width * 0.034, -height * 0.075, width * 0.068, height * 0.028);
      ctx.fillStyle = 'rgba(255,255,255,0.10)';
      ctx.fillRect(fSide * width * 0.012 - width * 0.005, -height * 0.10, width * 0.010, height * 0.26);
      ctx.restore();
    }

    /* --- nose / bodywork ----------------------------------------- */
    ctx.save();
    ctx.translate(0, bump);
    var body = ctx.createLinearGradient(0, noseApex, 0, height);
    body.addColorStop(0, '#242a33');
    body.addColorStop(1, '#0b0e12');
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.moveTo(-width * 0.05, height * 1.02);
    ctx.lineTo(-width * 0.05, height * 0.97);
    ctx.quadraticCurveTo(width * 0.5, rimCtrlY, width * 1.05, height * 0.97);
    ctx.lineTo(width * 1.05, height * 1.02);
    ctx.closePath();
    ctx.fill();

    /* team stripe along the cockpit rim */
    ctx.strokeStyle = state.accent;
    ctx.lineWidth = Math.max(2, height * 0.005);
    ctx.beginPath();
    ctx.moveTo(-width * 0.05, height * 0.97);
    ctx.quadraticCurveTo(width * 0.5, rimCtrlY, width * 1.05, height * 0.97);
    ctx.stroke();

    /* --- cockpit side cowls: the humps the mirrors sit on --------- */
    var cowl = ctx.createLinearGradient(0, height * 0.60, 0, height);
    cowl.addColorStop(0, '#2a313b');
    cowl.addColorStop(1, '#0d1015');
    ctx.fillStyle = cowl;
    ctx.beginPath();
    ctx.moveTo(-width * 0.06, height * 1.05);
    ctx.quadraticCurveTo(width * 0.19, height * 0.35, width * 0.44, height * 1.05);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(width * 1.06, height * 1.05);
    ctx.quadraticCurveTo(width * 0.81, height * 0.35, width * 0.56, height * 1.05);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    /* --- mirrors: perched on the cowl peaks ----------------------- */
    var mirrorW = width * 0.095;
    /* Cap against the width too: on a tall portrait screen a flat
       fraction of height makes the housing taller than it is wide. */
    var mirrorH = Math.min(height * 0.05, mirrorW * 0.45);

    for (var m = 0; m < 2; m++) {
      var mSide = m === 0 ? -1 : 1;
      var mx = width * (m === 0 ? 0.19 : 0.81);
      var foot = height * 0.74 + bump;
      var my = height * 0.645 + bump * 0.5;
      Render.mirror(ctx, mx, my, mirrorW, mirrorH, state, mSide, foot);
    }

    /* --- steering wheel ------------------------------------------ */
    ctx.save();
    ctx.translate(width * 0.5, wheelY);
    ctx.rotate(steer * 0.55);

    ctx.fillStyle = '#191d23';
    Render.roundRect(ctx, -wheelW / 2, -wheelH / 2, wheelW, wheelH, wheelW * 0.09);
    ctx.fill();

    /* grips */
    ctx.fillStyle = '#0b0d10';
    Render.roundRect(ctx, -wheelW / 2, -wheelH * 0.55, wheelW * 0.22, wheelH * 1.1, wheelW * 0.06);
    ctx.fill();
    Render.roundRect(ctx, wheelW / 2 - wheelW * 0.22, -wheelH * 0.55, wheelW * 0.22, wheelH * 1.1, wheelW * 0.06);
    ctx.fill();

    /* rev lights across the top of the wheel */
    var lights = 12;
    for (var i = 0; i < lights; i++) {
      var lit = state.rpm > (i + 1) / lights;
      var col = i < 5 ? '#12d16b' : i < 9 ? '#e2000f' : '#3b7dff';
      ctx.fillStyle = lit ? col : 'rgba(255,255,255,0.10)';
      if (lit && state.rpm > 0.97 && (state.blink | 0) % 2 === 0) ctx.fillStyle = '#3b7dff';
      ctx.fillRect(-wheelW * 0.36 + i * (wheelW * 0.72 / lights), -wheelH * 0.40, wheelW * 0.72 / lights - 2, wheelH * 0.10);
    }

    /* wheel display */
    ctx.fillStyle = '#05070a';
    Render.roundRect(ctx, -wheelW * 0.22, -wheelH * 0.22, wheelW * 0.44, wheelH * 0.46, wheelW * 0.03);
    ctx.fill();

    ctx.textAlign = 'center';
    ctx.fillStyle = '#eaeef2';
    ctx.font = '700 ' + Math.round(wheelH * 0.30) + 'px "Segoe UI", system-ui, sans-serif';
    ctx.fillText(state.gear, 0, wheelH * 0.10);
    ctx.fillStyle = state.drs ? '#12d16b' : '#69727d';
    ctx.font = '700 ' + Math.round(wheelH * 0.12) + 'px "Segoe UI", system-ui, sans-serif';
    ctx.fillText(state.drs ? 'DRS' : 'ERS', 0, wheelH * 0.22);

    ctx.restore();
  },

  mirror: function (ctx, cx, cy, w, h, state, side, mountY) {
    ctx.save();

    /* A short stalk straight down into the cowl the housing sits on.
       Without it the housing is a box floating in mid-air, which reads
       as a glitch rather than a mirror. */
    ctx.strokeStyle = '#15181d';
    ctx.lineWidth = Math.max(2, h * 0.22);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx, cy + h * 0.40);
    ctx.lineTo(cx - side * w * 0.08, mountY);
    ctx.stroke();

    ctx.fillStyle = '#101318';
    Render.roundRect(ctx, cx - w / 2, cy - h / 2, w, h, h * 0.25);
    ctx.fill();
    ctx.fillStyle = 'rgba(120,150,175,0.35)';
    Render.roundRect(ctx, cx - w / 2 + w * 0.05, cy - h / 2 + h * 0.12, w * 0.9, h * 0.76, h * 0.2);
    ctx.fill();

    /* whoever is close behind shows up as a shape in the glass */
    var behind = state.behind;
    if (behind) {
      var t = Util.limit(1 - behind.distance, 0, 1);
      var bw = w * 0.30 * (0.4 + t * 0.6);
      var bx = cx + side * behind.offset * w * 0.25;
      ctx.fillStyle = behind.color;
      ctx.fillRect(bx - bw / 2, cy + h * 0.10 - bw * 0.35, bw, bw * 0.45);
      ctx.fillStyle = '#0f1114';
      ctx.fillRect(bx - bw * 0.6, cy + h * 0.14, bw * 0.2, bw * 0.3);
      ctx.fillRect(bx + bw * 0.4, cy + h * 0.14, bw * 0.2, bw * 0.3);
    }
    ctx.restore();
  },

  roundRect: function (ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  },

  /* ----------------------------------------------------------------
     Monaco's tunnel: a dark ceiling, sodium glow, and a run of strip
     lights receding overhead. Faded in and out by `t`.
     ---------------------------------------------------------------- */
  tunnel: function (ctx, width, height, t) {
    if (t < 0.02) return;

    var ceil = ctx.createLinearGradient(0, 0, 0, height * 0.52);
    ceil.addColorStop(0, 'rgba(12,9,6,' + (0.96 * t).toFixed(3) + ')');
    ceil.addColorStop(0.7, 'rgba(12,9,6,' + (0.55 * t).toFixed(3) + ')');
    ceil.addColorStop(1, 'rgba(12,9,6,0)');
    ctx.fillStyle = ceil;
    ctx.fillRect(0, 0, width, height * 0.52);

    /* sodium-lamp warmth over everything */
    ctx.fillStyle = 'rgba(255,150,40,' + (0.10 * t).toFixed(3) + ')';
    ctx.fillRect(0, 0, width, height);

    /* the ceiling strip lights, receding toward the exit */
    for (var i = 0; i < 8; i++) {
      var p = i / 8;
      var y = height * (0.06 + 0.38 * Math.pow(p, 1.6));
      var lw = width * 0.14 * (1 - p * 0.9);
      ctx.fillStyle = 'rgba(255,200,110,' + (0.6 * t * (1 - p * 0.6)).toFixed(3) + ')';
      ctx.fillRect(width / 2 - lw / 2, y, lw, Math.max(1.5, height * 0.010 * (1 - p * 0.7)));
    }
  },

  /* constant soft vignette pulling the eye to the road. A full-screen
     radial gradient is ~18ms a frame if rebuilt live, so it is drawn
     once to an offscreen canvas and blitted. */
  vignette: function (ctx, width, height) {
    var c = Render._vig;
    if (!c || c.width !== width || c.height !== height) {
      c = Render._vig = document.createElement('canvas');
      c.width = width;
      c.height = height;
      var vctx = c.getContext('2d');
      var g = vctx.createRadialGradient(
        width / 2, height * 0.45, height * 0.40,
        width / 2, height * 0.45, height * 1.0
      );
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(0,0,0,0.22)');
      vctx.fillStyle = g;
      vctx.fillRect(0, 0, width, height);
    }
    ctx.drawImage(c, 0, 0);
  },

  /* speed blur creeping in from the edges at high speed. Cached at
     full strength; per-frame intensity rides on globalAlpha. */
  speedLines: function (ctx, width, height, intensity) {
    if (intensity <= 0.02) return;
    var c = Render._blur;
    if (!c || c.width !== width || c.height !== height) {
      c = Render._blur = document.createElement('canvas');
      c.width = width;
      c.height = height;
      var bctx = c.getContext('2d');
      var g = bctx.createRadialGradient(
        width / 2, height / 2, height * 0.25,
        width / 2, height / 2, height * 0.85
      );
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(0,0,0,0.55)');
      bctx.fillStyle = g;
      bctx.fillRect(0, 0, width, height);
    }
    ctx.globalAlpha = Util.limit(intensity, 0, 1);
    ctx.drawImage(c, 0, 0);
    ctx.globalAlpha = 1;
  }
};
