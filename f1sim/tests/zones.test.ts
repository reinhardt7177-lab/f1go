/**
 * The touch zones, checked at phone dimensions.
 *
 * Every one of these is a bug that was found by holding a phone and is
 * checked here so it cannot come back. The dimensions are real: 844×390
 * is an iPhone 14 in landscape, which is the orientation the game asks
 * to be held in and the one every width-based media query in the
 * stylesheet used to miss.
 */
import { describe, expect, it } from 'vitest';

import { defaultZoneOptions, reservedRects, roleAt } from '../src/input/zones';
import type { Rect } from '../src/input/zones';

/** An iPhone 14 held sideways. */
const LANDSCAPE = { width: 844, height: 390 };
/** The same phone held upright. */
const PORTRAIT = { width: 390, height: 844 };

/** Roughly where the button block sits in the landscape layout. */
const buttons: Rect = { left: 638, top: 280, right: 834, bottom: 380 };

describe('which control a finger claims', () => {
  it('gives the left half to steering and the right half to the pedals', () => {
    expect(roleAt(200, 200, LANDSCAPE)).toBe('steer');
    expect(roleAt(600, 200, LANDSCAPE)).toBe('pedals');
  });

  it('splits by where the finger landed, at any height', () => {
    // A steering drag that wanders is handled in `touch.ts` by never
    // re-asking; this is the other half of that claim — the split does
    // not depend on how far up the screen the thumb is.
    for (const y of [20, 100, 195, 300, 370]) {
      expect(roleAt(150, y, LANDSCAPE)).toBe('steer');
      expect(roleAt(500, y, LANDSCAPE)).toBe('pedals');
    }
  });

  it('leaves the system gesture strips alone', () => {
    /* Both platforms treat a drag from the very edge as navigation. A
       steering thumb rests within millimetres of the bezel, so without
       this the first hard left of the session navigates back. */
    expect(roleAt(4, 200, LANDSCAPE)).toBeNull();
    expect(roleAt(840, 200, LANDSCAPE)).toBeNull();
    // And just inside it is ordinary.
    expect(roleAt(30, 200, LANDSCAPE)).toBe('steer');
    expect(roleAt(814, 200, LANDSCAPE)).toBe('pedals');
  });

  it('reserves the on-screen buttons out of the pedals', () => {
    // The bug: reaching for full throttle in the bottom-right corner and
    // landing on RESET.
    expect(roleAt(700, 330, LANDSCAPE, defaultZoneOptions(), [buttons])).toBeNull();
    // Directly above them is still pedals — the buttons are a corner,
    // not a column, and taking the whole right edge would leave a thumb
    // nowhere to land.
    expect(roleAt(700, 150, LANDSCAPE, defaultZoneOptions(), [buttons])).toBe('pedals');
  });

  it('reserves a margin around them, because a near miss was an aim', () => {
    const o = defaultZoneOptions();
    // Six pixels short of the button block: aimed at a button, missed.
    expect(roleAt(632, 330, LANDSCAPE, o, [buttons])).toBeNull();
    // Half a fingertip further out, it was aimed at the pedals.
    expect(roleAt(600, 330, LANDSCAPE, o, [buttons])).toBe('pedals');
  });

  it('never reserves anything on the steering side', () => {
    /* The reserved list is measured from live elements, and an element
       that has been laid out on the left — or has not been laid out at
       all — must not silently cut a hole in the steering pad. */
    const stray: Rect = { left: 0, top: 0, right: 120, bottom: 60 };
    expect(roleAt(60, 30, LANDSCAPE, defaultZoneOptions(), [stray])).toBeNull();
    expect(roleAt(200, 200, LANDSCAPE, defaultZoneOptions(), [stray])).toBe('steer');
  });

  it('works upright as well as sideways', () => {
    expect(roleAt(80, 600, PORTRAIT)).toBe('steer');
    expect(roleAt(300, 600, PORTRAIT)).toBe('pedals');
  });

  it('claims nothing before the first layout', () => {
    // A zero viewport means the page has not been measured yet, and
    // dividing it in half would put every zone boundary at x = 0.
    expect(roleAt(10, 10, { width: 0, height: 0 })).toBeNull();
  });

  it('leaves most of the screen usable', () => {
    /* The guard against the dead zones growing. Sampled on a grid,
       because the failure this catches is not one wrong point — it is a
       reserve rectangle quietly swallowing a third of the pedals. */
    const o = defaultZoneOptions();
    let steer = 0;
    let pedals = 0;
    let dead = 0;
    for (let x = 0; x < LANDSCAPE.width; x += 4) {
      for (let y = 0; y < LANDSCAPE.height; y += 4) {
        const role = roleAt(x, y, LANDSCAPE, o, [buttons]);
        if (role === 'steer') steer++;
        else if (role === 'pedals') pedals++;
        else dead++;
      }
    }
    const total = steer + pedals + dead;
    expect(steer / total).toBeGreaterThan(0.45);
    expect(pedals / total).toBeGreaterThan(0.35);
    expect(dead / total).toBeLessThan(0.15);
  });
});

describe('measuring the reserved elements', () => {
  const fake = (r: Partial<DOMRect>): Element =>
    ({ getBoundingClientRect: () => r as DOMRect }) as unknown as Element;

  it('reads a rectangle off each element', () => {
    const rects = reservedRects([
      fake({ left: 10, top: 20, right: 110, bottom: 70, width: 100, height: 50 })
    ]);
    expect(rects).toEqual([{ left: 10, top: 20, right: 110, bottom: 70 }]);
  });

  it('skips elements that are not on screen', () => {
    /* `display: none` gives an all-zero rectangle. Reserving it would
       put a dead spot in the top-left corner — which on a phone in
       landscape is the timing tower, and in portrait is nothing at all,
       so it would have been found late. */
    const rects = reservedRects([
      fake({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }),
      fake({ left: 5, top: 5, right: 15, bottom: 15, width: 10, height: 10 })
    ]);
    expect(rects).toHaveLength(1);
    expect(rects[0]?.left).toBe(5);
  });
});
