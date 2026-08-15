/* ------------------------------------------------------------------
   QualityManager — decides how much renderer to spend.

   Two jobs, kept apart on purpose:

     1. Pick a starting tier from what the device says about itself.
        Device hints are weak evidence, so this only sets the opening
        bid; the measured frame rate is what actually settles it.

     2. Trade resolution for frame rate at runtime. Dropping the
        render scale is the cheapest large win available and the least
        visible one — far preferable to culling geometry the player
        can see, which changes what the game looks like rather than how
        crisp it is.

   Resolution moves in small steps and only after a sustained run of
   slow frames, so a single hitch never visibly softens the picture.
   ------------------------------------------------------------------ */

/** Hard ceiling from the brief. Phones report 3+ and gain nothing for it. */
const MAX_DPR = 1.75;

const TIERS = {
  high:   { shadowMap: 1024, shadows: true,  drawDistance: 1400, kerbLod: 1.0, envDetail: 1.0 },
  medium: { shadowMap: 1024, shadows: true,  drawDistance: 1100, kerbLod: 0.7, envDetail: 0.7 },
  low:    { shadowMap: 512,  shadows: false, drawDistance:  850, kerbLod: 0.5, envDetail: 0.45 }
};

export class QualityManager {
  constructor(renderer) {
    this.renderer = renderer;

    /* Opening bid. Core count and memory are crude proxies, but they
       separate a desktop from a budget phone often enough to matter,
       and being wrong only costs a second of adaptation. */
    const cores = navigator.hardwareConcurrency || 4;
    const mem = navigator.deviceMemory || 4;
    const coarse = typeof matchMedia === 'function' &&
      matchMedia('(pointer: coarse)').matches;

    this.tier = (!coarse && cores >= 8) ? 'high'
      : (cores >= 6 && mem >= 4) ? 'medium'
      : 'low';

    /** Dynamic resolution factor, 1 = full. Never below 0.6: past that
        the picture is mush and the frame rate problem is elsewhere. */
    this.scale = 1;
    this.minScale = 0.6;
    this.baseDpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    this.effectiveDpr = this.baseDpr;

    this._cooldown = 0;
    this.locked = false;      // set true to freeze adaptation while profiling
  }

  get settings() { return TIERS[this.tier]; }

  /** Re-read the display's DPR (it changes when a window moves screens). */
  refreshDpr() {
    this.baseDpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    this._apply();
  }

  _apply() {
    this.effectiveDpr = Math.max(0.5, this.baseDpr * this.scale);
    this.renderer.setPixelRatio(this.effectiveDpr);
  }

  /**
   * Watch the frame rate and move the resolution to meet it.
   * Returns true when something changed, so the caller can resize.
   */
  update(perf, dt) {
    if (this.locked) return false;
    this._cooldown -= dt;
    if (this._cooldown > 0) return false;

    /* Sustained miss: give up some resolution. */
    if (perf.slowStreak > 45 && this.scale > this.minScale) {
      this.scale = Math.max(this.minScale, this.scale - 0.1);
      this._cooldown = 1.5;
      this._apply();
      return true;
    }

    /* Comfortable for a while: try to buy it back. Slower than the
       way down, so the two do not oscillate around the threshold. */
    if (perf.fastStreak > 180 && this.scale < 1) {
      this.scale = Math.min(1, this.scale + 0.05);
      this._cooldown = 3;
      this._apply();
      return true;
    }

    /* Still drowning at the floor: drop a whole tier, once. */
    if (perf.slowStreak > 240 && this.scale <= this.minScale && this.tier !== 'low') {
      this.tier = this.tier === 'high' ? 'medium' : 'low';
      this._cooldown = 5;
      return true;
    }

    return false;
  }
}
