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
  centrifugal: 0.32,          // how hard corners push you wide
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

    this.last = performance.now();
    requestAnimationFrame(this.frame.bind(this));
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
    ['touchstart', 'touchmove'].forEach(function (evt) {
      touchZones.addEventListener(evt, function (e) {
        e.preventDefault();
        Audio.unlock();
        self.touch = { left: false, right: false, gas: false, brake: false };
        for (var i = 0; i < e.touches.length; i++) {
          var t = e.touches[i];
          var x = t.clientX / window.innerWidth;
          var y = t.clientY / window.innerHeight;
          if (x < 0.5) {
            if (x < 0.25) self.touch.left = true; else self.touch.right = true;
          } else {
            if (y > 0.5) self.touch.gas = true; else self.touch.brake = true;
          }
        }
      }, { passive: false });
    });
    touchZones.addEventListener('touchend', function () { self.touch = null; });
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
    this.countdown = 4.2;
    this.state = 'countdown';
    this.gear = 1;
    this.rpm = 0;

    this.resetCars();

    document.getElementById('menu').classList.add('hidden');
    document.getElementById('results').classList.add('hidden');
    document.getElementById('hud').classList.remove('hidden');
    document.getElementById('track-name').textContent = def.name;
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
        /* each rival has its own pace so the field spreads out */
        pace: 0.80 + (names.length - i) * 0.018,
        wobble: Math.random() * Math.PI * 2,
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
      this.countdown -= dt;
      if (this.countdown <= 0) this.state = 'racing';
      this.updateCars(dt, true);
      return;
    }
    if (this.state !== 'racing') return;

    var playerSeg = this.findSegment(this.position + this.playerZ);
    var speedPercent = this.speed / this.maxSpeed;
    var dx = dt * 2.2 * speedPercent;
    var startPosition = this.position;

    this.raceTime += dt;
    this.lapTime += dt;
    this.blink += dt * 8;

    /* --- steering ------------------------------------------------ */
    var target = 0;
    if (this.held(['ArrowLeft', 'KeyA'], 'left')) target = -1;
    if (this.held(['ArrowRight', 'KeyD'], 'right')) target = 1;
    this.steerInput += (target - this.steerInput) * Math.min(1, dt * 9);
    this.playerX += dx * this.steerInput;

    /* --- throttle and brakes ------------------------------------- */
    var accel = this.maxSpeed / 4.2;
    var braking = -this.maxSpeed / 1.6;
    var decel = -this.maxSpeed / 7;

    if (this.held(['ArrowUp', 'KeyW'], 'gas')) {
      this.speed = Util.accelerate(this.speed, accel, dt);
    } else if (this.held(['ArrowDown', 'KeyS', 'Space'], 'brake')) {
      this.speed = Util.accelerate(this.speed, braking, dt);
    } else {
      this.speed = Util.accelerate(this.speed, decel, dt);
    }

    /* --- cornering forces ---------------------------------------- */
    this.playerX -= dx * speedPercent * playerSeg.curve * this.centrifugal;

    /* too fast for the corner and you understeer off the road */
    var corneringLimit = this.grip * 1.9 / (Math.abs(playerSeg.curve) + 1.15);
    if (speedPercent > corneringLimit && Math.abs(playerSeg.curve) > 1) {
      this.speed = Util.accelerate(this.speed, -this.maxSpeed / 2.2, dt);
      this.playerX += dx * playerSeg.curve * 0.35;
    }

    /* --- leaving the circuit ------------------------------------- */
    this.offTrack = Math.abs(this.playerX) > 1;
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
    this.checkCarCollisions(playerSeg, dx);

    this.playerX = Util.limit(this.playerX, -2.4, 2.4);
    this.speed = Util.limit(this.speed, 0, this.maxSpeed);
    this.position = Util.increase(this.position, dt * this.speed, this.trackLength);

    /* --- lap counting -------------------------------------------- */
    if (this.position < startPosition) {
      this.lastLap = this.lapTime;
      if (this.bestLap === null || this.lapTime < this.bestLap) this.bestLap = this.lapTime;
      this.lapTime = 0;
      this.lap++;
      if (this.lap > this.totalLaps) this.finish();
    }

    /* --- DRS: only on a straight and only when close behind ------- */
    var ahead = this.carAhead();
    this.drs = Math.abs(playerSeg.curve) < 0.6 && ahead && ahead.gap < SEGMENT_LENGTH * 22 && speedPercent > 0.5;
    if (this.drs && this.held(['ArrowUp', 'KeyW'], 'gas')) {
      this.speed = Util.accelerate(this.speed, this.maxSpeed / 12, dt);
      this.speed = Util.limit(this.speed, 0, this.maxSpeed * 1.06);
    }

    /* --- drivetrain feel ----------------------------------------- */
    this.updateGears(speedPercent);

    /* --- camera shake -------------------------------------------- */
    var shake = speedPercent * (this.offTrack ? 9 : 2.2);
    this.bumpImpulse = (this.bumpImpulse || 0) * 0.88;
    this.bump = Math.sin(this.raceTime * 34) * shake + this.bumpImpulse;

    this.updateCars(dt, false);
    Audio.update(this.rpm, speedPercent, this.offTrack);
  },

  updateGears: function (speedPercent) {
    var gears = 8;
    var g = Util.limit(Math.ceil(speedPercent * gears), 1, gears);
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
      /* rivals brake for corners and drift towards the racing line */
      var cornerFactor = 1 - Math.min(0.55, Math.abs(seg.curve) * 0.085);
      var speed = this.maxSpeed * car.pace * cornerFactor;

      car.wobble += dt * 1.4;
      var line = -Math.sign(seg.curve) * Math.min(0.45, Math.abs(seg.curve) * 0.08);
      car.offset += ((line + Math.sin(car.wobble) * 0.12) - car.offset) * Math.min(1, dt * 1.5);
      car.offset = Util.limit(car.offset, -0.92, 0.92);

      car.z = Util.increase(car.z, dt * speed, this.trackLength);
      if (car.z < oldZ) {
        car.lap++;
        if (car.lap > this.totalLaps) {
          car.finishedAt = this.raceTime;
          this.finishOrder.push(car.name);
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
      if (this.speed > this.maxSpeed * car.pace * 0.6 &&
          Util.overlap(this.playerX, 0.5, car.offset, 0.6, 0.8)) {
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

    document.getElementById('hud').classList.add('hidden');
    var results = document.getElementById('results');
    results.classList.remove('hidden');
    document.getElementById('result-pos').textContent = Util.ordinal(pos);
    document.getElementById('result-track').textContent = this.track.name;
    document.getElementById('result-best').textContent = Util.formatTime(this.bestLap);
    document.getElementById('result-total').textContent = Util.formatTime(this.raceTime);
    document.getElementById('result-headline').textContent =
      pos === 1 ? 'RACE WIN' : pos <= 3 ? 'PODIUM' : 'CHEQUERED FLAG';
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

    /* horizon pitches with the road's gradient */
    var horizonShift = Util.limit((playerSegment.curve * 0) + (this.bump || 0), -60, 60);
    Render.background(ctx, width, height, this.theme, this.backgroundOffset || 0, horizonShift * 0.5);
    this.backgroundOffset = (this.backgroundOffset || 0) - baseSegment.curve * (this.speed / this.maxSpeed) * 4;

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
        Render.car(ctx, width, height, ROAD_WIDTH, car.color, scale, cx, cy, segment.clip);
      }

      for (var k = 0; k < segment.sprites.length; k++) {
        var sprite = segment.sprites[k];
        var sscale = segment.p1.screen.scale;
        var sx = segment.p1.screen.x + (sscale * sprite.offset * ROAD_WIDTH * width) / 2;
        var sy = segment.p1.screen.y;
        Render.sprite(ctx, width, height, ROAD_WIDTH, sprite.type, sscale, sx, sy,
          Math.sign(sprite.offset), segment.clip);
      }
    }

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

    if (this.state === 'countdown') this.renderCountdown(ctx, width, height);
    this.updateHud(speedPercent);
  },

  renderCountdown: function (ctx, width, height) {
    var lights = Util.limit(Math.ceil(5 - (this.countdown - 0.2)), 0, 5);
    var out = this.countdown <= 0.2;
    var r = height * 0.035;
    var gap = r * 2.6;
    var x0 = width / 2 - gap * 2;
    var y = height * 0.26;

    ctx.save();
    ctx.fillStyle = 'rgba(8,10,14,0.85)';
    Render.roundRect(ctx, x0 - r * 1.8, y - r * 1.8, gap * 4 + r * 3.6, r * 3.6, r * 0.5);
    ctx.fill();
    for (var i = 0; i < 5; i++) {
      ctx.fillStyle = !out && i < lights ? '#e2000f' : 'rgba(255,255,255,0.10)';
      ctx.beginPath();
      ctx.arc(x0 + i * gap, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  },

  updateHud: function (speedPercent) {
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

    var seg = this.findSegment(this.position + this.playerZ);
    document.getElementById('corner-value').textContent = seg.section || '';

    var rev = document.getElementById('rev-fill');
    rev.style.width = (this.rpm * 100).toFixed(0) + '%';
    rev.style.background = this.rpm > 0.92 ? '#3b7dff' : this.rpm > 0.75 ? '#e2000f' : '#12d16b';

    document.getElementById('drs-tag').classList.toggle('on', !!this.drs);
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
    if (!this.ready) return;
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

  stop: function () {
    if (!this.ready) return;
    this.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1);
  }
};

window.addEventListener('load', function () { Game.init(); });
