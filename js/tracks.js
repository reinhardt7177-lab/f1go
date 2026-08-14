/* ------------------------------------------------------------------
   tracks.js - circuit geometry

   A circuit is a flat list of segments. Each segment carries a curve
   (how much the road bends to the right, negative = left) and a world
   height, so the whole layout is a 1D ribbon: exactly what the
   pseudo-3D renderer needs.

   Corner sequences and their names follow the real circuits; the radii
   and elevations are hand-tuned approximations, not survey data.
   ------------------------------------------------------------------ */
'use strict';

var SEGMENT_LENGTH = 200;   // world units per segment
var RUMBLE_LENGTH = 3;      // segments per rumble-strip stripe
var ROAD_WIDTH = 2000;      // half-width of the road in world units
var LANES = 3;

var LEN = { NONE: 0, TINY: 12, SHORT: 25, MEDIUM: 50, LONG: 100, HUGE: 160 };
var CRV = { NONE: 0, EASY: 2, MEDIUM: 4, HARD: 6, TIGHT: 8, HAIRPIN: 11 };
var HIL = { NONE: 0, LOW: 20, MEDIUM: 40, HIGH: 60, ALP: 90 };

/* ------------------------------------------------------------------ */

function TrackBuilder(theme) {
  this.segments = [];
  this.theme = theme;
  this.section = '';
}

TrackBuilder.prototype.lastY = function () {
  return this.segments.length === 0 ? 0 : this.segments[this.segments.length - 1].p2.world.y;
};

TrackBuilder.prototype.addSegment = function (curve, y) {
  var n = this.segments.length;
  this.segments.push({
    index: n,
    section: this.section,
    p1: { world: { y: this.lastY(), z: n * SEGMENT_LENGTH }, camera: {}, screen: {} },
    p2: { world: { y: y, z: (n + 1) * SEGMENT_LENGTH }, camera: {}, screen: {} },
    curve: curve,
    sprites: [],
    cars: [],
    looped: false,
    fog: 0,
    clip: 0,
    /* stripes alternate every RUMBLE_LENGTH segments */
    dark: Math.floor(n / RUMBLE_LENGTH) % 2 === 0
  });
};

/* enter/leave are eased so corners open and close smoothly */
TrackBuilder.prototype.addRoad = function (enter, hold, leave, curve, y) {
  var startY = this.lastY();
  var endY = startY + (y || 0) * SEGMENT_LENGTH;
  var total = enter + hold + leave;
  var i;
  for (i = 0; i < enter; i++) {
    this.addSegment(Util.easeIn(0, curve, i / enter), Util.easeInOut(startY, endY, i / total));
  }
  for (i = 0; i < hold; i++) {
    this.addSegment(curve, Util.easeInOut(startY, endY, (enter + i) / total));
  }
  for (i = 0; i < leave; i++) {
    this.addSegment(Util.easeInOut(curve, 0, i / leave), Util.easeInOut(startY, endY, (enter + hold + i) / total));
  }
};

/* Named piece of circuit - the name is shown on the HUD as you drive it */
TrackBuilder.prototype.at = function (name, enter, hold, leave, curve, y) {
  this.section = name;
  this.addRoad(enter, hold, leave, curve || 0, y || 0);
  return this;
};

TrackBuilder.prototype.straight = function (name, len, y) {
  return this.at(name, len, len, len, 0, y || 0);
};

/* An S: two mirrored corners run together with no straight between. */
TrackBuilder.prototype.esses = function (name, len, curve, y) {
  this.at(name, len, len, len, curve, y || 0);
  this.at(name, len, len, len, -curve, 0);
  return this;
};

/* ------------------------------------------------------------------
   Scenery. Everything is drawn procedurally - the repository ships no
   image assets at all.
   ------------------------------------------------------------------ */
TrackBuilder.prototype.addSprite = function (index, type, offset) {
  if (index >= 0 && index < this.segments.length) {
    this.segments[index].sprites.push({ type: type, offset: offset });
  }
};

TrackBuilder.prototype.scatter = function (types, every, minOffset, maxOffset) {
  for (var n = 0; n < this.segments.length; n += every) {
    var side = Math.random() < 0.5 ? -1 : 1;
    var offset = side * Util.interpolate(minOffset, maxOffset, Math.random());
    this.addSprite(n + Util.randomInt(0, every - 1), Util.randomChoice(types), offset);
  }
};

TrackBuilder.prototype.grandstands = function (from, to, side) {
  for (var n = from; n < to; n += 16) {
    this.addSprite(n, 'grandstand', side * 2.1);
  }
};

TrackBuilder.prototype.finish = function () {
  var segs = this.segments;
  /* start/finish gantry and the boards leading up to it */
  this.addSprite(2, 'gantry', 0);
  for (var b = 1; b <= 5; b++) {
    this.addSprite(segs.length - b * 12, 'board' + Math.min(b, 3), -1.35);
  }
  return { segments: segs, theme: this.theme, length: segs.length * SEGMENT_LENGTH };
};

/* ------------------------------------------------------------------
   Themes - colour palettes, barrier style and background type
   ------------------------------------------------------------------ */
var THEMES = {
  monaco: {
    sky: ['#1b3f6b', '#4d86bd', '#a8cbe4'],
    background: 'city',
    haze: '#a8cbe4',
    grass: ['#4a4d53', '#44474d'],      // Monaco has no run-off, just tarmac
    road: ['#3b3d42', '#37393e'],
    rumble: ['#d92b2b', '#f4f4f4'],
    lane: '#f0f0f0',
    walls: true,
    wallColor: ['#eceef1', '#cdd1d6'],
    fogDensity: 4
  },
  silverstone: {
    sky: ['#5c6d80', '#8ea2b5', '#cfd8de'],
    background: 'hills',
    haze: '#cfd8de',
    grass: ['#3f6b3a', '#3a6335'],
    road: ['#41444a', '#3d4046'],
    rumble: ['#c62828', '#f4f4f4'],
    lane: '#f0f0f0',
    walls: false,
    wallColor: ['#dddddd', '#c8c8c8'],
    fogDensity: 5
  },
  suzuka: {
    sky: ['#123a52', '#3f7fa6', '#bfe0ea'],
    background: 'hills',
    haze: '#bfe0ea',
    grass: ['#3c6b45', '#376340'],
    road: ['#3e4147', '#3a3d43'],
    rumble: ['#1a56b0', '#f4f4f4'],
    lane: '#f0f0f0',
    walls: false,
    wallColor: ['#dddddd', '#c8c8c8'],
    fogDensity: 5
  }
};

/* ------------------------------------------------------------------
   Circuit de Monaco - 19 corners, clockwise, uphill to Casino and back
   down through the tunnel. Walls everywhere, no room for mistakes.
   ------------------------------------------------------------------ */
function buildMonaco() {
  var b = new TrackBuilder(THEMES.monaco);

  b.straight('START / FINISH', LEN.MEDIUM);
  b.at('T1 SAINTE DEVOTE', LEN.TINY, LEN.SHORT, LEN.TINY, CRV.TIGHT);
  b.at('BEAU RIVAGE', LEN.MEDIUM, LEN.MEDIUM, LEN.SHORT, -CRV.EASY, HIL.HIGH);
  b.at('T3 MASSENET', LEN.SHORT, LEN.MEDIUM, LEN.SHORT, -CRV.MEDIUM, HIL.LOW);
  b.at('T4 CASINO', LEN.TINY, LEN.SHORT, LEN.SHORT, CRV.MEDIUM);
  b.at('T5 MIRABEAU', LEN.TINY, LEN.TINY, LEN.TINY, CRV.HARD, -HIL.LOW);
  b.at('T6 GRAND HOTEL HAIRPIN', LEN.TINY, LEN.SHORT, LEN.TINY, CRV.HAIRPIN, -HIL.MEDIUM);
  b.at('T8 PORTIER', LEN.TINY, LEN.TINY, LEN.TINY, CRV.HARD, -HIL.LOW);
  b.at('TUNNEL', LEN.SHORT, LEN.LONG, LEN.MEDIUM, CRV.EASY);
  b.at('T10 NOUVELLE CHICANE', LEN.TINY, LEN.TINY, LEN.TINY, CRV.TIGHT);
  b.at('T11 NOUVELLE CHICANE', LEN.TINY, LEN.TINY, LEN.TINY, -CRV.TIGHT);
  b.at('T12 TABAC', LEN.TINY, LEN.SHORT, LEN.TINY, -CRV.HARD);
  b.esses('SWIMMING POOL', LEN.TINY, CRV.HARD);
  b.esses('LOUIS CHIRON', LEN.TINY, -CRV.TIGHT);
  b.at('T17 LA RASCASSE', LEN.TINY, LEN.SHORT, LEN.TINY, CRV.HAIRPIN);
  b.at('T19 ANTHONY NOGHES', LEN.TINY, LEN.SHORT, LEN.SHORT, CRV.HARD);
  b.straight('START / FINISH', LEN.SHORT);

  b.scatter(['palm', 'building', 'building', 'yacht'], 16, 1.7, 3.4);
  b.grandstands(30, 90, -1);
  return b.finish();
}

/* ------------------------------------------------------------------
   Silverstone - fast, open, and defined by Maggotts-Becketts-Chapel
   ------------------------------------------------------------------ */
function buildSilverstone() {
  var b = new TrackBuilder(THEMES.silverstone);

  b.straight('START / FINISH', LEN.MEDIUM);
  b.at('T1 ABBEY', LEN.SHORT, LEN.SHORT, LEN.SHORT, CRV.MEDIUM);
  b.at('T2 FARM CURVE', LEN.SHORT, LEN.MEDIUM, LEN.SHORT, -CRV.EASY, HIL.LOW);
  b.at('T3 VILLAGE', LEN.TINY, LEN.SHORT, LEN.TINY, CRV.HAIRPIN);
  b.at('T4 THE LOOP', LEN.TINY, LEN.SHORT, LEN.TINY, -CRV.TIGHT);
  b.at('T5 AINTREE', LEN.SHORT, LEN.SHORT, LEN.SHORT, -CRV.EASY);
  b.straight('WELLINGTON STRAIGHT', LEN.LONG);
  b.at('T6 BROOKLANDS', LEN.SHORT, LEN.SHORT, LEN.SHORT, -CRV.HARD);
  b.at('T7 LUFFIELD', LEN.SHORT, LEN.LONG, LEN.SHORT, CRV.TIGHT);
  b.at('T9 WOODCOTE', LEN.SHORT, LEN.SHORT, LEN.SHORT, CRV.EASY);
  b.straight('NATIONAL PIT STRAIGHT', LEN.MEDIUM);
  b.at('T9 COPSE', LEN.SHORT, LEN.MEDIUM, LEN.SHORT, CRV.MEDIUM, HIL.LOW);
  b.at('T10 MAGGOTTS', LEN.TINY, LEN.SHORT, LEN.TINY, CRV.HARD);
  b.esses('BECKETTS', LEN.TINY, -CRV.HARD);
  b.at('T13 CHAPEL', LEN.SHORT, LEN.SHORT, LEN.SHORT, -CRV.MEDIUM, -HIL.LOW);
  b.straight('HANGAR STRAIGHT', LEN.LONG);
  b.at('T15 STOWE', LEN.SHORT, LEN.MEDIUM, LEN.SHORT, CRV.HARD);
  b.at('T16 VALE', LEN.TINY, LEN.TINY, LEN.TINY, -CRV.TIGHT, -HIL.LOW);
  b.at('T18 CLUB', LEN.SHORT, LEN.MEDIUM, LEN.MEDIUM, CRV.MEDIUM, HIL.LOW);
  b.straight('START / FINISH', LEN.MEDIUM);

  b.scatter(['tree', 'tree', 'tree', 'billboard'], 10, 1.4, 3.2);
  b.grandstands(20, 70, -1);
  b.grandstands(20, 70, 1);
  return b.finish();
}

/* ------------------------------------------------------------------
   Suzuka - the Esses, Degner, the hairpin, Spoon, 130R, the chicane
   ------------------------------------------------------------------ */
function buildSuzuka() {
  var b = new TrackBuilder(THEMES.suzuka);

  b.straight('START / FINISH', LEN.LONG);
  b.at('T1-2 FIRST CURVE', LEN.SHORT, LEN.MEDIUM, LEN.SHORT, CRV.MEDIUM, HIL.MEDIUM);
  b.esses('S CURVES', LEN.TINY, -CRV.HARD, HIL.LOW);
  b.esses('S CURVES', LEN.TINY, -CRV.HARD);
  b.at('T7 DUNLOP', LEN.SHORT, LEN.MEDIUM, LEN.SHORT, -CRV.MEDIUM, HIL.LOW);
  b.at('T8 DEGNER 1', LEN.TINY, LEN.TINY, LEN.TINY, CRV.HARD, -HIL.MEDIUM);
  b.at('T9 DEGNER 2', LEN.TINY, LEN.SHORT, LEN.TINY, CRV.TIGHT, -HIL.LOW);
  b.straight('CROSSOVER', LEN.SHORT);
  b.at('T11 HAIRPIN', LEN.TINY, LEN.SHORT, LEN.TINY, -CRV.HAIRPIN);
  b.at('T12-13 200R', LEN.MEDIUM, LEN.LONG, LEN.MEDIUM, CRV.EASY, HIL.LOW);
  b.at('T14 SPOON', LEN.SHORT, LEN.MEDIUM, LEN.TINY, -CRV.HARD);
  b.at('T15 SPOON', LEN.TINY, LEN.MEDIUM, LEN.SHORT, -CRV.TIGHT, -HIL.LOW);
  b.straight('BACK STRAIGHT', LEN.HUGE);
  b.at('T15 130R', LEN.SHORT, LEN.MEDIUM, LEN.SHORT, -CRV.MEDIUM);
  b.straight('CASIO TRIANGLE', LEN.SHORT);
  b.at('T16 CHICANE', LEN.TINY, LEN.TINY, LEN.TINY, CRV.TIGHT);
  b.at('T17 CHICANE', LEN.TINY, LEN.TINY, LEN.TINY, -CRV.TIGHT);
  b.at('T18 FINAL CORNER', LEN.SHORT, LEN.MEDIUM, LEN.MEDIUM, CRV.MEDIUM);
  b.straight('START / FINISH', LEN.MEDIUM);

  b.scatter(['tree', 'tree', 'ferris', 'billboard'], 11, 1.4, 3.0);
  b.grandstands(25, 80, -1);
  return b.finish();
}

var TRACKS = {
  monaco: {
    id: 'monaco',
    name: 'MONACO',
    subtitle: 'Circuit de Monaco',
    blurb: 'Street circuit. Walls on every exit, no run-off, lowest top speed of the year.',
    grip: 0.92,
    build: buildMonaco
  },
  silverstone: {
    id: 'silverstone',
    name: 'SILVERSTONE',
    subtitle: 'Silverstone Circuit',
    blurb: 'Fast and flowing. Maggotts-Becketts-Chapel is flat out if you are brave.',
    grip: 1.05,
    build: buildSilverstone
  },
  suzuka: {
    id: 'suzuka',
    name: 'SUZUKA',
    subtitle: 'Suzuka International Racing Course',
    blurb: 'Figure-of-eight. Rhythm through the Esses decides your whole lap.',
    grip: 1.0,
    build: buildSuzuka
  }
};
