/**
 * Two cars, one simulation.
 *
 * The physics here is real, and a real Formula 1 car is close to
 * undriveable for someone who has never driven anything. At 100 km/h
 * the grip-limited corner needs five degrees of steering and the arrow
 * key asks for fourteen; past the peak the tyre gives *less* grip the
 * harder you push, so the car stops answering the wheel and then spins.
 * That is the model being right, and it is also a ten-year-old putting
 * the controller down.
 *
 * So easy mode holds the front axle at its peak instead of past it,
 * catches a slide before it becomes a spin, and gives the tyres a
 * quarter more grip to do it with. None of that touches the tyre model
 * — `sim/assists.ts` shapes the controls on their way in, and the two
 * dials that cannot be done that way are fields on the vehicle whose
 * defaults are exactly one and exactly zero.
 *
 * Which means the simulator is always ten seconds away: press the
 * button and the old car is back, spin and all.
 */

const KEY = 'f1go-easy';

export class EasyMode {
  private on: boolean;
  private readonly button: HTMLButtonElement;

  constructor(
    mount: HTMLElement,
    private readonly onChange: (on: boolean) => void
  ) {
    this.on = this.load();

    this.button = document.createElement('button');
    this.button.type = 'button';
    this.button.className = 'easy-mode';
    this.button.title = '조향과 그립을 도와 처음이라도 몰 수 있게 합니다';
    mount.appendChild(this.button);

    /* Both events, because the title card behind this listens for
       `click` — stopping only the pointerdown still lets the card
       swallow the tap and start the session under the finger. The
       circuit picker needed exactly the same pair. */
    this.button.addEventListener('click', (e) => e.stopPropagation());
    this.button.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.set(!this.on);
    });

    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyG') this.set(!this.on);
    });

    this.apply();
  }

  get enabled(): boolean {
    return this.on;
  }

  private set(on: boolean): void {
    this.on = on;
    try {
      localStorage.setItem(KEY, on ? '1' : '0');
    } catch {
      /* Private browsing, or a user who has turned it off. The choice
         still applies to this session; it just will not be remembered. */
    }
    this.apply();
  }

  private load(): boolean {
    /* A URL wins over the stored choice, following `?circuit=` and
       `?session=`: a static site's only sharing mechanism is a link,
       and a teacher handing out a link is how this app reaches anyone. */
    const asked = new URLSearchParams(location.search).get('easy');
    if (asked === '0') return false;
    if (asked === '1') return true;

    try {
      /* On unless asked otherwise — the exact inverse of the HUD
         button, and for the same reason it gives: a first-time player
         must not have to find a setting before the game is playable. */
      return localStorage.getItem(KEY) !== '0';
    } catch {
      return true;
    }
  }

  private apply(): void {
    document.body.classList.toggle('easy', this.on);
    this.button.classList.toggle('on', this.on);
    this.button.textContent = this.on ? '쉬운 조작 끄기' : '쉬운 조작';
    this.onChange(this.on);
  }
}
