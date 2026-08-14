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
    var l1 = Render.laneMarkerWidth(w1, lanes);
    var l2 = Render.laneMarkerWidth(w2, lanes);
    var i = seg.dark ? 0 : 1;

    ctx.fillStyle = theme.grass[i];
    ctx.fillRect(0, y2, width, y1 - y2);

    Render.polygon(ctx, x1 - w1 - r1, y1, x1 - w1, y1, x2 - w2, y2, x2 - w2 - r2, y2, theme.rumble[i]);
    Render.polygon(ctx, x1 + w1 + r1, y1, x1 + w1, y1, x2 + w2, y2, x2 + w2 + r2, y2, theme.rumble[i]);
    Render.polygon(ctx, x1 - w1, y1, x1 + w1, y1, x2 + w2, y2, x2 - w2, y2, theme.road[i]);

    if (!seg.dark) {
      var lanew1 = (w1 * 2) / lanes;
      var lanew2 = (w2 * 2) / lanes;
      var lanex1 = x1 - w1 + lanew1;
      var lanex2 = x2 - w2 + lanew2;
      for (var lane = 1; lane < lanes; lane++) {
        Render.polygon(ctx, lanex1 - l1 / 2, y1, lanex1 + l1 / 2, y1,
                            lanex2 + l2 / 2, y2, lanex2 - l2 / 2, y2, theme.lane);
        lanex1 += lanew1;
        lanex2 += lanew2;
      }
    }

    if (theme.walls) {
      var h1 = w1 * 0.42;
      var h2 = w2 * 0.42;
      var wc = theme.wallColor[i];
      var cap1 = h1 * 0.18;
      var cap2 = h2 * 0.18;
      var lx1 = x1 - w1 - r1, lx2 = x2 - w2 - r2;
      var rx1 = x1 + w1 + r1, rx2 = x2 + w2 + r2;

      Render.polygon(ctx, lx1, y1, lx1, y1 - h1, lx2, y2 - h2, lx2, y2, wc);
      Render.polygon(ctx, rx1, y1, rx1, y1 - h1, rx2, y2 - h2, rx2, y2, wc);

      /* dark rail along the top of the barrier so it reads as Armco */
      var rail = seg.dark ? '#2c3138' : '#242930';
      Render.polygon(ctx, lx1, y1 - h1, lx1, y1 - h1 + cap1, lx2, y2 - h2 + cap2, lx2, y2 - h2, rail);
      Render.polygon(ctx, rx1, y1 - h1, rx1, y1 - h1 + cap1, rx2, y2 - h2 + cap2, rx2, y2 - h2, rail);
    }

    Render.fog(ctx, 0, y1, width, y2 - y1, fog, theme.haze);
  },

  rumbleWidth: function (projectedRoadWidth, lanes) {
    return projectedRoadWidth / Math.max(6, 2 * lanes);
  },

  laneMarkerWidth: function (projectedRoadWidth, lanes) {
    return projectedRoadWidth / Math.max(32, 8 * lanes);
  },

  /* ----------------------------------------------------------------
     Sky, sun and a parallax skyline that shifts with the corners.
     ---------------------------------------------------------------- */
  background: function (ctx, width, height, theme, offset, horizonShift) {
    var sky = ctx.createLinearGradient(0, 0, 0, height * 0.62);
    sky.addColorStop(0, theme.sky[0]);
    sky.addColorStop(0.6, theme.sky[1]);
    sky.addColorStop(1, theme.sky[2]);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, height);

    var horizon = height * 0.5 + horizonShift;

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, width, Math.max(0, horizon));
    ctx.clip();

    var sunX = width * 0.72;
    var sunY = horizon - height * 0.28;
    var sunR = height * 0.14;
    var glow = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, sunR);
    glow.addColorStop(0, 'rgba(255,250,232,0.85)');
    glow.addColorStop(0.35, 'rgba(255,248,222,0.30)');
    glow.addColorStop(1, 'rgba(255,248,222,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(sunX, sunY, sunR, 0, Math.PI * 2);
    ctx.fill();

    if (theme.background === 'city') {
      Render.skyline(ctx, width, horizon, offset * 0.5, height * 0.20, '#7d90a8');
      Render.skyline(ctx, width, horizon, offset * 0.9, height * 0.13, '#95a7bd');
    } else {
      Render.ridge(ctx, width, horizon, offset * 0.4, height * 0.13, '#6d7f8c');
      Render.ridge(ctx, width, horizon, offset * 0.8, height * 0.08, '#8496a1');
    }
    ctx.restore();
  },

  skyline: function (ctx, width, horizon, offset, maxH, color) {
    ctx.fillStyle = color;
    var step = width / 22;
    var shift = ((offset % (step * 2)) + step * 2) % (step * 2);
    for (var i = -2; i < 24; i++) {
      var x = i * step - shift;
      var seed = Math.abs(Math.sin(i * 12.9898) * 43758.5453) % 1;
      var h = maxH * (0.35 + seed * 0.65);
      ctx.fillRect(x, horizon - h, step * 0.86, h);
    }
  },

  ridge: function (ctx, width, horizon, offset, maxH, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(-10, horizon);
    for (var x = -10; x <= width + 10; x += 12) {
      var t = (x + offset) * 0.0022;
      var y = horizon - maxH * (0.45 + 0.28 * Math.sin(t) + 0.27 * Math.sin(t * 2.7 + 1.1));
      ctx.lineTo(x, y);
    }
    ctx.lineTo(width + 10, horizon);
    ctx.closePath();
    ctx.fill();
  },

  /* ----------------------------------------------------------------
     Trackside objects, all drawn from primitives.
     ---------------------------------------------------------------- */
  /* `side` is -1 (left of the anchor), +1 (right) or 0 (straddling the
     road, used by the start gantry). Sizes are expressed as multiples
     of the projected half-road-width, so scenery shrinks with distance
     exactly like the tarmac does. */
  sprite: function (ctx, width, height, roadWidth, type, scale, destX, destY, side, clipY) {
    var halfRoad = (scale * roadWidth * width) / 2;
    var w = halfRoad * Render.spriteSize(type);
    var h = w * Render.spriteRatio(type);
    if (w < 2 || h < 2) return;

    var x = destX + side * w * 0.5;
    var y = destY - h;
    if (y > height || x + w < 0 || x - w > width) return;

    ctx.save();
    if (clipY) {
      var visible = clipY - y;
      if (visible <= 0) { ctx.restore(); return; }
      ctx.beginPath();
      ctx.rect(x - w / 2, y, w, Math.min(h, visible));
      ctx.clip();
    }
    Render.drawSprite(ctx, type, x, y, w, h);
    ctx.restore();
  },

  spriteSize: function (type) {
    switch (type) {
      case 'gantry': return 2.7;
      case 'grandstand': return 1.9;
      case 'building': return 1.5;
      case 'ferris': return 1.3;
      case 'yacht': return 1.2;
      case 'billboard': return 0.7;
      case 'board1': case 'board2': case 'board3': return 0.26;
      case 'palm': return 0.55;
      default: return 0.5;
    }
  },

  spriteRatio: function (type) {
    switch (type) {
      case 'gantry': return 0.5;
      case 'grandstand': return 0.5;
      case 'building': return 2.2;
      case 'ferris': return 1.05;
      case 'yacht': return 0.55;
      case 'billboard': return 0.7;
      case 'board1': case 'board2': case 'board3': return 1.2;
      case 'palm': return 1.9;
      default: return 1.5;
    }
  },

  /* x,y is the top-centre of the sprite box; w,h its full size */
  drawSprite: function (ctx, type, x, y, w, h) {
    var hw = w * 0.5;
    switch (type) {
      case 'tree':
        ctx.fillStyle = '#4b3623';
        ctx.fillRect(x - hw * 0.08, y + h * 0.55, hw * 0.16, h * 0.45);
        ctx.fillStyle = '#2f5c2c';
        ctx.beginPath();
        ctx.ellipse(x, y + h * 0.38, hw * 0.62, h * 0.42, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#3a7035';
        ctx.beginPath();
        ctx.ellipse(x - hw * 0.15, y + h * 0.3, hw * 0.4, h * 0.3, 0, 0, Math.PI * 2);
        ctx.fill();
        break;

      case 'palm':
        ctx.strokeStyle = '#6b5334';
        ctx.lineWidth = Math.max(1, hw * 0.12);
        ctx.beginPath();
        ctx.moveTo(x, y + h);
        ctx.quadraticCurveTo(x + hw * 0.15, y + h * 0.5, x + hw * 0.05, y + h * 0.22);
        ctx.stroke();
        ctx.fillStyle = '#2e6b3c';
        for (var a = 0; a < 6; a++) {
          var ang = (Math.PI / 6) * a + Math.PI;
          ctx.beginPath();
          ctx.moveTo(x + hw * 0.05, y + h * 0.22);
          ctx.quadraticCurveTo(
            x + hw * 0.05 + Math.cos(ang) * hw * 0.5,
            y + h * 0.22 + Math.sin(ang) * h * 0.16,
            x + hw * 0.05 + Math.cos(ang) * hw * 0.85,
            y + h * 0.22 + Math.sin(ang) * h * 0.28 + h * 0.06
          );
          ctx.lineWidth = Math.max(1, hw * 0.16);
          ctx.strokeStyle = '#2e6b3c';
          ctx.stroke();
        }
        break;

      case 'building':
        ctx.fillStyle = '#c9c2b4';
        ctx.fillRect(x - hw, y, w, h);
        ctx.fillStyle = 'rgba(60,80,110,0.75)';
        var cols = 4, rows = Math.max(3, Math.round(h / (w * 0.6)));
        for (var r = 0; r < rows; r++) {
          for (var c = 0; c < cols; c++) {
            ctx.fillRect(
              x - hw * 0.72 + (c * w * 0.72) / cols,
              y + h * 0.05 + (r * h * 0.92) / rows,
              (w * 0.42) / cols,
              (h * 0.5) / rows
            );
          }
        }
        break;

      case 'yacht':
        ctx.fillStyle = '#f2f2f2';
        ctx.beginPath();
        ctx.moveTo(x - hw, y + h);
        ctx.lineTo(x + hw, y + h);
        ctx.lineTo(x + hw * 0.75, y + h * 0.55);
        ctx.lineTo(x - hw * 0.8, y + h * 0.55);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#dfe6ea';
        ctx.fillRect(x - hw * 0.45, y + h * 0.12, hw * 0.9, h * 0.45);
        break;

      case 'grandstand':
        ctx.fillStyle = '#8d939b';
        ctx.fillRect(x - hw, y + h * 0.15, hw * 2, h * 0.85);
        for (var s = 0; s < 6; s++) {
          ctx.fillStyle = s % 2 ? '#d8dde2' : '#b3bac2';
          ctx.fillRect(x - hw, y + h * 0.25 + s * h * 0.12, hw * 2, h * 0.09);
        }
        ctx.fillStyle = '#2b3138';
        ctx.fillRect(x - hw * 1.05, y, hw * 2.1, h * 0.18);
        break;

      case 'ferris':
        ctx.strokeStyle = '#d0d6dc';
        ctx.lineWidth = Math.max(1, hw * 0.06);
        ctx.beginPath();
        ctx.arc(x, y + h * 0.42, hw * 0.85, 0, Math.PI * 2);
        ctx.stroke();
        for (var k = 0; k < 8; k++) {
          var t = (Math.PI / 4) * k;
          ctx.beginPath();
          ctx.moveTo(x, y + h * 0.42);
          ctx.lineTo(x + Math.cos(t) * hw * 0.85, y + h * 0.42 + Math.sin(t) * hw * 0.85);
          ctx.stroke();
        }
        break;

      case 'billboard':
        ctx.fillStyle = '#4a4f57';
        ctx.fillRect(x - hw * 0.06, y + h * 0.5, hw * 0.12, h * 0.5);
        ctx.fillStyle = '#e8eaed';
        ctx.fillRect(x - hw, y, hw * 2, h * 0.55);
        ctx.fillStyle = '#c62828';
        ctx.fillRect(x - hw * 0.9, y + h * 0.08, hw * 1.8, h * 0.12);
        break;

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
     A rival car, seen from behind: rear wing, diffuser, fat tyres.
     ---------------------------------------------------------------- */
  car: function (ctx, width, height, roadWidth, color, scale, destX, destY, clipY) {
    /* an F1 car is roughly a sixth of the road's width */
    var halfRoad = (scale * roadWidth * width) / 2;
    var w = halfRoad * 0.20;          // half-width of the car in pixels
    var h = w * 1.05;
    var x = destX;
    var y = destY - h;
    if (h < 1.5) return;

    ctx.save();
    if (clipY) {
      var visible = clipY - y;
      if (visible <= 0) { ctx.restore(); return; }
      ctx.beginPath();
      ctx.rect(x - w, y, w * 2, Math.min(h, visible));
      ctx.clip();
    }

    /* shadow */
    ctx.fillStyle = 'rgba(0,0,0,0.32)';
    ctx.beginPath();
    ctx.ellipse(x, y + h * 0.97, w * 0.62, h * 0.1, 0, 0, Math.PI * 2);
    ctx.fill();

    /* tyres */
    ctx.fillStyle = '#16181c';
    ctx.fillRect(x - w * 0.58, y + h * 0.42, w * 0.26, h * 0.52);
    ctx.fillRect(x + w * 0.32, y + h * 0.42, w * 0.26, h * 0.52);

    /* body + engine cover */
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x - w * 0.3, y + h * 0.95);
    ctx.lineTo(x + w * 0.3, y + h * 0.95);
    ctx.lineTo(x + w * 0.2, y + h * 0.42);
    ctx.lineTo(x - w * 0.2, y + h * 0.42);
    ctx.closePath();
    ctx.fill();

    /* diffuser */
    ctx.fillStyle = '#0f1114';
    ctx.fillRect(x - w * 0.28, y + h * 0.8, w * 0.56, h * 0.15);

    /* rear wing */
    ctx.fillStyle = color;
    ctx.fillRect(x - w * 0.42, y + h * 0.1, w * 0.84, h * 0.16);
    ctx.fillStyle = '#1b1e23';
    ctx.fillRect(x - w * 0.44, y + h * 0.24, w * 0.06, h * 0.2);
    ctx.fillRect(x + w * 0.38, y + h * 0.24, w * 0.06, h * 0.2);

    /* rain light */
    ctx.fillStyle = '#ff2a2a';
    ctx.fillRect(x - w * 0.04, y + h * 0.5, w * 0.08, h * 0.1);

    ctx.restore();
  },

  /* ----------------------------------------------------------------
     The cockpit: halo, mirrors, nose, and the steering wheel that
     turns with your input. This is what makes it first person.
     ---------------------------------------------------------------- */
  cockpit: function (ctx, width, height, state) {
    var steer = state.steer;          // -1 .. 1
    var bump = state.bump;            // vertical shake in px
    var wheelY = height * 0.925 + bump;
    var wheelW = width * 0.34;
    var wheelH = wheelW * 0.42;

    /* Halo apex sits just below the horizon so the road stays visible
       through the ring, the way it looks from the driver's seat. */
    var haloApex = height * 0.595;
    var noseApex = height * 0.80;

    ctx.save();
    ctx.translate(0, bump * 0.4);

    /* --- halo ring ----------------------------------------------- */
    ctx.strokeStyle = '#15181d';
    ctx.lineWidth = height * 0.030;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(width * 0.015, height * 0.95);
    ctx.quadraticCurveTo(width * 0.5, height * 0.24, width * 0.985, height * 0.95);
    ctx.stroke();

    /* --- halo centre pillar, running down into the chassis -------- */
    ctx.fillStyle = '#15181d';
    ctx.beginPath();
    ctx.moveTo(width * 0.5 - width * 0.011, haloApex);
    ctx.lineTo(width * 0.5 + width * 0.011, haloApex);
    ctx.lineTo(width * 0.5 + width * 0.019, noseApex + height * 0.02);
    ctx.lineTo(width * 0.5 - width * 0.019, noseApex + height * 0.02);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    /* --- mirrors ------------------------------------------------- */
    /* Height of the bodywork rim under a given x. The rim is the
       quadratic drawn below, and its x component happens to be linear —
       x(t) = (-0.05 + 1.1t)·width — so where the rim sits under a
       mirror is a closed form rather than a search. Anchoring to it is
       what keeps the mirrors attached at every aspect ratio instead of
       only at the one this was eyeballed on. */
    var rimCtrlY = noseApex - height * 0.085;
    var rimY = function (x) {
      var t = (x / width + 0.05) / 1.1;
      var u = 1 - t;
      return u * u * height * 0.97 + 2 * t * u * rimCtrlY + t * t * height * 0.97;
    };

    var mirrorW = width * 0.10;
    /* Cap against the width too: on a tall portrait screen a flat
       fraction of height makes the housing taller than it is wide. */
    var mirrorH = Math.min(height * 0.05, mirrorW * 0.45);

    /* Inboard of the bottom corners, which belong to the speed and gear
       boxes — out at the edges the housings disappear behind them. */
    for (var m = 0; m < 2; m++) {
      var mSide = m === 0 ? -1 : 1;
      var mx = width * (m === 0 ? 0.20 : 0.80);
      var foot = rimY(mx) + bump;
      var my = height * 0.665 + bump * 0.5;
      Render.mirror(ctx, mx, my, mirrorW, mirrorH, state, mSide, foot);
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
    ctx.quadraticCurveTo(width * 0.5, noseApex - height * 0.085, width * 1.05, height * 0.97);
    ctx.lineTo(width * 1.05, height * 1.02);
    ctx.closePath();
    ctx.fill();

    /* team stripe along the cockpit rim */
    ctx.strokeStyle = state.accent;
    ctx.lineWidth = Math.max(2, height * 0.005);
    ctx.beginPath();
    ctx.moveTo(-width * 0.05, height * 0.97);
    ctx.quadraticCurveTo(width * 0.5, noseApex - height * 0.085, width * 1.05, height * 0.97);
    ctx.stroke();
    ctx.restore();

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

    /* The stalk back to the bodywork. Without it the housing is a box
       floating in mid-air — which is what it was, and which reads as a
       glitch rather than a mirror at any aspect ratio. It angles inward
       towards the cockpit, so it is drawn before the housing and ends
       up tucked behind it. */
    ctx.strokeStyle = '#15181d';
    ctx.lineWidth = Math.max(2, h * 0.20);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx - side * w * 0.10, cy + h * 0.40);
    ctx.lineTo(cx - side * w * 0.55, mountY);
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

  /* speed blur creeping in from the edges at high speed */
  speedLines: function (ctx, width, height, intensity) {
    if (intensity <= 0.02) return;
    var g = ctx.createRadialGradient(
      width / 2, height / 2, height * 0.25,
      width / 2, height / 2, height * 0.85
    );
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,' + (0.55 * intensity).toFixed(3) + ')');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, width, height);
  }
};
