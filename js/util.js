/* ------------------------------------------------------------------
   util.js - math helpers and the pseudo-3D projection
   ------------------------------------------------------------------ */
'use strict';

var Util = {

  limit: function (value, min, max) {
    return Math.max(min, Math.min(value, max));
  },

  randomInt: function (min, max) {
    return Math.round(Util.interpolate(min, max, Math.random()));
  },

  randomChoice: function (options) {
    return options[Util.randomInt(0, options.length - 1)];
  },

  /* how far (0..1) we are through the segment that contains `n` */
  percentRemaining: function (n, total) {
    return (n % total) / total;
  },

  accelerate: function (v, accel, dt) {
    return v + accel * dt;
  },

  interpolate: function (a, b, percent) {
    return a + (b - a) * percent;
  },

  easeIn: function (a, b, percent) {
    return a + (b - a) * Math.pow(percent, 2);
  },

  easeOut: function (a, b, percent) {
    return a + (b - a) * (1 - Math.pow(1 - percent, 2));
  },

  easeInOut: function (a, b, percent) {
    return a + (b - a) * (-Math.cos(percent * Math.PI) / 2 + 0.5);
  },

  exponentialFog: function (distance, density) {
    return 1 / Math.pow(Math.E, distance * distance * density);
  },

  /* wrap a value into the [0, max) range - used for track position */
  increase: function (start, increment, max) {
    var result = start + increment;
    while (result >= max) result -= max;
    while (result < 0) result += max;
    return result;
  },

  /* ----------------------------------------------------------------
     The heart of the renderer: project a point of the road ribbon from
     world space into screen space, as seen from the driver's eyes.

       scale   = cameraDepth / distanceToPoint
       screenX = centre + scale * relativeX * halfWidth
       screenY = horizon - scale * relativeY * halfHeight
     ---------------------------------------------------------------- */
  project: function (p, cameraX, cameraY, cameraZ, cameraDepth, width, height, roadWidth) {
    p.camera.x = (p.world.x || 0) - cameraX;
    p.camera.y = (p.world.y || 0) - cameraY;
    p.camera.z = (p.world.z || 0) - cameraZ;
    p.screen.scale = cameraDepth / p.camera.z;
    p.screen.x = Math.round(width / 2 + (p.screen.scale * p.camera.x * width) / 2);
    p.screen.y = Math.round(height / 2 - (p.screen.scale * p.camera.y * height) / 2);
    p.screen.w = Math.round((p.screen.scale * roadWidth * width) / 2);
  },

  /* 1D overlap test used for car-to-car contact */
  overlap: function (x1, w1, x2, w2, percent) {
    var half = (percent || 1) / 2;
    var min1 = x1 - w1 * half;
    var max1 = x1 + w1 * half;
    var min2 = x2 - w2 * half;
    var max2 = x2 + w2 * half;
    return !(max1 < min2 || min1 > max2);
  },

  /* 92.417 -> "1:32.417" */
  formatTime: function (seconds) {
    if (seconds === null || seconds === undefined || !isFinite(seconds)) return '--:--.---';
    var minutes = Math.floor(seconds / 60);
    var rest = seconds - minutes * 60;
    var whole = Math.floor(rest);
    var ms = Math.floor((rest - whole) * 1000);
    return minutes + ':' + (whole < 10 ? '0' : '') + whole + '.' + ('00' + ms).slice(-3);
  },

  formatDelta: function (seconds) {
    if (seconds === null || seconds === undefined || !isFinite(seconds)) return '';
    var sign = seconds >= 0 ? '+' : '-';
    return sign + Math.abs(seconds).toFixed(3);
  },

  ordinal: function (n) {
    var s = ['th', 'st', 'nd', 'rd'];
    var v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }
};
