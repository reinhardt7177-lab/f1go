/**
 * Touch controls.
 *
 * Produces the same three analogue values a wheel and pedals would, so
 * `InputManager` can fold them in and nothing downstream knows the
 * difference.
 *
 * Two decisions worth stating. Steering is a *relative* drag rather than
 * an absolute pad: you put your thumb down wherever is comfortable and
 * that becomes centre, which matters because a phone is held differently
 * every time and a fixed centre means fighting the controls. And the
 * pedals are analogue by travel — how far up the pad your thumb is sets
 * how much throttle — because on-off pedals make a 1000 bhp car
 * undriveable on a touchscreen.
 */
import { clamp } from '../core/math';

export interface TouchOptions {
  /** Drag distance for full lock, as a fraction of the shorter screen edge. */
  steerTravel: number;
  /** Dead zone around the origin, in the same units. */
  steerDeadzone: number;
  /** Seconds for steering to spring back when the thumb lifts. */
  returnTime: number;
}

const defaultOptions = (): TouchOptions => ({
  // A fifth of the short edge for full lock. 0.16 was too short to aim
  // inside; 0.26 was so long that, stacked on the expo curve and the
  // chassis' own speed falloff, the car stopped responding at all.
  steerTravel: 0.20,
  steerDeadzone: 0.014,
  returnTime: 0.14
});

interface Pointer {
  id: number;
  originX: number;
  originY: number;
  x: number;
  y: number;
  /** Which control this finger claimed when it went down. */
  role: 'steer' | 'pedals';
}

export class TouchControls {
  steer = 0;
  throttle = 0;
  brake = 0;
  overtake = false;
  straightMode = false;

  /** True once any touch has been seen, so the UI can reveal itself. */
  active = false;

  private readonly pointers = new Map<number, Pointer>();
  private readonly options: TouchOptions;

  constructor(surface: HTMLElement, options: Partial<TouchOptions> = {}) {
    this.options = { ...defaultOptions(), ...options };

    const claim = (e: PointerEvent): void => {
      if (e.pointerType === 'mouse') return;
      this.active = true;

      // Left half steers, right half is throttle and brake. Splitting by
      // where the finger *landed*, not where it currently is, means a
      // steering drag that wanders across the middle keeps steering.
      const role: Pointer['role'] = e.clientX < window.innerWidth * 0.5 ? 'steer' : 'pedals';
      this.pointers.set(e.pointerId, {
        id: e.pointerId,
        originX: e.clientX,
        originY: e.clientY,
        x: e.clientX,
        y: e.clientY,
        role
      });

      // Capture last, and never let it take the finger down with it.
      // Registering after capture means a browser that refuses the
      // capture — or any synthetic event — silently drops the touch, and
      // the pedals stop working while the steering carries on.
      try {
        surface.setPointerCapture(e.pointerId);
      } catch {
        // Capture is an optimisation; the pointer is already tracked.
      }
      e.preventDefault();
    };

    const move = (e: PointerEvent): void => {
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      p.x = e.clientX;
      p.y = e.clientY;
      e.preventDefault();
    };

    const release = (e: PointerEvent): void => {
      this.pointers.delete(e.pointerId);
    };

    surface.addEventListener('pointerdown', claim, { passive: false });
    surface.addEventListener('pointermove', move, { passive: false });
    surface.addEventListener('pointerup', release);
    surface.addEventListener('pointercancel', release);
    surface.addEventListener('pointerleave', release);
  }

  /** Where the steering thumb went down, for drawing the pad. */
  steerOrigin(): { x: number; y: number } | null {
    for (const p of this.pointers.values()) {
      if (p.role === 'steer') return { x: p.originX, y: p.originY };
    }
    return null;
  }

  pedalOrigin(): { x: number; y: number } | null {
    for (const p of this.pointers.values()) {
      if (p.role === 'pedals') return { x: p.originX, y: p.originY };
    }
    return null;
  }

  update(dt: number): void {
    const shortEdge = Math.min(window.innerWidth, window.innerHeight);
    const travel = this.options.steerTravel * shortEdge;
    const dead = this.options.steerDeadzone * shortEdge;

    let steering: Pointer | null = null;
    let pedals: Pointer | null = null;
    for (const p of this.pointers.values()) {
      if (p.role === 'steer') steering = p;
      else pedals = p;
    }

    if (steering) {
      const dx = steering.x - steering.originX;
      const magnitude = Math.max(0, Math.abs(dx) - dead);
      this.steer = clamp((Math.sign(dx) * magnitude) / travel, -1, 1);
    } else {
      // Spring back to centre rather than snapping, so lifting a thumb
      // mid-corner does not throw the car.
      const k = clamp(dt / this.options.returnTime, 0, 1);
      this.steer += (0 - this.steer) * k;
      if (Math.abs(this.steer) < 0.01) this.steer = 0;
    }

    if (pedals) {
      // Up from the landing point is throttle, down is brake, and how far
      // sets how much.
      const dy = pedals.originY - pedals.y;
      const magnitude = Math.max(0, Math.abs(dy) - dead) / travel;
      if (dy >= 0) {
        this.throttle = clamp(magnitude, 0, 1);
        this.brake = 0;
      } else {
        this.throttle = 0;
        this.brake = clamp(magnitude, 0, 1);
      }
      // A thumb resting on the pad without moving still means "go".
      if (this.throttle === 0 && this.brake === 0) this.throttle = 0.45;
    } else {
      this.throttle = 0;
      this.brake = 0;
    }
  }
}
