/**
 * The one control a game with sound has to have.
 *
 * Not in the settings drawer: someone who needs the sound off usually
 * needs it off *now* — a room with other people in it, a lesson about to
 * start — and a mute that takes two taps and a menu is one people solve
 * by closing the tab instead. It sits with the other corner buttons and
 * says which state it is in rather than which state it would move to,
 * because a speaker icon with a line through it is ambiguous about both.
 */
import type { CarAudio } from '../audio/sound';

export class MuteButton {
  private readonly button: HTMLButtonElement;

  constructor(private readonly audio: CarAudio) {
    this.button = document.createElement('button');
    this.button.type = 'button';
    this.button.className = 'mute-toggle';
    document.body.appendChild(this.button);

    this.button.addEventListener('click', () => {
      this.audio.toggle();
      this.paint();
    });

    /* M, next to nothing else. Every other single key in this game is
       already a control, and a shortcut for the sound is worth one. */
    window.addEventListener('keydown', (e) => {
      if (e.code !== 'KeyM' || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      this.audio.toggle();
      this.paint();
    });

    this.paint();
  }

  private paint(): void {
    const muted = this.audio.isMuted;
    this.button.textContent = muted ? '소리 켜기' : '소리 끄기';
    this.button.classList.toggle('off', muted);
    this.button.setAttribute('aria-pressed', muted ? 'true' : 'false');
  }
}
