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
 *
 * Three things this file has learned since:
 *
 *   - **`pointerleave` is not a release.** It was in the release set,
 *     and on a phone a steering thumb reaches the bottom edge of the
 *     screen in any long corner. The pointer leaves the canvas, the
 *     touch is dropped, and the car straightens mid-apex while the
 *     player's thumb has not moved. Only `pointerup`, `pointercancel`
 *     and `lostpointercapture` end a touch.
 *
 *   - **First finger wins its role.** Roles used to be resolved by
 *     iterating the map, so a second finger landing in the same half
 *     silently took over — and a palm resting on the glass took over
 *     from the thumb. The finger that claimed a role keeps it until it
 *     lifts.
 *
 *   - **A thumb that has not moved is not a request for 45% throttle.**
 *     It was, which meant a light brake — a short pull inside the dead
 *     zone — came out as acceleration. Resting still means go, but only
 *     until the thumb moves; after that the pad reports what the thumb
 *     is doing, including a very small amount of it.
 */
import { clamp } from '../core/math';
import { defaultZoneOptions, reservedRects, roleAt } from './zones';
import type { Rect, Role, ZoneOptions } from './zones';

export interface TouchOptions extends ZoneOptions {
  /** Drag distance for full lock, as a fraction of the shorter screen edge. */
  steerTravel: number;
  /** Dead zone around the origin, in the same units. */
  steerDeadzone: number;
  /** Seconds for steering to spring back when the thumb lifts. */
  returnTime: number;
  /** Throttle held by a thumb that is down but has not moved. */
  restingThrottle: number;
  /**
   * Elements whose footprint the pads must keep out of — the on-screen
   * buttons. Measured at each touch rather than declared, so moving one
   * in CSS moves its dead zone with it.
   */
  reserve: readonly Element[];
}

const defaultOptions = (): TouchOptions => ({
  ...defaultZoneOptions(),
  // A fifth of the short edge for full lock. 0.16 was too short to aim
  // inside; 0.26 was so long that, stacked on the expo curve and the
  // chassis' own speed falloff, the car stopped responding at all.
  steerTravel: 0.2,
  steerDeadzone: 0.014,
  returnTime: 0.14,
  restingThrottle: 0.45,
  reserve: []
});

interface Pointer {
  id: number;
  originX: number;
  originY: number;
  x: number;
  y: number;
  /** Which control this finger claimed when it went down. */
  role: Role;
  /** Set once the finger has travelled past the dead zone. */
  moved: boolean;
  /** Order of arrival, so the earliest holder of a role keeps it. */
  seq: number;
}

/** Where a thumb is, and what it is asking for — for drawing the pad. */
export interface PadState {
  originX: number;
  originY: number;
  x: number;
  y: number;
  /** −1..1 for steering, 0..1 for the pedals. */
  value: number;
  /** Pixels of travel that mean full deflection, for the pad's radius. */
  travel: number;
}

export class TouchControls {
  steer = 0;
  throttle = 0;
  brake = 0;
  overtake = false;
  straightMode = false;

  /** True once any touch has been seen, so the UI can reveal itself. */
  active = false;

  /** True while at least one finger is on a control. */
  get holding(): boolean {
    return this.pointers.size > 0;
  }

  readonly options: TouchOptions;

  private readonly pointers = new Map<number, Pointer>();
  private arrivals = 0;
  /** Viewport used for zone decisions; overridable so tests need no DOM. */
  private view = { width: 0, height: 0 };

  constructor(surface: HTMLElement, options: Partial<TouchOptions> = {}) {
    this.options = { ...defaultOptions(), ...options };

    const claim = (e: PointerEvent): void => {
      if (e.pointerType === 'mouse') return;
      this.measure();

      /* Splitting by where the finger *landed*, not where it currently
         is, means a steering drag that wanders across the middle keeps
         steering. `roleAt` also reserves the corner the on-screen
         buttons occupy and a margin at each edge — see `zones.ts`. */
      const role = roleAt(
        e.clientX,
        e.clientY,
        this.view,
        this.options,
        this.reserved()
      );
      if (role === null) return;

      this.active = true;
      this.pointers.set(e.pointerId, {
        id: e.pointerId,
        originX: e.clientX,
        originY: e.clientY,
        x: e.clientX,
        y: e.clientY,
        role,
        moved: false,
        seq: this.arrivals++
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
      if (!p.moved) {
        const dead = this.options.steerDeadzone * this.shortEdge();
        const travelled = Math.hypot(p.x - p.originX, p.y - p.originY);
        if (travelled > dead) p.moved = true;
      }
      e.preventDefault();
    };

    const release = (e: PointerEvent): void => {
      this.pointers.delete(e.pointerId);
    };

    surface.addEventListener('pointerdown', claim, { passive: false });
    surface.addEventListener('pointermove', move, { passive: false });
    surface.addEventListener('pointerup', release);
    surface.addEventListener('pointercancel', release);
    /* The browser taking the capture away — a system gesture, a context
       menu, the page being backgrounded — really is the end of the
       touch, and unlike `pointerleave` it only fires when it is. */
    surface.addEventListener('lostpointercapture', release);

    this.measure();
  }

  /**
   * Tell the controls how big the screen is.
   *
   * Read from `window` in the browser; injectable so the zone logic can
   * be exercised at phone dimensions in a test without a DOM.
   */
  setViewport(width: number, height: number): void {
    this.view = { width, height };
  }

  /**
   * Where the on-screen buttons are right now.
   *
   * Re-read per touch rather than cached: the buttons move between the
   * portrait column and the landscape row, and the safe-area insets they
   * are positioned against change when the browser chrome retracts.
   * Five `getBoundingClientRect` calls once per finger-down is nothing;
   * a stale rectangle is a dead spot in the middle of the pedals.
   */
  private reserved(): Rect[] {
    return this.options.reserve.length === 0
      ? []
      : reservedRects(this.options.reserve);
  }

  private measure(): void {
    if (typeof window === 'undefined') return;
    this.view = { width: window.innerWidth, height: window.innerHeight };
  }

  private shortEdge(): number {
    const short = Math.min(this.view.width, this.view.height);
    // Before the first layout there is no viewport; a phone's short edge
    // is the least wrong guess and it is corrected on the next frame.
    return short > 0 ? short : 390;
  }

  /** The finger holding a role, or null. Earliest arrival wins. */
  private holder(role: Role): Pointer | null {
    let best: Pointer | null = null;
    for (const p of this.pointers.values()) {
      if (p.role !== role) continue;
      if (best === null || p.seq < best.seq) best = p;
    }
    return best;
  }

  /** Where the steering thumb went down and what it is asking for. */
  steerPad(): PadState | null {
    const p = this.holder('steer');
    if (!p) return null;
    return {
      originX: p.originX,
      originY: p.originY,
      x: p.x,
      y: p.y,
      value: this.steer,
      travel: this.options.steerTravel * this.shortEdge()
    };
  }

  /** The same for the pedals. Positive is throttle, negative is brake. */
  pedalPad(): PadState | null {
    const p = this.holder('pedals');
    if (!p) return null;
    return {
      originX: p.originX,
      originY: p.originY,
      x: p.x,
      y: p.y,
      value: this.throttle > 0 ? this.throttle : -this.brake,
      travel: this.options.steerTravel * this.shortEdge()
    };
  }

  update(dt: number): void {
    this.measure();
    const shortEdge = this.shortEdge();
    const travel = this.options.steerTravel * shortEdge;
    const dead = this.options.steerDeadzone * shortEdge;

    const steering = this.holder('steer');
    const pedals = this.holder('pedals');

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
      /* A thumb resting on the pad without ever having moved still means
         "go" — that is how a player who has not read anything discovers
         the car drives. But once the thumb *has* moved it is driving,
         and a two-millimetre pull towards the bottom of the screen is a
         request for a light brake, not for half throttle. Conflating the
         two is what made the car impossible to trail-brake. */
      if (!pedals.moved && this.throttle === 0 && this.brake === 0) {
        this.throttle = this.options.restingThrottle;
      }
    } else {
      this.throttle = 0;
      this.brake = 0;
    }
  }
}
