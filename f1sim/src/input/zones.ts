/**
 * Which control a finger claimed, decided as geometry.
 *
 * Split out of `touch.ts` because it is the part that was wrong and the
 * part that can be tested. The original rule was one line — left half
 * steers, right half is the pedals — and it had two failures that only
 * show up on a real phone held in two hands.
 *
 * The first is the buttons. AERO, BOOST, PIT, RESET and the camera sit
 * in the bottom-right corner, which is exactly where the right thumb
 * goes down for throttle. They are separate elements, so they do get the
 * tap they were aimed at — but a thumb reaching for full throttle and
 * landing 8 px inside one selects the pit lane instead, and there is no
 * visible boundary to blame. The pedals therefore stop at the buttons,
 * and the strip they occupy is claimed by neither control.
 *
 * That strip is **measured, not declared**. Writing the button footprint
 * here as a constant means two descriptions of one rectangle — the
 * stylesheet's and this one — which agree until somebody moves a button,
 * and then disagree silently for however long it takes a player to
 * notice. `reservedRects` comes from `getBoundingClientRect` on the real
 * elements, so the dead zone follows the buttons wherever CSS puts them,
 * including through the portrait-to-landscape reflow that moves them
 * from a column to a row.
 *
 * The second failure is the screen edge. A phone's left thumb naturally
 * rests within a few millimetres of the bezel, and both iOS and Android
 * read a drag starting there as a system back-gesture. A dead margin at
 * the very edge costs a few pixels of a zone that is already 400 px wide
 * and buys a steering input that does not navigate away mid-corner.
 */

export type Role = 'steer' | 'pedals';

export interface Viewport {
  width: number;
  height: number;
}

/** A screen-space rectangle, in the shape `getBoundingClientRect` gives. */
export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface ZoneOptions {
  /**
   * Fraction of the width given to steering. The rest is pedals, minus
   * whatever the on-screen buttons have reserved.
   */
  split: number;
  /** Dead margin at the left and right edges, in CSS pixels. */
  edgeMargin: number;
  /** How far past a reserved element the dead zone extends, in pixels. */
  reserveMargin: number;
}

export const defaultZoneOptions = (): ZoneOptions => ({
  split: 0.5,
  /* Enough to clear the system gesture strip on both platforms without
     being noticeable: iOS reserves about 16 px for the back swipe, and
     Android's gesture navigation about 20 dp. */
  edgeMargin: 22,
  /* Half a fingertip. A touch this close to a button was aimed at the
     button and missed, not aimed at the pedals. */
  reserveMargin: 12
});

const inside = (x: number, y: number, r: Rect, margin: number): boolean =>
  x >= r.left - margin &&
  x <= r.right + margin &&
  y >= r.top - margin &&
  y <= r.bottom + margin;

/**
 * Which role a touch at (x, y) claims, or null for a reserved strip.
 *
 * Deliberately takes plain numbers rather than a PointerEvent: this is
 * the whole of the decision, so it can be checked at a hundred points
 * across a phone-sized rectangle in a test rather than by holding one.
 */
export const roleAt = (
  x: number,
  y: number,
  view: Viewport,
  o: ZoneOptions = defaultZoneOptions(),
  reserved: readonly Rect[] = []
): Role | null => {
  if (view.width <= 0 || view.height <= 0) return null;

  // The system gesture strips, on both sides.
  if (x < o.edgeMargin || x > view.width - o.edgeMargin) return null;

  /* The controls that are already elements. Reserved rather than
     assigned, so a thumb that lands on one does nothing here — the
     element itself still gets its own event. */
  for (const r of reserved) {
    if (inside(x, y, r, o.reserveMargin)) return null;
  }

  return x < view.width * o.split ? 'steer' : 'pedals';
};

/** Read rectangles off live elements, skipping any that are not shown. */
export const reservedRects = (elements: readonly Element[]): Rect[] => {
  const out: Rect[] = [];
  for (const el of elements) {
    const r = el.getBoundingClientRect();
    // A hidden element has no area, and reserving a zero-size rectangle
    // at the origin would put a dead spot in the top-left corner.
    if (r.width <= 0 || r.height <= 0) continue;
    out.push({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });
  }
  return out;
};
