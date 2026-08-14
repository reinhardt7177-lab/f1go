/**
 * Fixed-timestep loop with render interpolation.
 *
 * The simulation advances in constant slices so that its behaviour never
 * depends on the display refresh rate — a 144 Hz monitor drives exactly
 * the same car as a 60 Hz one, and a recorded input sequence always
 * replays identically. Rendering happens once per animation frame at
 * whatever rate the browser offers, blending the two most recent
 * simulation states by `alpha`.
 */
export interface LoopCallbacks {
  /** Advance the simulation by exactly `dt` seconds. */
  step: (dt: number) => void;
  /** Draw. `alpha` is 0..1 between the previous and current sim state. */
  render: (alpha: number, frameDt: number) => void;
}

export class FixedLoop {
  readonly dt: number;

  private accumulator = 0;
  private last = 0;
  private running = false;
  private raf = 0;

  /** Simulation steps taken since the loop started — the tick counter. */
  ticks = 0;
  /** Steps taken during the most recent frame, for the debug overlay. */
  stepsLastFrame = 0;

  /**
   * @param hz            simulation rate; 120 Hz keeps tyre slip stable
   * @param maxStepsPerFrame guard against the spiral of death after a stall
   */
  constructor(hz = 120, private readonly maxStepsPerFrame = 8) {
    this.dt = 1 / hz;
  }

  start(cb: LoopCallbacks): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();

    const frame = (now: number): void => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(frame);

      const frameDt = Math.min(0.25, (now - this.last) / 1000);
      this.last = now;
      this.accumulator += frameDt;

      let steps = 0;
      while (this.accumulator >= this.dt && steps < this.maxStepsPerFrame) {
        cb.step(this.dt);
        this.accumulator -= this.dt;
        this.ticks++;
        steps++;
      }
      this.stepsLastFrame = steps;

      // If we hit the cap the machine cannot keep up; drop the backlog
      // rather than falling further behind every frame.
      if (steps === this.maxStepsPerFrame) this.accumulator = 0;

      cb.render(this.accumulator / this.dt, frameDt);
    };

    this.raf = requestAnimationFrame(frame);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }
}
