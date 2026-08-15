/* ------------------------------------------------------------------
   tracks.js - circuit geometry

   A circuit is a flat list of segments. Each segment carries a curve
   (how much the road bends to the right, negative = left), so the
   whole layout is a 1D ribbon: exactly what the pseudo-3D renderer
   needs. The ribbon is kept level - no artificial hills bobbing the
   horizon - so the corner sequence alone carries the lap.

   Corner order and direction follow the real circuits turn by turn;
   radii are tuned so each corner asks for roughly the real entry
   speed: flat-out kinks stay flat, hairpins crawl.
   ------------------------------------------------------------------ */
'use strict';

var SEGMENT_LENGTH = 200;   // world units per segment
var RUMBLE_LENGTH = 3;      // segments per rumble-strip stripe
var ROAD_WIDTH = 3000;      // half-width of the road in world units
var LANES = 3;

var LEN = { NONE: 0, TINY: 12, SHORT: 25, MEDIUM: 50, LONG: 100, HUGE: 160 };
var CRV = { NONE: 0, KINK: 1, EASY: 2, MEDIUM: 4, HARD: 6, TIGHT: 8, HAIRPIN: 11 };

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
   Trackside objects. Only what belongs at a race circuit: the start
   gantry, grandstands, advertising hoardings and braking boards.
   ------------------------------------------------------------------ */
TrackBuilder.prototype.addSprite = function (index, type, offset) {
  if (index >= 0 && index < this.segments.length) {
    /* seed keeps per-instance detail (crowd colours) stable per spot */
    this.segments[index].sprites.push({ type: type, offset: offset, seed: index });
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
  /* the pit lane runs down the right of the opening straight,
     with the garage block standing behind it. Capped in length so a
     stop costs seconds, not the whole straight. */
  var first = segs[0].section;
  for (var p = 0; p < segs.length && segs[p].section === first && p < 60; p++) {
    segs[p].pit = true;
  }
  for (var g = 6; g < p - 6; g += 10) {
    this.addSprite(g, 'pitbuilding', 2.5);
  }
  /* start/finish gantry and the boards leading up to it */
  this.addSprite(2, 'gantry', 0);
  for (var b = 1; b <= 5; b++) {
    this.addSprite(segs.length - b * 12, 'board' + Math.min(b, 3), -1.35);
  }
  return { segments: segs, theme: this.theme, length: segs.length * SEGMENT_LENGTH };
};

/* ------------------------------------------------------------------
   Themes - colour palettes and barrier style. The sky is a plain
   gradient: no skyline, no props, nothing to distract from the road.
   ------------------------------------------------------------------ */
var THEMES = {
  monaco: {
    sky: ['#1b3f6b', '#4d86bd', '#a8cbe4'],
    haze: '#a8cbe4',
    grass: ['#5a5e66', '#555960'],      // Monaco has no run-off, just pavement
    road: ['#33363b', '#2f3237'],       // clearly darker than the pavement
    rumble: ['#d92b2b', '#f4f4f4'],
    lane: '#f0f0f0',
    walls: true,
    wallColor: ['#dfe3e8', '#dfe3e8'],
    fogDensity: 4
  },
  silverstone: {
    sky: ['#5c6d80', '#8ea2b5', '#cfd8de'],
    haze: '#cfd8de',
    grass: ['#41703b', '#366030'],
    road: ['#3b3e44', '#373a40'],
    rumble: ['#c62828', '#f4f4f4'],
    lane: '#f0f0f0',
    walls: false,
    wallColor: ['#dddddd', '#c8c8c8'],
    fogDensity: 5
  },
  suzuka: {
    sky: ['#123a52', '#3f7fa6', '#bfe0ea'],
    haze: '#bfe0ea',
    grass: ['#3e7048', '#33613c'],
    road: ['#393c42', '#35383e'],
    rumble: ['#1a56b0', '#f4f4f4'],
    lane: '#f0f0f0',
    walls: false,
    wallColor: ['#dddddd', '#c8c8c8'],
    fogDensity: 5
  },
  monza: {
    sky: ['#274b78', '#6f9fc9', '#dce8ef'],
    haze: '#dce8ef',
    grass: ['#4c8045', '#417238'],
    road: ['#3f4248', '#3b3e44'],
    rumble: ['#1f9d4e', '#f4f4f4'],   // a nod to the tricolore kerbs
    lane: '#f0f0f0',
    walls: false,
    wallColor: ['#dddddd', '#c8c8c8'],
    fogDensity: 5
  },
  spa: {
    sky: ['#46586c', '#7d92a5', '#c8d3da'],
    haze: '#c8d3da',
    grass: ['#37633a', '#2e5731'],
    road: ['#3a3d43', '#36393f'],
    rumble: ['#c62828', '#f4f4f4'],
    lane: '#f0f0f0',
    walls: false,
    wallColor: ['#dddddd', '#c8c8c8'],
    fogDensity: 6                      // the Ardennes murk
  },
  interlagos: {
    sky: ['#1e4a7a', '#5a93c6', '#cfe2ee'],
    haze: '#cfe2ee',
    grass: ['#44793d', '#3a6c33'],
    road: ['#3c3f45', '#383b41'],
    rumble: ['#f2b52a', '#1a9c4b'],    // verde e amarelo
    lane: '#f0f0f0',
    walls: false,
    wallColor: ['#dddddd', '#c8c8c8'],
    fogDensity: 5
  },
  bahrain: {
    sky: ['#3d5a86', '#93a7bd', '#e8ddc4'],
    haze: '#e8ddc4',
    grass: ['#b3986a', '#a98e60'],     // desert either side
    road: ['#3a3d43', '#36393f'],
    rumble: ['#c62828', '#f4f4f4'],
    lane: '#f0f0f0',
    walls: false,
    wallColor: ['#dddddd', '#c8c8c8'],
    fogDensity: 4
  },
  singapore: {
    sky: ['#070b18', '#141c3a', '#31386a'],
    haze: '#565080',
    grass: ['#3d4149', '#383c44'],     // street circuit at night
    road: ['#2c2f34', '#282b30'],
    rumble: ['#d92b2b', '#f4f4f4'],
    lane: '#f0f0f0',
    walls: true,
    wallColor: ['#c9ced6', '#c9ced6'],
    fogDensity: 4
  },
  cota: {
    sky: ['#2c5382', '#7ba3c9', '#e2e3d5'],
    haze: '#e2e3d5',
    grass: ['#5c7c42', '#527038'],     // sun-dried Texas green
    road: ['#3d4046', '#393c42'],
    rumble: ['#c62828', '#f4f4f4'],
    lane: '#f0f0f0',
    walls: false,
    wallColor: ['#dddddd', '#c8c8c8'],
    fogDensity: 5
  },
  redbullring: {
    sky: ['#2b5a8c', '#77a6cf', '#dfeaf0'],
    haze: '#dfeaf0',
    grass: ['#3f7c46', '#356f3b'],     // alpine meadow
    road: ['#3e4147', '#3a3d43'],
    rumble: ['#1a56b0', '#f4f4f4'],
    lane: '#f0f0f0',
    walls: false,
    wallColor: ['#dddddd', '#c8c8c8'],
    fogDensity: 5
  }
};

/* ------------------------------------------------------------------
   Circuit de Monaco - 19 corners, clockwise. Turn by turn:
   Sainte Devote (R), Beau Rivage kink (L), Massenet (L), Casino (R),
   Mirabeau (R), the Grand Hotel hairpin (L - the real one turns
   left), Mirabeau Bas (R), Portier (R), the tunnel's long right,
   Nouvelle Chicane (L-R), Tabac (L), Swimming Pool (L-R), Piscine
   exit (R-L), Rascasse (R), Anthony Noghes (R).
   ------------------------------------------------------------------ */
function buildMonaco() {
  var b = new TrackBuilder(THEMES.monaco);

  b.straight('START / FINISH', LEN.MEDIUM);
  b.at('T1 SAINTE DEVOTE', LEN.TINY, LEN.SHORT, LEN.TINY, CRV.TIGHT);
  b.at('BEAU RIVAGE', LEN.MEDIUM, LEN.MEDIUM, LEN.SHORT, -CRV.KINK);
  b.at('T3 MASSENET', LEN.SHORT, LEN.MEDIUM, LEN.SHORT, -CRV.MEDIUM);
  b.at('T4 CASINO', LEN.TINY, LEN.SHORT, LEN.SHORT, CRV.MEDIUM);
  b.at('T5 MIRABEAU', LEN.TINY, LEN.TINY, LEN.TINY, CRV.HARD);
  b.at('T6 GRAND HOTEL HAIRPIN', LEN.TINY, LEN.SHORT, LEN.TINY, -CRV.HAIRPIN);
  b.at('T7 MIRABEAU BAS', LEN.TINY, LEN.TINY, LEN.TINY, CRV.HARD);
  b.at('T8 PORTIER', LEN.TINY, LEN.TINY, LEN.TINY, CRV.HARD);
  b.at('TUNNEL', LEN.SHORT, LEN.LONG, LEN.MEDIUM, CRV.KINK);
  b.at('T10 NOUVELLE CHICANE', LEN.TINY, LEN.TINY, LEN.TINY, -CRV.TIGHT);
  b.at('T11 NOUVELLE CHICANE', LEN.TINY, LEN.TINY, LEN.TINY, CRV.TIGHT);
  b.at('T12 TABAC', LEN.TINY, LEN.SHORT, LEN.TINY, -CRV.HARD);
  b.esses('T13-14 SWIMMING POOL', LEN.TINY, -CRV.HARD);
  b.esses('T15-16 PISCINE', LEN.TINY, CRV.TIGHT);
  b.at('T17 LA RASCASSE', LEN.TINY, LEN.SHORT, LEN.TINY, CRV.HAIRPIN);
  b.at('T19 ANTHONY NOGHES', LEN.TINY, LEN.SHORT, LEN.SHORT, CRV.HARD);
  b.straight('START / FINISH', LEN.SHORT);

  b.grandstands(30, 90, -1);
  return b.finish();
}

/* ------------------------------------------------------------------
   Silverstone - clockwise. Abbey and Copse are flat-out rights, the
   Maggotts-Becketts-Chapel sweep is the classic left-right-left-
   right-left, and Hangar Straight runs down to Stowe.
   ------------------------------------------------------------------ */
function buildSilverstone() {
  var b = new TrackBuilder(THEMES.silverstone);

  b.straight('START / FINISH', LEN.MEDIUM);
  b.at('T1 ABBEY', LEN.SHORT, LEN.SHORT, LEN.SHORT, CRV.EASY);
  b.at('T2 FARM CURVE', LEN.SHORT, LEN.MEDIUM, LEN.SHORT, -CRV.EASY);
  b.at('T3 VILLAGE', LEN.TINY, LEN.SHORT, LEN.TINY, CRV.TIGHT);
  b.at('T4 THE LOOP', LEN.TINY, LEN.SHORT, LEN.TINY, -CRV.TIGHT);
  b.at('T5 AINTREE', LEN.SHORT, LEN.SHORT, LEN.SHORT, -CRV.EASY);
  b.straight('WELLINGTON STRAIGHT', LEN.LONG);
  b.at('T6 BROOKLANDS', LEN.SHORT, LEN.SHORT, LEN.SHORT, -CRV.MEDIUM);
  b.at('T7 LUFFIELD', LEN.SHORT, LEN.LONG, LEN.SHORT, CRV.TIGHT);
  b.at('T8 WOODCOTE', LEN.SHORT, LEN.SHORT, LEN.SHORT, CRV.EASY);
  b.straight('NATIONAL PIT STRAIGHT', LEN.MEDIUM);
  b.at('T9 COPSE', LEN.SHORT, LEN.MEDIUM, LEN.SHORT, CRV.EASY);
  b.at('T10 MAGGOTTS', LEN.TINY, LEN.SHORT, LEN.TINY, -CRV.EASY);
  b.at('T11 BECKETTS', LEN.TINY, LEN.SHORT, LEN.TINY, CRV.EASY);
  b.at('T12 BECKETTS', LEN.TINY, LEN.SHORT, LEN.TINY, -CRV.MEDIUM);
  b.at('T13 BECKETTS', LEN.TINY, LEN.SHORT, LEN.TINY, CRV.MEDIUM);
  b.at('T14 CHAPEL', LEN.SHORT, LEN.SHORT, LEN.SHORT, -CRV.EASY);
  b.straight('HANGAR STRAIGHT', LEN.HUGE);
  b.at('T15 STOWE', LEN.SHORT, LEN.MEDIUM, LEN.SHORT, CRV.MEDIUM);
  b.at('T16 VALE', LEN.TINY, LEN.TINY, LEN.TINY, -CRV.TIGHT);
  b.at('T17-18 CLUB', LEN.SHORT, LEN.MEDIUM, LEN.MEDIUM, CRV.MEDIUM);
  b.straight('START / FINISH', LEN.MEDIUM);

  b.scatter(['billboard'], 26, 1.6, 2.6);
  b.grandstands(20, 70, -1);
  b.grandstands(20, 70, 1);
  return b.finish();
}

/* ------------------------------------------------------------------
   Suzuka - the S curves flow left-right-left-right into Dunlop,
   Degner 1 and 2 are both rights, the hairpin is a left, Spoon is a
   double left, and 130R is a single flat-out left before the Casio
   Triangle chicane.
   ------------------------------------------------------------------ */
function buildSuzuka() {
  var b = new TrackBuilder(THEMES.suzuka);

  b.straight('START / FINISH', LEN.LONG);
  b.at('T1-2 FIRST CURVE', LEN.SHORT, LEN.MEDIUM, LEN.SHORT, CRV.EASY);
  b.esses('T3-4 S CURVES', LEN.TINY, -CRV.EASY);
  b.esses('T5-6 S CURVES', LEN.TINY, -CRV.EASY);
  b.at('T7 DUNLOP', LEN.SHORT, LEN.MEDIUM, LEN.SHORT, -CRV.MEDIUM);
  b.at('T8 DEGNER 1', LEN.TINY, LEN.TINY, LEN.TINY, CRV.MEDIUM);
  b.at('T9 DEGNER 2', LEN.TINY, LEN.SHORT, LEN.TINY, CRV.HARD);
  b.straight('CROSSOVER', LEN.SHORT);
  b.at('T11 HAIRPIN', LEN.TINY, LEN.SHORT, LEN.TINY, -CRV.HAIRPIN);
  b.at('T12-13 200R', LEN.MEDIUM, LEN.LONG, LEN.MEDIUM, CRV.EASY);
  b.at('T14 SPOON', LEN.SHORT, LEN.MEDIUM, LEN.TINY, -CRV.MEDIUM);
  b.at('T15 SPOON', LEN.TINY, LEN.MEDIUM, LEN.SHORT, -CRV.HARD);
  b.straight('BACK STRAIGHT', LEN.HUGE);
  b.at('T15 130R', LEN.SHORT, LEN.MEDIUM, LEN.SHORT, -CRV.KINK);
  b.straight('CASIO TRIANGLE', LEN.SHORT);
  b.at('T16 CHICANE', LEN.TINY, LEN.TINY, LEN.TINY, CRV.TIGHT);
  b.at('T17 CHICANE', LEN.TINY, LEN.TINY, LEN.TINY, -CRV.TIGHT);
  b.at('T18 FINAL CORNER', LEN.SHORT, LEN.MEDIUM, LEN.MEDIUM, CRV.MEDIUM);
  b.straight('START / FINISH', LEN.MEDIUM);

  b.scatter(['billboard'], 26, 1.6, 2.6);
  b.grandstands(25, 80, -1);
  return b.finish();
}

/* ------------------------------------------------------------------
   Monza - the Temple of Speed. Flat out down the main straight into
   the Rettifilo chicane (R-L), Curva Grande's long fast right, the
   Roggia chicane (L-R), two Lesmo rights, Ascari (L-R-L), the back
   straight, and the Parabolica's long right to bring it home.
   ------------------------------------------------------------------ */
function buildMonza() {
  var b = new TrackBuilder(THEMES.monza);

  b.straight('START / FINISH', LEN.HUGE);
  b.at('T1 RETTIFILO', LEN.TINY, LEN.TINY, LEN.TINY, CRV.TIGHT);
  b.at('T2 RETTIFILO', LEN.TINY, LEN.TINY, LEN.TINY, -CRV.TIGHT);
  b.at('T3 CURVA GRANDE', LEN.SHORT, LEN.LONG, LEN.SHORT, CRV.KINK);
  b.at('T4 ROGGIA', LEN.TINY, LEN.TINY, LEN.TINY, -CRV.TIGHT);
  b.at('T5 ROGGIA', LEN.TINY, LEN.TINY, LEN.TINY, CRV.TIGHT);
  b.at('T6 LESMO 1', LEN.TINY, LEN.SHORT, LEN.TINY, CRV.HARD);
  b.at('T7 LESMO 2', LEN.TINY, LEN.SHORT, LEN.TINY, CRV.HARD);
  b.straight('SERRAGLIO', LEN.LONG);
  b.at('T8 ASCARI', LEN.TINY, LEN.SHORT, LEN.TINY, -CRV.HARD);
  b.at('T9 ASCARI', LEN.TINY, LEN.SHORT, LEN.TINY, CRV.MEDIUM);
  b.at('T10 ASCARI', LEN.TINY, LEN.SHORT, LEN.TINY, -CRV.MEDIUM);
  b.straight('BACK STRAIGHT', LEN.HUGE);
  b.at('T11 PARABOLICA', LEN.SHORT, LEN.LONG, LEN.MEDIUM, CRV.MEDIUM);
  b.straight('START / FINISH', LEN.MEDIUM);

  b.scatter(['billboard'], 26, 1.6, 2.6);
  b.grandstands(15, 75, -1);
  b.grandstands(15, 75, 1);
  return b.finish();
}

/* ------------------------------------------------------------------
   Spa-Francorchamps - La Source hairpin, the Eau Rouge/Raidillon
   flick, the Kemmel straight, double-left Pouhon, flat-out
   Blanchimont and the Bus Stop chicane.
   ------------------------------------------------------------------ */
function buildSpa() {
  var b = new TrackBuilder(THEMES.spa);

  b.straight('START / FINISH', LEN.SHORT);
  b.at('T1 LA SOURCE', LEN.TINY, LEN.SHORT, LEN.TINY, CRV.HAIRPIN);
  b.straight('DOWNHILL RUN', LEN.MEDIUM);
  b.at('T2 EAU ROUGE', LEN.TINY, LEN.TINY, LEN.TINY, -CRV.EASY);
  b.at('T3 RAIDILLON', LEN.TINY, LEN.SHORT, LEN.TINY, CRV.EASY);
  b.straight('KEMMEL STRAIGHT', LEN.LONG);
  b.at('T5 LES COMBES', LEN.TINY, LEN.TINY, LEN.TINY, CRV.TIGHT);
  b.at('T6 LES COMBES', LEN.TINY, LEN.TINY, LEN.TINY, -CRV.HARD);
  b.at('T7 MALMEDY', LEN.TINY, LEN.SHORT, LEN.TINY, CRV.MEDIUM);
  b.at('T8 RIVAGE', LEN.TINY, LEN.SHORT, LEN.TINY, CRV.TIGHT);
  b.at('T9', LEN.SHORT, LEN.SHORT, LEN.SHORT, -CRV.MEDIUM);
  b.at('T10 POUHON', LEN.SHORT, LEN.MEDIUM, LEN.SHORT, -CRV.MEDIUM);
  b.at('T12 FAGNES', LEN.TINY, LEN.SHORT, LEN.TINY, CRV.MEDIUM);
  b.at('T13', LEN.TINY, LEN.SHORT, LEN.TINY, -CRV.MEDIUM);
  b.at('T14 STAVELOT', LEN.TINY, LEN.SHORT, LEN.TINY, CRV.MEDIUM);
  b.straight('RUN TO BLANCHIMONT', LEN.MEDIUM);
  b.at('T17 BLANCHIMONT', LEN.SHORT, LEN.MEDIUM, LEN.SHORT, -CRV.KINK);
  b.at('T18 BUS STOP', LEN.TINY, LEN.TINY, LEN.TINY, CRV.TIGHT);
  b.at('T19 BUS STOP', LEN.TINY, LEN.TINY, LEN.TINY, -CRV.TIGHT);
  b.straight('START / FINISH', LEN.MEDIUM);

  b.scatter(['billboard'], 26, 1.6, 2.6);
  b.grandstands(10, 60, -1);
  return b.finish();
}

/* ------------------------------------------------------------------
   Interlagos - anticlockwise: the Senna S, Curva do Sol, Reta
   Oposta, then the twisty infield down to Juncao and the long
   climb past the pits.
   ------------------------------------------------------------------ */
function buildInterlagos() {
  var b = new TrackBuilder(THEMES.interlagos);

  b.straight('START / FINISH', LEN.MEDIUM);
  b.at('T1 SENNA S', LEN.TINY, LEN.SHORT, LEN.TINY, -CRV.TIGHT);
  b.at('T2 SENNA S', LEN.TINY, LEN.SHORT, LEN.TINY, CRV.HARD);
  b.at('T3 CURVA DO SOL', LEN.SHORT, LEN.MEDIUM, LEN.SHORT, -CRV.MEDIUM);
  b.straight('RETA OPOSTA', LEN.LONG);
  b.at('T4 DESCIDA DO LAGO', LEN.SHORT, LEN.SHORT, LEN.SHORT, -CRV.HARD);
  b.at('T5', LEN.SHORT, LEN.SHORT, LEN.SHORT, -CRV.EASY);
  b.at('T6 FERRADURA', LEN.SHORT, LEN.MEDIUM, LEN.SHORT, CRV.MEDIUM);
  b.at('T7 LARANJINHA', LEN.TINY, LEN.SHORT, LEN.TINY, CRV.HARD);
  b.at('T8 PINHEIRINHO', LEN.TINY, LEN.SHORT, LEN.TINY, -CRV.TIGHT);
  b.at('T9 BICO DE PATO', LEN.TINY, LEN.SHORT, LEN.TINY, CRV.TIGHT);
  b.at('T10 MERGULHO', LEN.SHORT, LEN.SHORT, LEN.SHORT, -CRV.MEDIUM);
  b.at('T11 JUNCAO', LEN.TINY, LEN.SHORT, LEN.TINY, -CRV.HARD);
  b.at('SUBIDA DOS BOXES', LEN.MEDIUM, LEN.LONG, LEN.MEDIUM, -CRV.KINK);
  b.straight('START / FINISH', LEN.SHORT);

  b.scatter(['billboard'], 24, 1.6, 2.6);
  b.grandstands(15, 70, 1);
  return b.finish();
}

/* ------------------------------------------------------------------
   Bahrain - heavy stops, desert either side, four straights.
   ------------------------------------------------------------------ */
function buildBahrain() {
  var b = new TrackBuilder(THEMES.bahrain);

  b.straight('START / FINISH', LEN.LONG);
  b.at('T1', LEN.TINY, LEN.SHORT, LEN.TINY, CRV.TIGHT);
  b.at('T2', LEN.TINY, LEN.SHORT, LEN.TINY, -CRV.MEDIUM);
  b.at('T3', LEN.SHORT, LEN.SHORT, LEN.SHORT, CRV.EASY);
  b.straight('RUN TO T4', LEN.MEDIUM);
  b.at('T4', LEN.TINY, LEN.SHORT, LEN.TINY, CRV.TIGHT);
  b.esses('T5-6 ESSES', LEN.TINY, -CRV.MEDIUM);
  b.at('T8', LEN.TINY, LEN.SHORT, LEN.TINY, CRV.HARD);
  b.at('T9-10', LEN.TINY, LEN.SHORT, LEN.SHORT, -CRV.HARD);
  b.straight('BACK STRAIGHT', LEN.LONG);
  b.at('T11', LEN.SHORT, LEN.SHORT, LEN.SHORT, -CRV.MEDIUM);
  b.at('T13', LEN.TINY, LEN.SHORT, LEN.TINY, CRV.HARD);
  b.at('T14', LEN.TINY, LEN.SHORT, LEN.TINY, CRV.MEDIUM);
  b.straight('START / FINISH', LEN.SHORT);

  b.scatter(['billboard'], 24, 1.6, 2.6);
  b.grandstands(20, 75, -1);
  return b.finish();
}

/* ------------------------------------------------------------------
   Singapore - a night street circuit: ninety-degree corners between
   the walls, and a hairpin under the grandstand lights.
   ------------------------------------------------------------------ */
function buildSingapore() {
  var b = new TrackBuilder(THEMES.singapore);

  b.straight('START / FINISH', LEN.MEDIUM);
  b.at('T1', LEN.TINY, LEN.SHORT, LEN.TINY, -CRV.HARD);
  b.at('T2', LEN.TINY, LEN.SHORT, LEN.TINY, CRV.HARD);
  b.at('T3', LEN.TINY, LEN.SHORT, LEN.TINY, -CRV.TIGHT);
  b.straight('RAFFLES BOULEVARD', LEN.LONG);
  b.at('T7', LEN.TINY, LEN.SHORT, LEN.TINY, -CRV.TIGHT);
  b.at('T8', LEN.TINY, LEN.SHORT, LEN.TINY, CRV.HARD);
  b.at('T9', LEN.TINY, LEN.TINY, LEN.TINY, -CRV.KINK);
  b.straight('NICOLL HIGHWAY', LEN.MEDIUM);
  b.at('T10', LEN.TINY, LEN.TINY, LEN.TINY, -CRV.TIGHT);
  b.at('T11', LEN.TINY, LEN.SHORT, LEN.TINY, -CRV.HARD);
  b.at('T13 HAIRPIN', LEN.TINY, LEN.SHORT, LEN.TINY, -CRV.HAIRPIN);
  b.at('T14', LEN.TINY, LEN.SHORT, LEN.TINY, CRV.HARD);
  b.straight('ESPLANADE', LEN.MEDIUM);
  b.esses('T16-17', LEN.TINY, CRV.TIGHT);
  b.at('T18', LEN.TINY, LEN.SHORT, LEN.TINY, -CRV.TIGHT);
  b.at('T19', LEN.TINY, LEN.SHORT, LEN.TINY, CRV.HARD);
  b.straight('START / FINISH', LEN.SHORT);

  b.grandstands(20, 70, -1);
  return b.finish();
}

/* ------------------------------------------------------------------
   Circuit of the Americas - anticlockwise: the T1 hairpin, an
   esses run in the Silverstone mould, the long back straight and
   the stadium section.
   ------------------------------------------------------------------ */
function buildCota() {
  var b = new TrackBuilder(THEMES.cota);

  b.straight('START / FINISH', LEN.MEDIUM);
  b.at('T1 THE HILL', LEN.TINY, LEN.SHORT, LEN.TINY, -CRV.HAIRPIN);
  b.at('T2', LEN.SHORT, LEN.SHORT, LEN.SHORT, -CRV.KINK);
  b.esses('T3-4 ESSES', LEN.TINY, CRV.MEDIUM);
  b.esses('T5-6 ESSES', LEN.TINY, CRV.MEDIUM);
  b.at('T7', LEN.TINY, LEN.SHORT, LEN.TINY, -CRV.MEDIUM);
  b.at('T8', LEN.TINY, LEN.SHORT, LEN.TINY, CRV.MEDIUM);
  b.at('T9', LEN.TINY, LEN.SHORT, LEN.TINY, -CRV.MEDIUM);
  b.at('T11 HAIRPIN', LEN.TINY, LEN.SHORT, LEN.TINY, -CRV.HAIRPIN);
  b.straight('BACK STRAIGHT', LEN.HUGE);
  b.at('T12', LEN.TINY, LEN.SHORT, LEN.TINY, -CRV.TIGHT);
  b.at('T13', LEN.TINY, LEN.SHORT, LEN.TINY, CRV.HARD);
  b.at('T14', LEN.TINY, LEN.SHORT, LEN.TINY, -CRV.HARD);
  b.at('T15', LEN.TINY, LEN.SHORT, LEN.TINY, CRV.TIGHT);
  b.at('T16-18 TRIPLE', LEN.SHORT, LEN.MEDIUM, LEN.SHORT, CRV.EASY);
  b.at('T19', LEN.TINY, LEN.SHORT, LEN.TINY, -CRV.HARD);
  b.at('T20', LEN.TINY, LEN.SHORT, LEN.TINY, -CRV.TIGHT);
  b.straight('START / FINISH', LEN.SHORT);

  b.scatter(['billboard'], 26, 1.6, 2.6);
  b.grandstands(15, 65, 1);
  return b.finish();
}

/* ------------------------------------------------------------------
   Red Bull Ring - three big straights, ten corners, no hiding.
   ------------------------------------------------------------------ */
function buildRedBullRing() {
  var b = new TrackBuilder(THEMES.redbullring);

  b.straight('START / FINISH', LEN.MEDIUM);
  b.at('T1', LEN.TINY, LEN.SHORT, LEN.TINY, CRV.TIGHT);
  b.straight('UPHILL DRAG', LEN.LONG);
  b.at('T3', LEN.TINY, LEN.SHORT, LEN.TINY, CRV.TIGHT);
  b.straight('SCHLOSSGOLD RUN', LEN.LONG);
  b.at('T4', LEN.TINY, LEN.SHORT, LEN.TINY, CRV.HARD);
  b.at('T6', LEN.SHORT, LEN.SHORT, LEN.SHORT, -CRV.EASY);
  b.at('T7', LEN.TINY, LEN.SHORT, LEN.TINY, -CRV.MEDIUM);
  b.at('T9', LEN.SHORT, LEN.SHORT, LEN.SHORT, CRV.MEDIUM);
  b.at('T10', LEN.TINY, LEN.SHORT, LEN.TINY, CRV.HARD);
  b.straight('START / FINISH', LEN.SHORT);

  b.scatter(['billboard'], 22, 1.6, 2.6);
  b.grandstands(12, 60, -1);
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
  },
  monza: {
    id: 'monza',
    name: 'MONZA',
    subtitle: 'Autodromo Nazionale Monza',
    blurb: 'The Temple of Speed. Flat out, two chicanes, and the Parabolica.',
    grip: 1.02,
    build: buildMonza
  },
  spa: {
    id: 'spa',
    name: 'SPA',
    subtitle: 'Spa-Francorchamps',
    blurb: 'Eau Rouge, Pouhon, Blanchimont. The great old rollercoaster.',
    grip: 1.03,
    build: buildSpa
  },
  interlagos: {
    id: 'interlagos',
    name: 'INTERLAGOS',
    subtitle: 'Autodromo Jose Carlos Pace',
    blurb: 'Anticlockwise. The Senna S opens it, Juncao decides it.',
    grip: 1.0,
    build: buildInterlagos
  },
  bahrain: {
    id: 'bahrain',
    name: 'BAHRAIN',
    subtitle: 'Bahrain International Circuit',
    blurb: 'Four straights, heavy stops, desert on every exit.',
    grip: 1.0,
    build: buildBahrain
  },
  singapore: {
    id: 'singapore',
    name: 'SINGAPORE',
    subtitle: 'Marina Bay Street Circuit',
    blurb: 'Night race between the walls. Ninety-degree corners for two hours.',
    grip: 0.94,
    build: buildSingapore
  },
  cota: {
    id: 'cota',
    name: 'COTA',
    subtitle: 'Circuit of the Americas',
    blurb: 'Up the hill into T1, esses like Silverstone, a stadium to finish.',
    grip: 1.02,
    build: buildCota
  },
  redbullring: {
    id: 'redbullring',
    name: 'RED BULL RING',
    subtitle: 'Spielberg, Styria',
    blurb: 'Three big straights, ten corners, nowhere to hide.',
    grip: 1.04,
    build: buildRedBullRing
  }
};
