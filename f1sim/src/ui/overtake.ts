/**
 * Telling you that you just passed someone.
 *
 * The position readout has always been correct and has never been
 * noticeable: it ticks from 7th to 6th in a corner of the screen while
 * your eyes are on the exit, and the single most satisfying thing that
 * happens in a race goes by unmarked. A car you fought past for half a
 * lap deserves more than a digit changing.
 *
 * So the change itself is the event. A place gained is a green card
 * with the name of whoever you took it from; a place lost is a red one,
 * because losing a position ought to sting slightly and because a
 * driver who does not notice being passed will not defend next time.
 */
import type { Field } from '../race/field';

/** How long a card stays up (ms). */
const LIFETIME = 1600;

export class OvertakeNotice {
  private readonly root: HTMLElement;
  private readonly card: HTMLElement;

  private previous: number | null = null;
  private until = 0;
  private visible = false;

  constructor(mount: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'overtake-notice';
    this.card = document.createElement('div');
    this.card.className = 'card';
    this.root.appendChild(this.card);
    mount.appendChild(this.root);
  }

  /**
   * @param position  the player's place, 1-based
   * @param field     for the name of the car the place changed against
   * @param now       monotonic ms
   * @param live      false while the race has not started or has ended,
   *                  when positions shuffle for reasons that are not
   *                  overtakes and a card would be a lie
   */
  update(position: number, field: Field, now: number, live: boolean): void {
    if (!live) {
      /* Re-arm rather than hold the old value. Coming out of the
         formation phase the whole field is renumbered at once, and
         carrying a position across that boundary would announce nine
         overtakes at the lights. */
      this.previous = null;
      this.hide();
      return;
    }

    const before = this.previous;
    this.previous = position;

    if (before !== null && position !== before) {
      const gained = position < before;
      /* Whoever is now on the other side of you. Ranks are 1-based and
         the array is not, so the car you just passed is sitting at the
         index of your new position. */
      const index = gained ? position - 1 : position - 2;
      const rival = field.rivals[Math.max(0, Math.min(field.rivals.length - 1, index))];

      this.card.className = `card ${gained ? 'gain' : 'loss'}`;
      this.card.innerHTML =
        `<span class="mark">${gained ? '▲' : '▼'}</span>` +
        `<span class="what">${gained ? 'OVERTAKE' : 'PASSED'}</span>` +
        `<span class="who">${rival ? rival.name : '—'}</span>` +
        `<span class="pos">P${position}</span>`;
      this.until = now + LIFETIME;
      this.root.classList.add('on');
      this.visible = true;
      return;
    }

    if (this.visible && now >= this.until) this.hide();
  }

  private hide(): void {
    if (!this.visible) return;
    this.visible = false;
    this.root.classList.remove('on');
  }
}
