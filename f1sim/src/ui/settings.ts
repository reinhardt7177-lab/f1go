/**
 * The settings drawer, and what is left after the instruments went.
 *
 * This file replaces `hudmode.ts`, and the replacement is a narrowing
 * rather than a rename. That button was labelled 계기판 — *instrument
 * panel* — and it toggled two quite different kinds of thing at once:
 * the readouts (a telemetry panel, a live setup summary, four tyre
 * gauges, a g-g plot) and the controls (traction control, the AI
 * driver, steering sensitivity and response curve).
 *
 * The readouts are gone. They were written for the person tuning the
 * car, they were never legible on a phone, and the two of them together
 * rewrote some sixty elements a frame for a view almost nobody opened.
 * What the driver actually reads while driving — speed, gear, lap,
 * position, tyre smoke when a tyre lets go — was never in them; it is in
 * `ui/hud.ts`, `ui/timing.ts` and the road.
 *
 * The controls stay, because deleting a readout costs you information
 * you can get another way and deleting a control costs you the ability
 * to change the car. Steering sensitivity in particular is the setting a
 * phone player most needs, since a thumb on glass is the input it exists
 * to compensate for.
 *
 * So: one button, and it now says what it opens.
 */

/* Deliberately not the old `f1go-hud-bench` key. Someone who left the
   instrument panel open is not thereby asking for the settings drawer to
   be open every time they load the game, and inheriting that flag would
   greet them with a panel over the road on a screen where the panel they
   actually chose no longer exists. Everyone starts closed. */
const KEY = 'f1go-settings-open';

export class SettingsPanel {
  private open: boolean;
  private readonly button: HTMLButtonElement;

  constructor(mount: HTMLElement) {
    this.open = this.load();

    this.button = document.createElement('button');
    this.button.type = 'button';
    this.button.className = 'settings-toggle';
    this.button.title = '조향 감도, 트랙션 컨트롤, AI 주행';
    mount.appendChild(this.button);

    /* Both events, because the title card behind this listens for
       `click` — stopping only the pointerdown still lets the card
       swallow the tap and start the session under the finger. The
       circuit picker and the easy-mode button needed the same pair. */
    this.button.addEventListener('click', (e) => e.stopPropagation());
    this.button.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.set(!this.open);
    });

    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyT') this.set(!this.open);
    });

    this.apply();
  }

  /** True while the settings panels are on screen. */
  get showing(): boolean {
    return this.open;
  }

  private set(open: boolean): void {
    this.open = open;
    try {
      localStorage.setItem(KEY, open ? '1' : '0');
    } catch {
      /* Private browsing, or a user who has turned it off. The choice
         still applies to this session; it just will not be remembered. */
    }
    this.apply();
  }

  private load(): boolean {
    try {
      // Closed unless asked otherwise. A first-time player must not have
      // to find and dismiss a settings drawer before they can play.
      return localStorage.getItem(KEY) === '1';
    } catch {
      return false;
    }
  }

  private apply(): void {
    document.body.classList.toggle('settings', this.open);
    this.button.classList.toggle('on', this.open);
    this.button.textContent = this.open ? '설정 닫기' : '설정';
  }
}
