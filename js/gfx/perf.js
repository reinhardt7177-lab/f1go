/* ------------------------------------------------------------------
   PerformanceMonitor — the instrument panel for the renderer itself.

   Nothing here draws the game; it measures it. Before this existed the
   project had no way to answer "is this fast on a phone?", so every
   optimisation was a guess. The numbers it exposes are the ones the
   budget is written in: frames per second, draw calls and triangles.

   `renderer.info` is reset by three each frame, so it must be read
   AFTER the draw call, not before.
   ------------------------------------------------------------------ */
export class PerformanceMonitor {
  constructor() {
    /** Smoothed frame rate. Seeded at 60 so the first second of a
        cold start does not look like a stall and trigger a downgrade. */
    this.fps = 60;
    this.frameMs = 16.7;
    this.calls = 0;
    this.triangles = 0;
    this.programs = 0;

    this._last = 0;
    /** Frames whose budget was missed, in a row. The quality manager
        reacts to a run of bad frames, never to a single spike. */
    this.slowStreak = 0;
    this.fastStreak = 0;

    this._overlay = null;
    this._acc = 0;
  }

  /** Call at the very top of the frame, before any work. */
  beginFrame(now) {
    if (this._last) {
      const dt = now - this._last;
      /* Clamp: a backgrounded tab returns multi-second deltas that
         would otherwise read as a catastrophic frame rate. */
      this.frameMs = Math.min(dt, 250);
      const inst = 1000 / Math.max(this.frameMs, 1);
      this.fps += (inst - this.fps) * 0.12;

      if (this.fps < 55) { this.slowStreak++; this.fastStreak = 0; }
      else if (this.fps > 58) { this.fastStreak++; this.slowStreak = 0; }
      else { this.slowStreak = 0; this.fastStreak = 0; }
    }
    this._last = now;
  }

  /** Call after renderer.render(), which is when info is populated. */
  endFrame(renderer) {
    const info = renderer.info;
    this.calls = info.render.calls;
    this.triangles = info.render.triangles;
    this.programs = info.programs ? info.programs.length : 0;
  }

  /** Budgets from the brief, so an overrun is visible rather than felt. */
  overBudget() {
    return this.triangles > 250000 || this.calls > 100;
  }

  showOverlay(show) {
    if (show && !this._overlay) {
      const el = document.createElement('div');
      el.id = 'gfx-perf';
      el.style.cssText =
        'position:fixed;left:8px;bottom:8px;z-index:60;pointer-events:none;' +
        'font:11px/1.5 ui-monospace,Menlo,Consolas,monospace;color:#8affc1;' +
        'background:rgba(6,8,11,.78);border:1px solid rgba(255,255,255,.12);' +
        'border-radius:6px;padding:6px 8px;white-space:pre;font-variant-numeric:tabular-nums';
      document.body.appendChild(el);
      this._overlay = el;
    } else if (!show && this._overlay) {
      this._overlay.remove();
      this._overlay = null;
    }
  }

  /** Refreshed a few times a second — text churn is itself a cost. */
  updateOverlay(dt, quality) {
    if (!this._overlay) return;
    this._acc += dt;
    if (this._acc < 0.25) return;
    this._acc = 0;

    const over = this.overBudget();
    this._overlay.style.color = over ? '#ff8080' : this.fps < 50 ? '#ffd24a' : '#8affc1';
    this._overlay.textContent =
      `${this.fps.toFixed(0)} fps   ${this.frameMs.toFixed(1)} ms\n` +
      `${this.calls} calls / 100\n` +
      `${(this.triangles / 1000).toFixed(0)}k tris / 250k\n` +
      `dpr ${quality.effectiveDpr.toFixed(2)}  ${quality.tier}`;
  }
}
