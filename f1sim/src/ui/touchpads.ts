/**
 * Show the player what their thumbs are asking for.
 *
 * The touch layer has reported where each thumb landed since it was
 * written — `steerOrigin()` and `pedalOrigin()` were in the first
 * version of `input/touch.ts` — and nothing ever called either of them.
 * So a phone player had a relative steering pad with no centre drawn, an
 * analogue throttle with no travel drawn, and no way to tell "I am at
 * 30% lock" from "the car is not answering". On a control scheme whose
 * whole premise is that centre is wherever you put your thumb, that is
 * not a missing polish pass: the reference point exists only in the
 * player's memory of where they touched a moment ago.
 *
 * Those two methods are now `steerPad()` and `pedalPad()`, which return
 * the request alongside the origin, because a pad has to draw both.
 *
 * Drawn on a 2D canvas rather than in the DOM. Two thumbs at 60 Hz is
 * two elements' worth of transform writes a frame, which the DOM would
 * survive — but each pad is a track, a centre mark, a fill and a knob,
 * and those are four elements each in CSS against four calls here.
 *
 * It never draws when nothing is being touched, so a desktop player and
 * a phone player between corners both get a clean screen.
 */
import type { PadState } from '../input/touch';

/** House style: black line, flat fill, no gradients. */
const INK = '#000';
const PAPER = 'rgba(255, 255, 255, 0.82)';
const GO = '#12d16b';
const STOP = '#e2000f';

export class TouchPads {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private width = 0;
  private height = 0;
  private ratio = 1;
  /** True while the last frame drew something, so clears are not paid twice. */
  private dirty = false;

  constructor(mount: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'touch-pads';
    mount.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  /**
   * Match the backing store to the viewport.
   *
   * Public for the same reason the renderer's is: a phone reports the
   * wrong size for a fifth of a second after a rotation, so `ui/screen.ts`
   * re-measures over the following half second and calls this each time.
   */
  resize(): void {
    /* Capped at 2 for the same reason the 3D renderer caps: a pad is
       three strokes and an arc, and the third device pixel buys nothing
       on any of them. */
    this.ratio = Math.min(typeof devicePixelRatio === 'number' ? devicePixelRatio : 1, 2);
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.canvas.width = Math.round(this.width * this.ratio);
    this.canvas.height = Math.round(this.height * this.ratio);
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;
  }

  /**
   * Draw both pads. Either may be null, which is a thumb that is not
   * down and therefore a pad that should not be on screen.
   */
  update(steer: PadState | null, pedals: PadState | null): void {
    const ctx = this.ctx;
    if (!ctx) return;

    if (!steer && !pedals) {
      if (this.dirty) {
        ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.dirty = false;
      }
      return;
    }

    ctx.setTransform(this.ratio, 0, 0, this.ratio, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);
    this.dirty = true;

    if (steer) this.drawSteer(ctx, steer);
    if (pedals) this.drawPedals(ctx, pedals);
  }

  /**
   * A horizontal track through the landing point with a knob on it.
   *
   * The track is the *whole* of the travel — its ends are full lock —
   * so how much lock is left is a distance the player can see rather
   * than a number they have to have learnt. Steering is one axis, so the
   * pad is one axis: a circular stick would invite vertical drags that
   * do nothing.
   */
  private drawSteer(ctx: CanvasRenderingContext2D, pad: PadState): void {
    const r = pad.travel;
    const y = pad.originY;
    // Kept on screen: a thumb landing 30 px from the bottom would
    // otherwise draw most of its pad into the bezel.
    const cx = clamp(pad.originX, r + 12, this.width - r - 12);
    const cy = clamp(y, 34, this.height - 34);

    ctx.lineCap = 'round';

    // The travel available.
    ctx.beginPath();
    ctx.moveTo(cx - r, cy);
    ctx.lineTo(cx + r, cy);
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.lineWidth = 16;
    ctx.stroke();
    ctx.strokeStyle = PAPER;
    ctx.lineWidth = 10;
    ctx.stroke();

    // Centre, so "straight" is a mark rather than a memory.
    ctx.beginPath();
    ctx.moveTo(cx, cy - 11);
    ctx.lineTo(cx, cy + 11);
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // How far from it the request currently is.
    const knobX = cx + pad.value * r;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(knobX, cy);
    ctx.strokeStyle = INK;
    ctx.lineWidth = 10;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(knobX, cy, 19, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  /**
   * A vertical track, green above the landing point and red below it.
   *
   * Colour rather than a label because it has to be readable in
   * peripheral vision — the player is looking at a corner, not at their
   * thumb — and because the two halves genuinely are different pedals.
   */
  private drawPedals(ctx: CanvasRenderingContext2D, pad: PadState): void {
    const r = pad.travel;
    const cx = clamp(pad.originX, 34, this.width - 34);
    const cy = clamp(pad.originY, r + 12, this.height - r - 12);

    ctx.lineCap = 'round';

    ctx.beginPath();
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx, cy + r);
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.lineWidth = 16;
    ctx.stroke();
    ctx.strokeStyle = PAPER;
    ctx.lineWidth = 10;
    ctx.stroke();

    // Where the thumb went down: the pedal is neither on nor off here.
    ctx.beginPath();
    ctx.moveTo(cx - 11, cy);
    ctx.lineTo(cx + 11, cy);
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.5;
    ctx.stroke();

    const knobY = cy - pad.value * r;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx, knobY);
    ctx.strokeStyle = pad.value >= 0 ? GO : STOP;
    ctx.lineWidth = 10;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(cx, knobY, 19, 0, Math.PI * 2);
    ctx.fillStyle = pad.value >= 0 ? GO : STOP;
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 3;
    ctx.stroke();
  }
}

const clamp = (v: number, lo: number, hi: number): number =>
  // A viewport can be smaller than the margins ask for, and then the
  // bounds cross. Centre is the only answer that is not off screen.
  lo > hi ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, v));
