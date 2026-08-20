/**
 * The touch controls, driven by synthetic fingers.
 *
 * `TouchControls` needs an element to listen on and a viewport to
 * measure against, and node has neither — so the element is a dozen
 * lines of fake below and the viewport is injected. What is being tested
 * is the whole of the touch behaviour a phone player experiences, and
 * every case here is one that was wrong.
 */
import { describe, expect, it } from 'vitest';

import { TouchControls } from '../src/input/touch';
import type { TouchOptions } from '../src/input/touch';

const DT = 1 / 120;
const LANDSCAPE = { width: 844, height: 390 };

/**
 * The smallest thing `TouchControls` will attach to, plus a way to make
 * it emit. Deliberately not a DOM shim: only four listeners are ever
 * registered and dispatch order does not matter to any of them.
 */
class Surface {
  private readonly handlers = new Map<string, ((e: PointerEvent) => void)[]>();
  captured: number[] = [];

  addEventListener(type: string, fn: (e: PointerEvent) => void): void {
    const list = this.handlers.get(type) ?? [];
    list.push(fn);
    this.handlers.set(type, list);
  }

  setPointerCapture(id: number): void {
    this.captured.push(id);
  }

  emit(type: string, e: Partial<PointerEvent> & { pointerId: number }): void {
    const event = {
      pointerType: 'touch',
      clientX: 0,
      clientY: 0,
      preventDefault: () => {},
      ...e
    } as PointerEvent;
    for (const fn of this.handlers.get(type) ?? []) fn(event);
  }
}

interface Rig {
  touch: TouchControls;
  surface: Surface;
  down: (id: number, x: number, y: number) => void;
  moveTo: (id: number, x: number, y: number) => void;
  up: (id: number) => void;
  /** Advance the controls by one simulation tick. */
  tick: (n?: number) => void;
}

const rig = (options: Partial<TouchOptions> = {}): Rig => {
  const surface = new Surface();
  const touch = new TouchControls(surface as unknown as HTMLElement, options);
  touch.setViewport(LANDSCAPE.width, LANDSCAPE.height);
  return {
    touch,
    surface,
    down: (pointerId, clientX, clientY) =>
      surface.emit('pointerdown', { pointerId, clientX, clientY }),
    moveTo: (pointerId, clientX, clientY) =>
      surface.emit('pointermove', { pointerId, clientX, clientY }),
    up: (pointerId) => surface.emit('pointerup', { pointerId }),
    tick: (n = 1) => {
      for (let i = 0; i < n; i++) touch.update(DT);
    }
  };
};

describe('steering', () => {
  it('takes centre from wherever the thumb went down', () => {
    /* The whole premise of the control: a phone is held differently
       every time, so a fixed centre means fighting it. Two thumbs, two
       very different landing points, one identical request. */
    const a = rig();
    a.down(1, 120, 300);
    a.moveTo(1, 180, 300);
    a.tick();

    const b = rig();
    b.down(1, 300, 90);
    b.moveTo(1, 360, 90);
    b.tick();

    expect(a.touch.steer).toBeCloseTo(b.touch.steer, 10);
    expect(a.touch.steer).toBeGreaterThan(0);
  });

  it('reaches full lock at the end of its travel and stops there', () => {
    const r = rig();
    r.down(1, 200, 300);
    r.moveTo(1, 200 + 400, 300);
    r.tick();
    expect(r.touch.steer).toBe(1);

    r.moveTo(1, 200 - 400, 300);
    r.tick();
    expect(r.touch.steer).toBe(-1);
  });

  it('keeps steering when the drag crosses into the pedals half', () => {
    // Splitting by where the finger landed rather than where it is: a
    // hard right from the left thumb crosses the middle of the screen.
    const r = rig();
    r.down(1, 400, 300);
    r.moveTo(1, 500, 300);
    r.tick();
    expect(r.touch.steer).toBeGreaterThan(0);
    expect(r.touch.throttle).toBe(0);
  });

  it('springs back rather than snapping when the thumb lifts', () => {
    const r = rig();
    r.down(1, 200, 300);
    r.moveTo(1, 260, 300);
    r.tick();
    const held = r.touch.steer;
    expect(held).toBeGreaterThan(0);

    r.up(1);
    r.tick();
    // Some of the way back, not all of it: lifting a thumb mid-corner
    // must not throw the car.
    expect(r.touch.steer).toBeLessThan(held);
    expect(r.touch.steer).toBeGreaterThan(0);

    r.tick(200);
    expect(r.touch.steer).toBe(0);
  });

  it('survives the thumb reaching the edge of the screen', () => {
    /* `pointerleave` used to be treated as a release. A steering thumb
       reaches the bottom edge in any long corner, the pointer leaves the
       canvas, and the car straightened mid-apex while the player's thumb
       had not moved. */
    const r = rig();
    r.down(1, 200, 380);
    r.moveTo(1, 280, 389);
    r.tick();
    const steering = r.touch.steer;
    expect(steering).toBeGreaterThan(0);

    r.surface.emit('pointerleave', { pointerId: 1 });
    r.tick();
    expect(r.touch.steer).toBeCloseTo(steering, 10);
  });

  it('does end the touch when the browser takes the capture away', () => {
    // The other half of the same claim: a real loss of the pointer — a
    // system gesture, the page being backgrounded — is a release.
    const r = rig();
    r.down(1, 200, 300);
    r.moveTo(1, 280, 300);
    r.tick();
    expect(r.touch.steer).toBeGreaterThan(0);

    r.surface.emit('lostpointercapture', { pointerId: 1 });
    r.tick(200);
    expect(r.touch.steer).toBe(0);
  });
});

describe('the pedals', () => {
  it('is analogue by travel in both directions', () => {
    const r = rig();
    r.down(1, 600, 200);

    r.moveTo(1, 600, 200 - 20);
    r.tick();
    const light = r.touch.throttle;

    r.moveTo(1, 600, 200 - 60);
    r.tick();
    expect(r.touch.throttle).toBeGreaterThan(light);
    expect(r.touch.brake).toBe(0);

    r.moveTo(1, 600, 200 + 60);
    r.tick();
    expect(r.touch.brake).toBeGreaterThan(0);
    expect(r.touch.throttle).toBe(0);
  });

  it('reads a thumb that is down but has not moved as go', () => {
    // How a player who has read nothing discovers the car drives.
    const r = rig();
    r.down(1, 600, 200);
    r.tick();
    expect(r.touch.throttle).toBeCloseTo(0.45, 5);
  });

  it('lets a small pull be a small brake once the thumb has moved', () => {
    /* The bug: the resting-throttle rule fired on *any* input inside the
       dead zone, so a two-millimetre pull towards the bottom of the
       screen — a light trail-brake — came out as 45% throttle. */
    const r = rig();
    r.down(1, 600, 200);
    r.moveTo(1, 600, 260);
    r.tick();
    expect(r.touch.brake).toBeGreaterThan(0);

    // Back almost to the origin: a very light brake, not acceleration.
    r.moveTo(1, 600, 203);
    r.tick();
    expect(r.touch.throttle).toBe(0);
  });

  it('gives nothing at all when the thumb lifts', () => {
    const r = rig();
    r.down(1, 600, 200);
    r.moveTo(1, 600, 120);
    r.tick();
    expect(r.touch.throttle).toBeGreaterThan(0);

    r.up(1);
    r.tick();
    expect(r.touch.throttle).toBe(0);
    expect(r.touch.brake).toBe(0);
  });
});

describe('two thumbs, and everything else on the glass', () => {
  it('drives both controls at once', () => {
    const r = rig();
    r.down(1, 200, 300);
    r.down(2, 600, 200);
    r.moveTo(1, 260, 300);
    r.moveTo(2, 600, 140);
    r.tick();
    expect(r.touch.steer).toBeGreaterThan(0);
    expect(r.touch.throttle).toBeGreaterThan(0);
  });

  it('lets the first finger keep its control', () => {
    /* Roles used to be resolved by iterating the pointer map, so a
       second finger landing in the same half took over — and so did a
       palm resting on the glass, which is how a phone is actually
       held. */
    const r = rig();
    r.down(1, 200, 300);
    r.moveTo(1, 280, 300);
    r.tick();
    const steering = r.touch.steer;

    r.down(2, 100, 100); // a palm, in the same half
    r.tick();
    expect(r.touch.steer).toBeCloseTo(steering, 10);

    // And when the thumb lifts, the other finger inherits rather than
    // the control going dead.
    r.up(1);
    r.moveTo(2, 180, 100);
    r.tick();
    expect(r.touch.steer).toBeGreaterThan(0);
  });

  it('ignores a finger that lands on a button', () => {
    const buttons = {
      getBoundingClientRect: () =>
        ({ left: 638, top: 280, right: 834, bottom: 380, width: 196, height: 100 }) as DOMRect
    } as unknown as Element;

    const r = rig({ reserve: [buttons] });
    r.down(1, 700, 330);
    r.tick();
    expect(r.touch.holding).toBe(false);
    expect(r.touch.throttle).toBe(0);

    // Clear of them, the same thumb drives.
    r.down(2, 560, 330);
    r.tick();
    expect(r.touch.holding).toBe(true);
    expect(r.touch.throttle).toBeCloseTo(0.45, 5);
  });

  it('ignores a mouse, so a desktop is never in touch mode', () => {
    const r = rig();
    r.surface.emit('pointerdown', {
      pointerId: 1,
      clientX: 200,
      clientY: 300,
      pointerType: 'mouse'
    });
    r.tick();
    expect(r.touch.active).toBe(false);
    expect(r.touch.holding).toBe(false);
  });
});

describe('what the pads draw', () => {
  it('reports nothing while nothing is held', () => {
    const r = rig();
    r.tick();
    expect(r.touch.steerPad()).toBeNull();
    expect(r.touch.pedalPad()).toBeNull();
  });

  it('reports the origin, the thumb and the request', () => {
    const r = rig();
    r.down(1, 200, 300);
    r.moveTo(1, 250, 300);
    r.tick();

    const pad = r.touch.steerPad();
    expect(pad).not.toBeNull();
    expect(pad?.originX).toBe(200);
    expect(pad?.x).toBe(250);
    expect(pad?.value).toBe(r.touch.steer);
    // The pad is drawn at the travel that reaches full lock, so its ends
    // mean something rather than being a chosen radius.
    expect(pad?.travel).toBeCloseTo(0.2 * 390, 5);
  });

  it('signs the pedal pad so the brake can be drawn red', () => {
    const r = rig();
    r.down(1, 600, 200);
    r.moveTo(1, 600, 260);
    r.tick();
    expect(r.touch.pedalPad()?.value).toBeLessThan(0);

    r.moveTo(1, 600, 140);
    r.tick();
    expect(r.touch.pedalPad()?.value).toBeGreaterThan(0);
  });
});
