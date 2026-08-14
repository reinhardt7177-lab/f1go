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
import { TouchControls } from './touch';

export interface InputOptions {
  /** Seconds for the keyboard to reach full steering lock. */
  steerRampTime: number;
  /** Seconds for the steering to return to centre when released. */
  steerReturnTime: number;
  /**
   * Exponent on the steering input. 1 is linear; above 1 spreads the
   * region near centre over more travel, so small corrections are small
   * and full lock is still reachable at the stop.
   */
  steerExpo: number;
  /** Fraction of input still passed through at `steerFalloffSpeed`. */
  steerHighSpeed: number;
  /** Speed (km/h) at which `steerHighSpeed` is reached. */
  steerFalloffSpeed: number;
}

const defaultOptions = (): InputOptions => ({
  steerRampTime: 0.42,
  steerReturnTime: 0.18,
  steerExpo: 2.2,
  steerHighSpeed: 0.34,
  steerFalloffSpeed: 220
});

/**
 * Shape a raw −1..1 steering request into something driveable.
 *
 * Two separate problems, and they need separate treatment.
 *
 * The first is resolution. A linear stick spends as much travel between
 * 90% and 100% lock — which nobody uses — as between 0% and 10%, which
 * is where all of the driving happens. The expo curve moves travel to
 * where it is needed. It is a pure reshaping: 0 stays 0 and 1 stays 1,
 * so nothing is taken away, it is just spread differently.
 *
 * The second is speed. The vehicle already reduces mechanical lock as
 * speed rises, but that is a property of the car and the AI's pure
 * pursuit is calibrated against it. This second reduction is a property
 * of the *controller* — the difference between a thumb on glass and a
 * wheel with 900 degrees of rotation — so it belongs here, where only
 * human input passes through, and not in the vehicle where it would
 * quietly bend the AI's steering out from under it.
 */
export const shapeSteer = (
  raw: number,
  speedKmh: number,
  o: Pick<InputOptions, 'steerExpo' | 'steerHighSpeed' | 'steerFalloffSpeed'>
): number => {
  const magnitude = Math.min(Math.abs(raw), 1);
  const curved = Math.pow(magnitude, o.steerExpo);
  const t = clamp(speedKmh / o.steerFalloffSpeed, 0, 1);
  const scale = 1 - (1 - o.steerHighSpeed) * t;
  return Math.sign(raw) * curved * scale;
};

export class InputManager {
  readonly controls: ControlState = neutralControls();

  /** Present when a touch surface was supplied; null on desktop. */
  readonly touch: TouchControls | null;

  private readonly keys = new Set<string>();
  private readonly options: InputOptions;
  private shiftUpEdge = false;
  private shiftDownEdge = false;
  private resetEdge = false;

  constructor(
    target: EventTarget = window,
    options: Partial<InputOptions> = {},
    touchSurface: HTMLElement | null = null
  ) {
    this.options = { ...defaultOptions(), ...options };
    this.touch = touchSurface ? new TouchControls(touchSurface) : null;

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
    this.touch?.update(dt);

    // Touch wins while a finger is down; otherwise the keyboard is free
    // to drive, so a tablet with a keyboard attached works either way.
    if (this.touch?.active && (this.touch.throttle > 0 || this.touch.brake > 0 || this.touch.steer !== 0)) {
      c.throttle = this.touch.throttle;
      c.brake = this.touch.brake;
      c.steer = shapeSteer(this.touch.steer, this.lastSpeedKmh, this.options);
      c.straightMode = this.touch.straightMode;
      c.overtake = this.touch.overtake;

      // Nobody can work a sequential gearbox and steer on a touchscreen
      // at once, so it shifts itself. Road speed, not rpm — during
      // wheelspin the engine sits on the limiter while the car crawls.
      const kmh = this.lastSpeedKmh;
      const wantShift = kmh > this.autoGear * 42;
      if (wantShift && this.shiftArmed) {
        this.shiftUpEdge = true;
        this.shiftArmed = false;
      } else if (!wantShift) {
        this.shiftArmed = true;
      }

      c.shiftUp = this.shiftUpEdge;
      c.shiftDown = this.shiftDownEdge;
      this.shiftUpEdge = false;
      this.shiftDownEdge = false;
      return c;
    }

    if (gp) {
      c.throttle = clamp(gp.buttons[7]?.value ?? 0, 0, 1);
      c.brake = clamp(gp.buttons[6]?.value ?? 0, 0, 1);
      const axis = gp.axes[0] ?? 0;
      c.steer =
        Math.abs(axis) < 0.06
          ? 0
          : shapeSteer(clamp(axis, -1, 1), this.lastSpeedKmh, this.options);
      this.shiftUpEdge ||= gp.buttons[5]?.pressed === true;
      this.shiftDownEdge ||= gp.buttons[4]?.pressed === true;
      c.straightMode = gp.buttons[3]?.pressed === true;
      c.overtake = gp.buttons[0]?.pressed === true;
    } else {
      c.throttle = this.down('ArrowUp', 'KeyW') ? 1 : 0;
      c.brake = this.down('ArrowDown', 'KeyS', 'Space') ? 1 : 0;

      const target = (this.down('ArrowRight', 'KeyD') ? 1 : 0) - (this.down('ArrowLeft', 'KeyA') ? 1 : 0);
      const rate = target === 0 ? dt / this.options.steerReturnTime : dt / this.options.steerRampTime;
      // Ramp the raw request and shape it afterwards. Ramping the shaped
      // value instead would feed the curve its own output every tick and
      // compound it, so the response would depend on how long a key has
      // been held rather than only on how far the input has travelled.
      this.steerRaw = approach(this.steerRaw, target, rate);
      c.steer = shapeSteer(this.steerRaw, this.lastSpeedKmh, this.options);

      c.straightMode = this.down('KeyF');
      c.overtake = this.down('ShiftLeft', 'ShiftRight');
    }

    // Shift requests are edges: the drivetrain consumes one per tick.
    c.shiftUp = this.shiftUpEdge;
    c.shiftDown = this.shiftDownEdge;
    this.shiftUpEdge = false;
    this.shiftDownEdge = false;

    return c;
  }

  private lastSpeedKmh = 0;
  private autoGear = 1;
  private shiftArmed = true;
  /** Un-shaped keyboard steering position, ramped towards the key state. */
  private steerRaw = 0;

  /**
   * Tell the input layer how fast the car is going and what gear it is
   * in, so touch play can shift for itself.
   */
  observe(speedKmh: number, gear: number): void {
    this.lastSpeedKmh = speedKmh;
    this.autoGear = gear;
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
