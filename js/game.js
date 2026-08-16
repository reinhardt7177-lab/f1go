/* ------------------------------------------------------------------
   game.js - physics, opponents, timing, input, and the main loop
   ------------------------------------------------------------------ */
'use strict';

var Game = {

  /* --- tuning ---------------------------------------------------- */
  fps: 60,
  step: 1 / 60,
  drawDistance: 260,
  fieldOfView: 105,
  cameraHeight: 950,          // eye level in the cockpit
  /* How hard corners push you wide. This is the number that decides
     whether the game is a game: too low and a corner cannot carry you
     off the road, so steering becomes optional and holding the
     throttle drives a clean lap by itself. */
  centrifugal: 0.62,
  offRoadLimit: 0.24,         // fraction of top speed you keep off track

  /* --- runtime state --------------------------------------------- */
  state: 'menu',              // menu | countdown | racing | finished
  track: null,
  segments: [],
  trackLength: 0,
  totalLaps: 3,

  position: 0,
  speed: 0,
  playerX: 0,
  playerZ: 0,
  maxSpeed: 0,

  lap: 1,
  lapTime: 0,
  lastLap: null,
  bestLap: null,
  raceTime: 0,
  countdown: 0,
  finished: false,
  finishOrder: [],

  cars: [],
  keys: {},
  steerInput: 0,
  drs: false,
  gear: 1,
  rpm: 0,
  bump: 0,
  blink: 0,
  offTrack: false,

  /* ---------------------------------------------------------------- */
  init: function () {
    this.canvas = document.getElementById('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.maxSpeed = SEGMENT_LENGTH / this.step;
    this.playerZ = this.cameraHeight * (1 / Math.tan(((this.fieldOfView / 2) * Math.PI) / 180));

    this.resize();
    window.addEventListener('resize', this.resize.bind(this));
    this.bindInput();
    this.bindMenu();
    this.refreshRecords();

    this.last = performance.now();
    requestAnimationFrame(this.frame.bind(this));
  },

  /* --- the championship: F1 points, kept across sessions ---------- */
  POINTS: [25, 18, 15, 12, 10, 8, 6, 4, 2, 1],
  SEASON_KEY: 'f1go-season',

  loadSeason: function () {
    try {
      return JSON.parse(localStorage.getItem(this.SEASON_KEY)) || {};
    } catch (e) { return {}; }
  },

  saveSeason: function (table) {
    try { localStorage.setItem(this.SEASON_KEY, JSON.stringify(table)); } catch (e) {}
  },

  /* final classification right now: everyone ranked by distance,
     finishers ranked by when they took the flag */
  classification: function () {
    var rows = [{ name: 'YOU', dist: this.playerDistance(), me: true }];
    for (var i = 0; i < this.cars.length; i++) {
      var car = this.cars[i];
      rows.push({
        name: car.name,
        dist: car.finishedAt !== null
          ? this.totalLaps * this.trackLength + 1e9 - car.finishedAt
          : (car.lap - 1) * this.trackLength + car.z,
        me: false
      });
    }
    rows.sort(function (a, b) { return b.dist - a.dist; });
    return rows;
  },

  renderStandings: function (pointsEarned) {
    var season = this.loadSeason();
    var rows = Object.keys(season).map(function (name) {
      return { name: name, pts: season[name] };
    });
    rows.sort(function (a, b) { return b.pts - a.pts; });
    var html = '';
    for (var i = 0; i < rows.length; i++) {
      var me = rows[i].name === 'YOU';
      html += '<div class="standing' + (me ? ' me' : '') + '">' +
        '<span>' + (i + 1) + '. ' + rows[i].name + '</span>' +
        '<span>' + rows[i].pts + '</span></div>';
    }
    document.getElementById('standings-rows').innerHTML = html;
    document.getElementById('result-points').textContent =
      pointsEarned > 0 ? '+' + pointsEarned + ' PTS' : '';
  },

  /* all-time best laps, kept per track across sessions */
  recordKey: function (trackId) { return 'f1go-best-' + trackId; },

  loadRecord: function (trackId) {
    try {
      var v = parseFloat(localStorage.getItem(this.recordKey(trackId)));
      return isFinite(v) ? v : null;
    } catch (e) { return null; }
  },

  saveRecord: function (trackId, seconds) {
    try { localStorage.setItem(this.recordKey(trackId), seconds.toFixed(3)); } catch (e) {}
  },

  refreshRecords: function () {
    var self = this;
    Array.prototype.forEach.call(document.querySelectorAll('.track-card'), function (card) {
      var el = card.querySelector('.record');
      if (!el) return;
      var best = self.loadRecord(card.getAttribute('data-track'));
      el.textContent = best === null ? 'BEST —' : 'BEST ' + Util.formatTime(best);
      el.classList.toggle('set', best !== null);
    });
  },

  resize: function () {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.width = this.canvas.clientWidth;
    this.height = this.canvas.clientHeight;
    this.canvas.width = Math.round(this.width * dpr);
    this.canvas.height = Math.round(this.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.cameraDepth = 1 / Math.tan(((this.fieldOfView / 2) * Math.PI) / 180);
  },

  /* ---------------------------------------------------------------- */
  bindMenu: function () {
    var self = this;
    var cards = document.querySelectorAll('.track-card');
    Array.prototype.forEach.call(cards, function (card) {
      card.addEventListener('click', function () {
        Array.prototype.forEach.call(cards, function (c) { c.classList.remove('selected'); });
        card.classList.add('selected');
        self.selectedTrack = card.getAttribute('data-track');
      });
    });
    this.selectedTrack = 'monaco';

    var lapButtons = document.querySelectorAll('.lap-btn');
    Array.prototype.forEach.call(lapButtons, function (btn) {
      btn.addEventListener('click', function () {
        Array.prototype.forEach.call(lapButtons, function (b) { b.classList.remove('selected'); });
        btn.classList.add('selected');
        self.totalLaps = parseInt(btn.getAttribute('data-laps'), 10);
      });
    });

    document.getElementById('start-btn').addEventListener('click', function () {
      self.start(self.selectedTrack);
    });
    document.getElementById('again-btn').addEventListener('click', function () {
      document.getElementById('results').classList.add('hidden');
      document.getElementById('menu').classList.remove('hidden');
      self.state = 'menu';
    });
    document.getElementById('reset-season').addEventListener('click', function () {
      try { localStorage.removeItem(self.SEASON_KEY); } catch (e) {}
      self.renderStandings(0);
    });
  },

  bindInput: function () {
    var self = this;
    window.addEventListener('keydown', function (e) {
      self.keys[e.code] = true;
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].indexOf(e.code) >= 0) e.preventDefault();
      if (e.code === 'KeyR' && self.state === 'racing') self.start(self.track.id);
      Audio.unlock();
    });
    window.addEventListener('keyup', function (e) { self.keys[e.code] = false; });

    /* touch: left half steers, right half is throttle / brake */
    var touchZones = document.getElementById('touch');

    /* Always rebuild from the fingers still on the glass. e.touches is
       the live set, so one function serves press, drag and release. */
    var read = function (e) {
      if (e.touches.length === 0) return null;
      var out = { left: false, right: false, gas: false, brake: false };
      for (var i = 0; i < e.touches.length; i++) {
        var t = e.touches[i];
        var x = t.clientX / window.innerWidth;
        var y = t.clientY / window.innerHeight;
        if (x < 0.5) {
          if (x < 0.25) out.left = true; else out.right = true;
        } else {
          if (y > 0.5) out.gas = true; else out.brake = true;
        }
      }
      return out;
    };

    ['touchstart', 'touchmove'].forEach(function (evt) {
      touchZones.addEventListener(evt, function (e) {
        e.preventDefault();
        Audio.unlock();
        self.touch = read(e);
      }, { passive: false });
    });

    /* Re-read rather than clearing. Dropping the whole state on any
       touchend meant lifting the steering thumb also cut the throttle,
       which on a two-thumb layout is most of the time. */
    ['touchend', 'touchcancel'].forEach(function (evt) {
      touchZones.addEventListener(evt, function (e) { self.touch = read(e); });
    });
  },

  held: function (codes, touchKey) {
    for (var i = 0; i < codes.length; i++) if (this.keys[codes[i]]) return true;
    return !!(this.touch && this.touch[touchKey]);
  },

  /* ---------------------------------------------------------------- */
  start: function (trackId) {
    var def = TRACKS[trackId];
    var built = def.build();

    this.track = def;
    this.theme = built.theme;
    this.segments = built.segments;
    this.trackLength = built.length;
    this.grip = def.grip;

    this.position = 0;
    this.speed = 0;
    this.playerX = 0;
    this.lap = 1;
    this.lapTime = 0;
    this.raceTime = 0;
    this.lastLap = null;
    this.bestLap = null;
    this.finished = false;
    this.finishOrder = [];
    this.countdown = 5.4;       // five lights, then out
    this.state = 'countdown';
    this.gear = 1;
    this.rpm = 0;
    this.tow = false;
    this.newRecord = false;
    this.bestFlash = 0;
    this.tunnelT = 0;
    this.tyreWear = 0;
    this.pitting = false;
    this.pitPhase = null;
    this.pitTimer = 0;
    this.weightT = 0;
    this.buildMap();
    Audio.unlock();             // the start click is our user gesture

    this.resetCars();

    document.getElementById('menu').classList.add('hidden');
    document.getElementById('results').classList.add('hidden');
    document.getElementById('hud').classList.remove('hidden');
    document.getElementById('track-name').textContent = def.name;
  },

  /* ----------------------------------------------------------------
     Minimap: integrate the ribbon's curvature into a 2D outline. The
     ribbon never closes geometrically, so the endpoint error is
     smeared along the lap and the shape normalised into the panel.
     ---------------------------------------------------------------- */
  buildMap: function () {
    var pts = [], hx = 0, hy = 0, heading = 0;
    var i, n = this.segments.length;
    for (i = 0; i < n; i++) {
      heading += this.segments[i].curve * 0.008;
      hx += Math.sin(heading);
      hy -= Math.cos(heading);
      pts.push([hx, hy]);
    }
    var ex = pts[n - 1][0], ey = pts[n - 1][1];
    for (i = 0; i < n; i++) {
      var f = (i + 1) / n;
      pts[i][0] -= ex * f;
      pts[i][1] -= ey * f;
    }
    var minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
    for (i = 0; i < n; i++) {
      minX = Math.min(minX, pts[i][0]); maxX = Math.max(maxX, pts[i][0]);
      minY = Math.min(minY, pts[i][1]); maxY = Math.max(maxY, pts[i][1]);
    }
    var size = 132, pad = 14;
    var sc = (size - pad * 2) / Math.max(maxX - minX, maxY - minY, 1e-6);
    var ox = (size - (maxX - minX) * sc) / 2 - minX * sc;
    var oy = (size - (maxY - minY) * sc) / 2 - minY * sc;
    this.mapPts = [];
    for (i = 0; i < n; i++) {
      this.mapPts.push([pts[i][0] * sc + ox, pts[i][1] * sc + oy]);
    }
    this.mapPath = new Path2D();
    this.mapPath.moveTo(this.mapPts[0][0], this.mapPts[0][1]);
    for (i = 1; i < n; i++) this.mapPath.lineTo(this.mapPts[i][0], this.mapPts[i][1]);
    this.mapPath.closePath();
  },

  mapPoint: function (z) {
    return this.mapPts[Math.floor(z / SEGMENT_LENGTH) % this.mapPts.length];
  },

  drawMap: function () {
    var mc = document.getElementById('minimap');
    if (!mc || !this.mapPts) return;
    var g = mc.getContext('2d');
    g.clearRect(0, 0, 132, 132);
    g.lineWidth = 3;
    g.lineJoin = 'round';
    g.strokeStyle = 'rgba(255,255,255,0.28)';
    g.stroke(this.mapPath);

    /* start/finish notch */
    var s0 = this.mapPts[0];
    g.fillStyle = '#f4f4f4';
    g.fillRect(s0[0] - 2.5, s0[1] - 2.5, 5, 5);

    for (var i = 0; i < this.cars.length; i++) {
      var car = this.cars[i];
      if (car.finishedAt !== null) continue;
      var cp = this.mapPoint(car.z);
      g.fillStyle = car.color;
      g.beginPath();
      g.arc(cp[0], cp[1], 2.6, 0, Math.PI * 2);
      g.fill();
    }

    var pp = this.mapPoint(this.position + this.playerZ);
    g.fillStyle = '#e2000f';
    g.strokeStyle = '#ffffff';
    g.lineWidth = 1.6;
    g.beginPath();
    g.arc(pp[0], pp[1], 4, 0, Math.PI * 2);
    g.fill();
    g.stroke();
  },

  /* ---------------------------------------------------------------- */
  resetCars: function () {
    var names = ['VERGARA', 'ANDERSSON', 'KIM', 'ROSSI', 'DUBOIS', 'NAKAMURA', 'SILVA', 'MULLER', 'OKONKWO'];
    var colors = ['#0b8f5a', '#e2000f', '#f97316', '#1e5fd8', '#8b5cf6', '#e4b400', '#00b8d4', '#d81b60', '#7c9a2e'];
    this.cars = [];
    for (var i = 0; i < names.length; i++) {
      /* You line up last, so the grid is staggered on the road ahead:
         the slowest rival is closest, the leader furthest away. */
      var slot = names.length - i;
      this.cars.push({
        name: names[i],
        color: colors[i],
        offset: slot % 2 === 0 ? -0.4 : 0.4,
        z: this.playerZ + slot * SEGMENT_LENGTH * 3.2,
        lap: 1,
        /* each rival has its own pace, plus a little per-race scatter
           so no two grands prix play out the same */
        pace: 0.80 + (names.length - i) * 0.018 + (Math.random() - 0.5) * 0.02,
        wobble: Math.random() * Math.PI * 2,
        /* soft red, medium yellow or hard white sidewalls */
        tyre: Util.randomChoice(['#e10600', '#ffd12e', '#f0f0f0']),
        wear: 0,
        pitTimer: 0,
        finishedAt: null
      });
    }
  },

  /* ---------------------------------------------------------------- */
  findSegment: function (z) {
    return this.segments[Math.floor(z / SEGMENT_LENGTH) % this.segments.length];
  },

  update: function (dt) {
    if (this.state === 'countdown') {
      var prevLight = Math.ceil(this.countdown);
      this.countdown -= dt;
      /* one beep per light, a long one when they go out */
      if (Math.ceil(this.countdown) !== prevLight && this.countdown > 0.2) {
        Audio.beep(440, 0.12, 0.08);
      }
      if (this.countdown <= 0) {
        this.state = 'racing';
        Audio.beep(880, 0.5, 0.1);
      }
      this.updateCars(dt, true);
      return;
    }
    if (this.state !== 'racing') return;

    var playerSeg = this.findSegment(this.position + this.playerZ);
    var speedPercent = this.speed / this.maxSpeed;
    /* lateral authority: at top speed the car needs well over half a
       second to cross half the road, so it tracks straight instead of
       darting between the kerbs */
    var dx = dt * 1.6 * speedPercent;
    var startPosition = this.position;

    this.raceTime += dt;
    this.lapTime += dt;
    this.blink += dt * 8;

    /* --- steering ------------------------------------------------ */
    /* Summed, not assigned. Written as two independent `if`s the
       second one simply overwrote the first, so holding both
       directions steered hard right instead of running straight —
       which also made rolling from one lock to the other jump through
       the middle rather than pass through it. */
    var target = 0;
    if (this.held(['ArrowLeft', 'KeyA'], 'left')) target -= 1;
    if (this.held(['ArrowRight', 'KeyD'], 'right')) target += 1;
    /* Progressive turn-in (~0.4s to full lock) and a quicker return
       to centre: a tap nudges the car, holding leans it into lock,
       and letting go straightens it out - weight, not twitch. */
    var steerRate = target === 0 ? 8 : 5.5;
    this.steerInput += (target - this.steerInput) * Math.min(1, dt * steerRate);
    if (!this.pitting) this.playerX += dx * this.steerInput;

    /* --- throttle and brakes ------------------------------------- */
    var accel = this.maxSpeed / 4.2;
    var braking = -this.maxSpeed / 1.6;
    var decel = -this.maxSpeed / 7;
    var gasHeld = this.held(['ArrowUp', 'KeyW'], 'gas');
    var brakeHeld = this.held(['ArrowDown', 'KeyS', 'Space'], 'brake');

    if (gasHeld) {
      this.speed = Util.accelerate(this.speed, accel, dt);
    } else if (brakeHeld) {
      this.speed = Util.accelerate(this.speed, braking, dt);
    } else {
      this.speed = Util.accelerate(this.speed, decel, dt);
    }

    /* --- four contact patches, arcade style ----------------------- */
    /* Weight transfer between the axles: braking loads the front and
       sharpens turn-in, power unloads it and pushes the nose wide. */
    this.weightT += (((brakeHeld ? 1 : 0) - (gasHeld ? 0.6 : 0)) - this.weightT) * Math.min(1, dt * 4);

    /* --- tyre wear ------------------------------------------------ */
    if (!this.pitting) {
      this.tyreWear = Util.limit(
        this.tyreWear + dt * speedPercent * (1 + Math.abs(playerSeg.curve) * 0.12) / 210, 0, 1);
    }

    /* --- pit lane: pull right onto the apron at start/finish ------ */
    if (!this.pitting && playerSeg.pit && this.playerX > 1.02) {
      this.pitting = true;
      this.pitPhase = 'in';
      this.pitTimer = 0;
    }
    if (this.pitting) {
      /* guided down the lane; the wheel is out of your hands */
      this.steerInput += (0 - this.steerInput) * Math.min(1, dt * 8);
      var limiter = this.maxSpeed * 0.22;
      if (this.pitPhase === 'in') {
        this.playerX += (1.42 - this.playerX) * Math.min(1, dt * 3);
        this.speed = Math.min(this.speed, limiter);
        this.pitTimer += dt;
        if (this.pitTimer > 1.0) { this.pitPhase = 'stop'; this.pitTimer = 2.6; }
      } else if (this.pitPhase === 'stop') {
        this.speed = 0;
        this.pitTimer -= dt;
        if (this.pitTimer <= 0) {
          this.tyreWear = 0;
          this.pitPhase = 'out';
          Audio.beep(660, 0.18, 0.09);
        }
      } else {
        this.speed = Math.min(this.speed, limiter);
        if (!playerSeg.pit) {
          this.playerX += (0.85 - this.playerX) * Math.min(1, dt * 2.5);
          if (this.playerX < 1.0) { this.pitting = false; this.pitPhase = null; }
        } else {
          this.playerX += (1.42 - this.playerX) * Math.min(1, dt * 3);
        }
      }
    }

    /* --- cornering forces ---------------------------------------- */
    if (!this.pitting) {
      this.playerX -= dx * speedPercent * playerSeg.curve * this.centrifugal * (1 - this.weightT * 0.12);

      /* Too fast for the corner and you understeer off the road.
       *
       * This used to take most of its penalty out of the car's speed,
       * which meant the game braked for the player: carrying too much
       * speed simply slowed you to whatever the corner allowed, and
       * since the sideways push scales with speed, slowing down also
       * killed the very force that should have carried you wide. The
       * loop settled at a safe speed on its own and the corner drove
       * itself.
       *
       * Now the cost is the corner, not the speed. Overdo it and the
       * car washes out toward the outside of the bend; recovering
       * means lifting and steering, which is what the player is there
       * to do. The speed penalty is kept small — that is tyre scrub,
       * not a brake. */
      var effGrip = this.grip * (1 - this.tyreWear * 0.35) * (1 + this.weightT * 0.10);
      var corneringLimit = effGrip * 1.9 / (Math.abs(playerSeg.curve) + 1.15);
      if (speedPercent > corneringLimit && Math.abs(playerSeg.curve) > 1) {
        var over = Math.min(1.6, (speedPercent - corneringLimit) / corneringLimit);
        this.speed = Util.accelerate(this.speed, -this.maxSpeed / 9, dt);
        this.playerX += dx * playerSeg.curve * 0.55 * (0.4 + over);
      }
    }

    /* --- leaving the circuit ------------------------------------- */
    this.offTrack = !this.pitting && Math.abs(this.playerX) > 1;
    if (this.offTrack) {
      if (this.speed > this.maxSpeed * this.offRoadLimit) {
        this.speed = Util.accelerate(this.speed, -this.maxSpeed / 1.8, dt);
      }
      if (this.theme.walls && Math.abs(this.playerX) > 1.12) {
        /* street circuit: the barrier is right there */
        this.speed = Math.min(this.speed, this.maxSpeed * 0.16);
        this.playerX = Util.limit(this.playerX, -1.12, 1.12);
        this.bumpImpulse = 26;
      }
    }

    /* --- contact with rivals ------------------------------------- */
    if (!this.pitting) this.checkCarCollisions(playerSeg, dx);

    this.playerX = Util.limit(this.playerX, -2.4, 2.4);
    this.speed = Util.limit(this.speed, 0, this.maxSpeed);
    this.position = Util.increase(this.position, dt * this.speed, this.trackLength);

    /* --- lap counting -------------------------------------------- */
    if (this.position < startPosition) {
      this.lastLap = this.lapTime;
      if (this.bestLap === null || this.lapTime < this.bestLap) this.bestLap = this.lapTime;
      /* all-time record for the circuit, kept across sessions */
      var record = this.loadRecord(this.track.id);
      if (record === null || this.lastLap < record) {
        this.saveRecord(this.track.id, this.lastLap);
        this.newRecord = true;
        this.bestFlash = 3;
      }
      this.lapTime = 0;
      this.lap++;
      if (this.lap > this.totalLaps) this.finish();
    }
    this.bestFlash = Math.max(0, this.bestFlash - dt);

    /* --- slipstream: sit in the hole in the air ------------------- */
    var ahead = this.carAhead();
    this.tow = !!(!this.pitting && ahead && ahead.gap < SEGMENT_LENGTH * 30 &&
                  Math.abs(playerSeg.curve) < 1 && speedPercent > 0.55);
    if (this.tow && this.held(['ArrowUp', 'KeyW'], 'gas')) {
      this.speed = Util.accelerate(this.speed, this.maxSpeed / 18, dt);
      this.speed = Util.limit(this.speed, 0, this.maxSpeed * 1.03);
    }

    /* --- DRS: open on any straight once you are up to speed ------- */
    this.drs = !this.pitting && Math.abs(playerSeg.curve) < 0.6 && speedPercent > 0.5;
    if (this.drs && this.held(['ArrowUp', 'KeyW'], 'gas')) {
      this.speed = Util.accelerate(this.speed, this.maxSpeed / 12, dt);
      this.speed = Util.limit(this.speed, 0, this.maxSpeed * 1.06);
    }

    /* --- drivetrain feel ----------------------------------------- */
    this.updateGears(speedPercent);

    /* --- camera shake: kerbs and contact only --------------------- */
    /* No constant bob on clean tarmac. A modern F1 car rides flat,
       and the permanent up-down wobble read as noise, not speed.
       Riding a kerb buzzes the two wheels that are actually on it. */
    var onKerb = !this.offTrack && !this.pitting && Math.abs(this.playerX) > 0.92;
    var shake = this.offTrack ? speedPercent * 8 : onKerb ? speedPercent * 3.5 : 0;
    this.bumpImpulse = (this.bumpImpulse || 0) * 0.88;
    this.bump = Math.sin(this.raceTime * 34) * shake + this.bumpImpulse;

    this.updateCars(dt, false);
    Audio.update(this.rpm, speedPercent, this.offTrack);
  },

  updateGears: function (speedPercent) {
    var gears = 8;
    var g = Util.limit(Math.ceil(speedPercent * gears), 1, gears);
    if (g !== this.gear && this.state === 'racing' && speedPercent > 0.1) {
      Audio.shift();
    }
    this.gear = g;
    var low = (g - 1) / gears;
    var high = g / gears;
    this.rpm = Util.limit(0.35 + ((speedPercent - low) / (high - low)) * 0.65, 0, 1);
    if (speedPercent < 0.02) this.rpm = 0.12;
  },

  /* ---------------------------------------------------------------- */
  updateCars: function (dt, gridOnly) {
    for (var i = 0; i < this.cars.length; i++) {
      var car = this.cars[i];
      if (car.finishedAt !== null) continue;

      var oldZ = car.z;
      if (gridOnly) continue;

      var seg = this.findSegment(car.z);
      /* rivals brake for corners and drift towards the racing line;
         their pace ebbs and flows so battles breathe, and their tyres
         wear out and get changed just like yours */
      var cornerFactor = 1 - Math.min(0.55, Math.abs(seg.curve) * 0.085);
      var ebb = 1 + Math.sin(car.wobble * 0.4) * 0.02;
      var speed = this.maxSpeed * car.pace * cornerFactor * ebb * (1 - car.wear * 0.07);

      car.wear = Util.limit(car.wear + dt * car.pace / 230, 0, 1);
      if (car.pitTimer > 0) {
        car.pitTimer -= dt;
        speed = this.maxSpeed * 0.14;
        car.offset += (0.8 - car.offset) * Math.min(1, dt * 2);
      }

      car.wobble += dt * 1.4;
      var line = -Math.sign(seg.curve) * Math.min(0.45, Math.abs(seg.curve) * 0.08);
      if (car.pitTimer <= 0) {
        car.offset += ((line + Math.sin(car.wobble) * 0.12) - car.offset) * Math.min(1, dt * 1.5);
      }
      car.offset = Util.limit(car.offset, -0.92, 0.92);

      car.z = Util.increase(car.z, dt * speed, this.trackLength);
      if (car.z < oldZ) {
        car.lap++;
        if (car.lap > this.totalLaps) {
          car.finishedAt = this.raceTime;
          this.finishOrder.push(car.name);
        } else if (car.wear > 0.68) {
          /* worn: dive into the pit at the lap change */
          car.pitTimer = 5.5;
          car.wear = 0;
        }
      }
    }

    /* re-bucket cars into segments for rendering */
    for (var s = 0; s < this.segments.length; s++) this.segments[s].cars.length = 0;
    for (var c = 0; c < this.cars.length; c++) {
      if (this.cars[c].finishedAt !== null) continue;
      this.findSegment(this.cars[c].z).cars.push(this.cars[c]);
    }
  },

  checkCarCollisions: function (playerSeg, dx) {
    for (var i = 0; i < playerSeg.cars.length; i++) {
      var car = playerSeg.cars[i];
      /* widths in road units, matching the slimmer car-to-road ratio */
      if (this.speed > this.maxSpeed * car.pace * 0.6 &&
          Util.overlap(this.playerX, 0.4, car.offset, 0.45, 0.8)) {
        this.speed = this.maxSpeed * car.pace * 0.55;
        this.position = Util.increase(car.z, -this.playerZ, this.trackLength);
        this.playerX += this.playerX > car.offset ? 0.14 : -0.14;
        this.bumpImpulse = 20;
        Audio.hit();
        break;
      }
    }
  },

  /* how far ahead the next car is, in world units */
  carAhead: function () {
    var best = null;
    var myZ = this.position + this.playerZ;
    for (var i = 0; i < this.cars.length; i++) {
      var gap = Util.increase(this.cars[i].z - myZ, 0, this.trackLength);
      if (gap > 0 && (best === null || gap < best.gap)) best = { car: this.cars[i], gap: gap };
    }
    return best;
  },

  carBehind: function () {
    var best = null;
    var myZ = this.position + this.playerZ;
    for (var i = 0; i < this.cars.length; i++) {
      var gap = Util.increase(myZ - this.cars[i].z, 0, this.trackLength);
      if (gap > 0 && (best === null || gap < best.gap)) best = { car: this.cars[i], gap: gap };
    }
    return best;
  },

  /* total race distance, used for the position tower */
  playerDistance: function () {
    return (this.lap - 1) * this.trackLength + this.position;
  },

  racePosition: function () {
    var mine = this.playerDistance();
    var ahead = 1;
    for (var i = 0; i < this.cars.length; i++) {
      var car = this.cars[i];
      var d = car.finishedAt !== null
        ? this.totalLaps * this.trackLength + 1e9 - car.finishedAt
        : (car.lap - 1) * this.trackLength + car.z;
      if (d > mine) ahead++;
    }
    return ahead;
  },

  finish: function () {
    this.state = 'finished';
    this.finished = true;
    var pos = this.racePosition();

    /* score the race into the championship */
    var order = this.classification();
    var season = this.loadSeason();
    var earned = 0;
    for (var i = 0; i < order.length; i++) {
      var pts = this.POINTS[i] || 0;
      season[order[i].name] = (season[order[i].name] || 0) + pts;
      if (order[i].me) earned = pts;
    }
    this.saveSeason(season);

    document.getElementById('hud').classList.add('hidden');
    var results = document.getElementById('results');
    results.classList.remove('hidden');
    document.getElementById('result-pos').textContent = Util.ordinal(pos);
    document.getElementById('result-track').textContent = this.track.name;
    document.getElementById('result-best').textContent = Util.formatTime(this.bestLap);
    document.getElementById('result-total').textContent = Util.formatTime(this.raceTime);
    document.getElementById('result-headline').textContent =
      (pos === 1 ? 'RACE WIN' : pos <= 3 ? 'PODIUM' : 'CHEQUERED FLAG') +
      (this.newRecord ? ' · NEW LAP RECORD' : '');
    this.renderStandings(earned);
    this.refreshRecords();
    Audio.stop();
  },

  /* ---------------------------------------------------------------- */
  render: function () {
    var ctx = this.ctx;
    var width = this.width;
    var height = this.height;

    if (this.state === 'menu' || !this.segments.length) {
      ctx.fillStyle = '#0a0d12';
      ctx.fillRect(0, 0, width, height);
      return;
    }

    var baseSegment = this.findSegment(this.position);
    var basePercent = Util.percentRemaining(this.position, SEGMENT_LENGTH);
    var playerSegment = this.findSegment(this.position + this.playerZ);
    var playerPercent = Util.percentRemaining(this.position + this.playerZ, SEGMENT_LENGTH);
    var playerY = Util.interpolate(playerSegment.p1.world.y, playerSegment.p2.world.y, playerPercent);

    var maxy = height;
    var x = 0;
    var dx = -(baseSegment.curve * basePercent);
    var i, segment;

    Render.background(ctx, width, height, this.theme);

    /* --- the road, painted front to back ------------------------- */
    for (i = 0; i < this.drawDistance; i++) {
      segment = this.segments[(baseSegment.index + i) % this.segments.length];
      segment.looped = segment.index < baseSegment.index;
      segment.fog = Util.exponentialFog(i / this.drawDistance, this.theme.fogDensity);
      segment.clip = maxy;

      Util.project(segment.p1, this.playerX * ROAD_WIDTH - x, playerY + this.cameraHeight + this.bump * 6,
        this.position - (segment.looped ? this.trackLength : 0),
        this.cameraDepth, width, height, ROAD_WIDTH);
      Util.project(segment.p2, this.playerX * ROAD_WIDTH - x - dx, playerY + this.cameraHeight + this.bump * 6,
        this.position - (segment.looped ? this.trackLength : 0),
        this.cameraDepth, width, height, ROAD_WIDTH);

      x += dx;
      dx += segment.curve;

      if (segment.p1.camera.z <= this.cameraDepth || segment.p2.screen.y >= segment.p1.screen.y ||
          segment.p2.screen.y >= maxy) continue;

      Render.segment(ctx, width, LANES,
        segment.p1.screen.x, segment.p1.screen.y, segment.p1.screen.w,
        segment.p2.screen.x, segment.p2.screen.y, segment.p2.screen.w,
        segment.fog, segment, this.theme);

      maxy = segment.p2.screen.y;
    }

    /* --- scenery and cars, painted back to front ----------------- */
    for (i = this.drawDistance - 1; i > 0; i--) {
      segment = this.segments[(baseSegment.index + i) % this.segments.length];

      for (var j = 0; j < segment.cars.length; j++) {
        var car = segment.cars[j];
        var carPercent = Util.percentRemaining(car.z, SEGMENT_LENGTH);
        var scale = Util.interpolate(segment.p1.screen.scale, segment.p2.screen.scale, carPercent);
        var cx = Util.interpolate(segment.p1.screen.x, segment.p2.screen.x, carPercent) +
                 (scale * car.offset * ROAD_WIDTH * width) / 2;
        var cy = Util.interpolate(segment.p1.screen.y, segment.p2.screen.y, carPercent);
        var persp = Util.limit((cx - width / 2) / (width / 2), -1, 1);
        Render.car(ctx, width, height, ROAD_WIDTH, car.color, scale, cx, cy, segment.clip,
          segment.fog, car.tyre, persp);
      }

      for (var k = 0; k < segment.sprites.length; k++) {
        var sprite = segment.sprites[k];
        var sscale = segment.p1.screen.scale;
        var sx = segment.p1.screen.x + (sscale * sprite.offset * ROAD_WIDTH * width) / 2;
        var sy = segment.p1.screen.y;
        Render.sprite(ctx, width, height, ROAD_WIDTH, sprite.type, sscale, sx, sy,
          Math.sign(sprite.offset), segment.clip, segment.fog);
      }
    }

    /* --- tunnel ambience, fading over a few frames ---------------- */
    var tunnelTarget = playerSegment.section === 'TUNNEL' ? 1 : 0;
    this.tunnelT = (this.tunnelT || 0) + (tunnelTarget - (this.tunnelT || 0)) * 0.06;
    Render.tunnel(ctx, width, height, this.tunnelT);

    /* --- cockpit and effects ------------------------------------- */
    var speedPercent = this.speed / this.maxSpeed;
    Render.speedLines(ctx, width, height, Math.max(0, speedPercent - 0.55) * 1.6);

    var behind = this.carBehind();
    Render.cockpit(ctx, width, height, {
      steer: this.steerInput,
      bump: this.bump,
      rpm: this.rpm,
      gear: this.gear,
      drs: this.drs,
      blink: this.blink,
      accent: '#e2000f',
      behind: behind && behind.gap < SEGMENT_LENGTH * 14
        ? { distance: behind.gap / (SEGMENT_LENGTH * 14), offset: behind.car.offset, color: behind.car.color }
        : null
    });

    Render.vignette(ctx, width, height);
    this.updateHud(speedPercent);
  },

  /* The gantry lights, in the DOM so both renderers get them. Painted
     into the 2D canvas, as they were, they disappeared the moment the
     3D renderer took over the picture. */
  updateLights: function () {
    var box = document.getElementById('lights');
    if (!box) return;

    var racing = this.state === 'countdown';
    box.classList.toggle('hidden', !racing);
    if (!racing) return;

    /* Five reds come on a second apart, then all out — and it is
       lights out that starts the race, not the last one coming on. */
    var lit = Util.limit(Math.ceil(5 - (this.countdown - 0.2)), 0, 5);
    var out = this.countdown <= 0.2;
    var dots = box.children;
    for (var i = 0; i < dots.length; i++) {
      dots[i].classList.toggle('on', !out && i < lit);
    }
  },

  updateHud: function (speedPercent) {
    this.updateLights();
    var kmh = Math.round(speedPercent * 340);
    document.getElementById('speed-value').textContent = kmh;
    document.getElementById('gear-value').textContent = this.gear;
    document.getElementById('lap-value').textContent =
      Math.min(this.lap, this.totalLaps) + ' / ' + this.totalLaps;
    document.getElementById('pos-value').textContent =
      this.racePosition() + ' / ' + (this.cars.length + 1);
    document.getElementById('time-value').textContent = Util.formatTime(this.lapTime);
    document.getElementById('best-value').textContent = Util.formatTime(this.bestLap);
    document.getElementById('last-value').textContent = Util.formatTime(this.lastLap);

    /* live gap to the car ahead, in seconds at current speed */
    var ahead = this.carAhead();
    document.getElementById('gap-value').textContent =
      ahead && this.speed > this.maxSpeed * 0.1
        ? '+' + (ahead.gap / this.speed).toFixed(2)
        : '—';

    /* the Last cell flashes purple while a fresh track record stands */
    document.getElementById('last-value').classList.toggle('record-flash', this.bestFlash > 0);

    /* tyres, and the call to box when they are done */
    var tyreEl = document.getElementById('tyre-value');
    if (tyreEl) {
      tyreEl.textContent = this.pitting && this.pitPhase === 'stop'
        ? 'BOX'
        : Math.round((1 - this.tyreWear) * 100) + '%';
      tyreEl.style.color =
        this.tyreWear > 0.7 ? '#ff5252' : this.tyreWear > 0.45 ? '#f5c518' : '';
    }
    var boxTag = document.getElementById('box-tag');
    if (boxTag) boxTag.classList.toggle('on', !this.pitting && this.tyreWear > 0.65);

    var seg = this.findSegment(this.position + this.playerZ);
    document.getElementById('corner-value').textContent =
      this.pitting ? (this.pitPhase === 'stop' ? 'PIT STOP' : 'PIT LANE') : (seg.section || '');

    this.drawMap();

    var rev = document.getElementById('rev-fill');
    rev.style.width = (this.rpm * 100).toFixed(0) + '%';
    rev.style.background = this.rpm > 0.92 ? '#3b7dff' : this.rpm > 0.75 ? '#e2000f' : '#12d16b';

    document.getElementById('drs-tag').classList.toggle('on', !!this.drs);
    document.getElementById('tow-tag').classList.toggle('on', !!this.tow && !this.drs);
    document.getElementById('offtrack-tag').classList.toggle('on', !!this.offTrack);
  },

  /* ---------------------------------------------------------------- */
  frame: function (now) {
    var dt = Math.min(1, (now - this.last) / 1000);
    this.last = now;

    /* fixed timestep so physics stays identical at any refresh rate */
    this.accumulator = (this.accumulator || 0) + dt;
    while (this.accumulator > this.step) {
      this.update(this.step);
      this.accumulator -= this.step;
    }

    this.render();
    requestAnimationFrame(this.frame.bind(this));
  }
};

/* ------------------------------------------------------------------
   Audio - a synthesised engine note, no sample files needed.
   ------------------------------------------------------------------ */
var Audio = {
  ready: false,

  unlock: function () {
    if (this.ready) return;
    var Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();

    this.gain = this.ctx.createGain();
    this.gain.gain.value = 0;
    this.gain.connect(this.ctx.destination);

    this.osc = this.ctx.createOscillator();
    this.osc.type = 'sawtooth';
    this.osc.frequency.value = 80;

    this.osc2 = this.ctx.createOscillator();
    this.osc2.type = 'square';
    this.osc2.frequency.value = 160;
    this.sub = this.ctx.createGain();
    this.sub.gain.value = 0.25;

    this.filter = this.ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 900;

    this.osc.connect(this.filter);
    this.osc2.connect(this.sub);
    this.sub.connect(this.filter);
    this.filter.connect(this.gain);
    this.osc.start();
    this.osc2.start();
    this.ready = true;
  },

  update: function (rpm, speedPercent, offTrack) {
    if (!this.ready) return;
    var f = 70 + rpm * 210;
    this.osc.frequency.setTargetAtTime(f, this.ctx.currentTime, 0.03);
    this.osc2.frequency.setTargetAtTime(f * 2, this.ctx.currentTime, 0.03);
    this.filter.frequency.setTargetAtTime(500 + speedPercent * 2600, this.ctx.currentTime, 0.05);
    this.gain.gain.setTargetAtTime(0.035 + speedPercent * 0.05 + (offTrack ? 0.02 : 0), this.ctx.currentTime, 0.05);
  },

  hit: function () {
    if (!this.ready || this.ctx.state !== 'running') return;
    var o = this.ctx.createOscillator();
    var g = this.ctx.createGain();
    o.type = 'square';
    o.frequency.value = 120;
    g.gain.value = 0.12;
    g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.06);
    o.connect(g);
    g.connect(this.ctx.destination);
    o.start();
    o.stop(this.ctx.currentTime + 0.25);
  },

  /* start-light beeps and other one-shot tones. The state guard
     matters: on a suspended context currentTime never advances, so
     scheduled stops never fire and the nodes pile up forever. */
  beep: function (freq, dur, gain) {
    if (!this.ready || this.ctx.state !== 'running') return;
    var o = this.ctx.createOscillator();
    var g = this.ctx.createGain();
    o.type = 'sine';
    o.frequency.value = freq;
    g.gain.value = gain || 0.08;
    g.gain.setTargetAtTime(0, this.ctx.currentTime + dur * 0.7, 0.05);
    o.connect(g);
    g.connect(this.ctx.destination);
    o.start();
    o.stop(this.ctx.currentTime + dur + 0.3);
  },

  /* the clack of an upshift or downshift */
  shift: function () {
    this.beep(150, 0.04, 0.05);
  },

  stop: function () {
    if (!this.ready) return;
    this.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1);
  }
};

window.addEventListener('load', function () { Game.init(); });
