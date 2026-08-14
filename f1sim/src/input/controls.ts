/**
 * Input sources produce a `ControlState` and nothing else.
 *
 * Keeping this boundary narrow is what lets the same simulation be
 * driven by a keyboard, a wheel, a replay file or the AI without any of
 * them knowing about each other.
 */
import { approach, clamp } from '../core/math';
import { neutralControls } from '../sim/types';
import type { ControlState } from '../sim/types';

export interface InputOptions {
  /** Seconds for the keyboard to reach full steering lock. */
  steerRampTime: number;
  /** Seconds for the steering to return to centre when released. */
  steerReturnTime: number;
}

const defaultOptions = (): InputOptions => ({
  steerRampTime: 0.28,
  steerReturnTime: 0.16
});

export class InputManager {
  readonly controls: ControlState = neutralControls();

  private readonly keys = new Set<string>();
  private readonly options: InputOptions;
  private shiftUpEdge = false;
  private shiftDownEdge = false;
  private resetEdge = false;

  constructor(target: EventTarget = window, options: Partial<InputOptions> = {}) {
    this.options = { ...defaultOptions(), ...options };

    target.addEventListener('keydown', (raw) => {
      const e = raw as KeyboardEvent;
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === 'KeyE') this.shiftUpEdge = true;
      if (e.code === 'KeyQ') this.shiftDownEdge = true;
      if (e.code === 'KeyR') this.resetEdge = true;
      if (SWALLOW.has(e.code)) e.preventDefault();
    });

    target.addEventListener('keyup', (raw) => {
      this.keys.delete((raw as KeyboardEvent).code);
    });

    target.addEventListener('blur', () => this.keys.clear());
  }

  private down(...codes: string[]): boolean {
    return codes.some((c) => this.keys.has(c));
  }

  /** True exactly once per press. */
  consumeReset(): boolean {
    const v = this.resetEdge;
    this.resetEdge = false;
    return v;
  }

  /**
   * Fold the current hardware state into `controls`. Called once per
   * simulation tick so that ramps are frame-rate independent.
   */
  update(dt: number): ControlState {
    const c = this.controls;
    const gp = this.gamepad();

    if (gp) {
      c.throttle = clamp(gp.buttons[7]?.value ?? 0, 0, 1);
      c.brake = clamp(gp.buttons[6]?.value ?? 0, 0, 1);
      const axis = gp.axes[0] ?? 0;
      c.steer = Math.abs(axis) < 0.06 ? 0 : clamp(axis, -1, 1);
      this.shiftUpEdge ||= gp.buttons[5]?.pressed === true;
      this.shiftDownEdge ||= gp.buttons[4]?.pressed === true;
      c.drs = gp.buttons[3]?.pressed === true;
      c.ers = gp.buttons[0]?.pressed === true;
    } else {
      c.throttle = this.down('ArrowUp', 'KeyW') ? 1 : 0;
      c.brake = this.down('ArrowDown', 'KeyS', 'Space') ? 1 : 0;

      const target = (this.down('ArrowRight', 'KeyD') ? 1 : 0) - (this.down('ArrowLeft', 'KeyA') ? 1 : 0);
      const rate = target === 0 ? dt / this.options.steerReturnTime : dt / this.options.steerRampTime;
      c.steer = approach(c.steer, target, rate);

      c.drs = this.down('KeyF');
      c.ers = this.down('ShiftLeft', 'ShiftRight');
    }

    // Shift requests are edges: the drivetrain consumes one per tick.
    c.shiftUp = this.shiftUpEdge;
    c.shiftDown = this.shiftDownEdge;
    this.shiftUpEdge = false;
    this.shiftDownEdge = false;

    return c;
  }

  private gamepad(): Gamepad | null {
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return null;
    for (const pad of navigator.getGamepads()) {
      if (pad?.connected) return pad;
    }
    return null;
  }
}

const SWALLOW = new Set([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Space'
]);
