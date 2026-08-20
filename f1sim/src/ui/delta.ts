/**
 * Up or down on the ghost, right now.
 *
 * A time trial asks one question and this answers it. The number is the
 * difference between the player's lap clock and the time the ghost took
 * to reach the *same point on the circuit* — not the same instant. That
 * distinction is the whole of why `race/ghost.ts` stores a distance
 * alongside each position: two cars at the same moment are in different
 * places, and comparing them there says nothing.
 *
 * Green is ahead, red is behind, and the sign is written out because a
 * bare number is ambiguous at speed — `−0.31` read quickly is easy to
 * take for a loss. It sits under the lap clock rather than beside the
 * speedometer: a delta is something you glance at on a straight, not
 * something you steer by.
 */
import { clamp } from '../core/math';

/** Seconds either way that fills the bar. Past this the bar is pinned. */
const FULL_SCALE = 2;

export class DeltaPanel {
  private readonly root: HTMLElement;
  private readonly value: HTMLElement;
  private readonly fill: HTMLElement;
  /** Last value written, so a frame that changes nothing writes nothing. */
  private shown: number | null | undefined = undefined;

  constructor(mount: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'delta hidden';
    this.root.innerHTML =
      '<span class="lbl">고스트 대비</span>' +
      '<b class="v">--.---</b>' +
      '<div class="bar"><i></i></div>';
    mount.appendChild(this.root);
    this.value = this.root.querySelector('.v')!;
    this.fill = this.root.querySelector('.bar i')!;
  }

  /**
   * @param delta seconds behind the ghost; negative is ahead. Null when
   *              there is no comparison to make — no ghost stored, or
   *              the player is somewhere the ghost never reached.
   */
  update(delta: number | null): void {
    if (delta === this.shown) return;
    this.shown = delta;

    if (delta === null) {
      this.root.classList.add('hidden');
      return;
    }
    this.root.classList.remove('hidden');

    const ahead = delta < 0;
    this.value.textContent = `${ahead ? '−' : '+'}${Math.abs(delta).toFixed(3)}`;
    this.root.classList.toggle('ahead', ahead);
    this.root.classList.toggle('behind', !ahead);

    /* The bar grows from the middle, so which side it is on carries the
       sign a second time — readable in peripheral vision, which the
       digits are not. */
    const scaled = clamp(Math.abs(delta) / FULL_SCALE, 0, 1);
    this.fill.style.width = `${(scaled * 50).toFixed(1)}%`;
    this.fill.style.left = ahead ? `${(50 - scaled * 50).toFixed(1)}%` : '50%';
  }

  /** Hide it outright, for a session that is not a time trial. */
  disable(): void {
    this.update(null);
    this.root.classList.add('hidden');
  }
}
