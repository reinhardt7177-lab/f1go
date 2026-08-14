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
  /** Overall scale on steering lock. Below 1 for a calmer car. */
  steerSensitivity: number;
}

const defaultOptions = (): InputOptions => ({
  steerRampTime: 0.34,
  steerReturnTime: 0.18,
  steerExpo: 1.6,
  steerSensitivity: 0.88
});

/**
 * Shape a raw −1..1 steering request into something driveable.
 *
 * Resolution is the problem being solved. A linear input spends as much
 * travel between 90% and 100% lock — which nobody uses — as between 0%
 * and 10%, which is where all of the driving happens. The expo curve
 * moves travel to where it is needed. It is a reshaping, not a cut: 0
 * stays 0 and full travel still reaches full lock.
 *
 * There is deliberately **no speed term here**, and that is the fix for
 * the second complaint rather than an omission. `ChassisParams` already
 * reduces mechanical lock as speed rises — down to 45% by 300 km/h —
 * and an earlier pass added a controller-level falloff on top of it.
 * The two multiply. At 220 km/h a half-travel input came out at 0.074
 * of lock from this function and was then cut again by the chassis to
 * under a degree at the road wheel, which is why the steering went from
 * darting about to feeling like it was not connected to anything. One
 * falloff, owned by the car, is the whole of it.
 */
export const shapeSteer = (
  raw: number,
  o: Pick<InputOptions, 'steerExpo' | 'steerSensitivity'>
): number => {
  const magnitude = Math.min(Math.abs(raw), 1);
  const curved = Math.pow(magnitude, o.steerExpo);
  return Math.sign(raw) * curved * clamp(o.steerSensitivity, 0, 1);
};

export class InputManager {
  readonly controls: ControlState = neutralControls();

  /** Present when a touch surface was supplied; null on desktop. */
  readonly touch: TouchControls | null;

  private readonly keys = new Set<string>();
  /**
   * Live, not frozen at construction: steering feel is the one setting
   * that cannot be judged from the code, so it is bound to sliders and
   * read fresh every tick.
   */
  readonly options: InputOptions;
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
      c.steer = shapeSteer(this.touch.steer, this.options);
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
          : shapeSteer(clamp(axis, -1, 1), this.options);
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
      c.steer = shapeSteer(this.steerRaw, this.options);

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
