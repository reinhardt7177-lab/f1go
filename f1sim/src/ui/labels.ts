/**
 * Name tags over the rivals.
 *
 * A car you have just passed is behind you, and a car you are about to
 * pass is a shape in the distance. Neither is much use as a landmark,
 * which makes an overtake oddly hard to notice: the position readout
 * ticks from 7th to 6th and you never learn who that was.
 *
 * The tag fixes the smaller half of that — it names the car while you
 * are alongside it, so the field becomes nine drivers rather than nine
 * obstacles. It carries the livery colour as well as the name, because
 * the colour is what you will recognise it by next lap.
 *
 * DOM rather than sprites in the scene: text stays crisp at any
 * distance, it never has to fight the fog, and the layout is CSS.
 */
import type { Vec3 } from '../core/math';
import type { Rival } from '../race/field';

/** Where a world point landed, in CSS pixels from the canvas corner. */
export interface ScreenPoint {
  x: number;
  y: number;
  /** Metres from the eye. */
  distance: number;
}

/** Beyond this a tag is smaller than the car and just clutters the road. */
const MAX_DISTANCE = 240;

/** Height above the road the tag floats at (m). */
const LIFT = 1.5;

export class RivalLabels {
  private readonly root: HTMLElement;
  private readonly tags: HTMLElement[] = [];

  constructor(mount: HTMLElement, rivals: readonly Rival[]) {
    this.root = document.createElement('div');
    this.root.className = 'rival-tags';
    mount.appendChild(this.root);

    for (const rival of rivals) {
      const tag = document.createElement('div');
      tag.className = 'rival-tag';
      tag.innerHTML = `<i></i><b></b>`;
      tag.querySelector('i')!.style.background = rival.colour;
      tag.querySelector('b')!.textContent = rival.name;
      tag.style.opacity = '0';
      this.root.appendChild(tag);
      this.tags.push(tag);
    }
  }

  /**
   * @param project  world point to screen, or null when behind the eye
   */
  update(
    rivals: readonly Rival[],
    project: (point: Vec3) => ScreenPoint | null
  ): void {
    for (let i = 0; i < this.tags.length; i++) {
      const tag = this.tags[i]!;
      const rival = rivals[i];
      if (!rival) continue;

      const screen = project({
        x: rival.position.x,
        y: rival.position.y + LIFT,
        z: rival.position.z
      });

      if (!screen || screen.distance > MAX_DISTANCE) {
        // Left in place rather than removed: a tag that is hidden this
        // frame is almost certainly wanted again next frame.
        if (tag.style.opacity !== '0') tag.style.opacity = '0';
        continue;
      }

      /* Fade the last fifty metres rather than switching off, so a car
         cresting a rise does not make its tag blink. */
      const fade = Math.min(1, (MAX_DISTANCE - screen.distance) / 50);
      tag.style.opacity = fade.toFixed(2);
      tag.style.transform = `translate3d(${screen.x.toFixed(1)}px, ${screen.y.toFixed(1)}px, 0) translate(-50%, -100%)`;
    }
  }
}
