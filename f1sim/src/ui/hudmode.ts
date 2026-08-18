/**
 * Two interfaces over one simulation.
 *
 * Everything on screen was built for the person tuning the car, and it
 * shows: on a 1280-wide viewport the road was framed by a telemetry
 * panel, a g-g plot, four tyre readouts, a live setup summary and
 * fifteen sliders, one of which is labelled *lateral stiffness B*. Every
 * one of those earns its place while you are asking why the car will not
 * turn. None of them earns it while you are trying to take a corner, and
 * for a ten-year-old they are not neutral — they are a wall of numbers
 * standing between them and the game.
 *
 * So there are two views rather than a compromise between them. Driving
 * keeps what you look at while your eyes are on the road: speed, gear,
 * lap, position, lap time. The bench keeps everything, unchanged, one
 * button away.
 *
 * Which one you are in is a class on `<body>` and nothing more, so no
 * panel has to know this exists or be rebuilt when it changes.
 */

const KEY = 'f1go-hud-bench';

export class HudMode {
  private bench: boolean;
  private readonly button: HTMLButtonElement;

  constructor(mount: HTMLElement) {
    this.bench = this.load();

    this.button = document.createElement('button');
    this.button.type = 'button';
    this.button.className = 'hud-mode';
    this.button.title = '계기판';
    mount.appendChild(this.button);

    this.button.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.set(!this.bench);
    });

    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyT') this.set(!this.bench);
    });

    this.apply();
  }

  /** True while the engineering panels are on screen. */
  get engineering(): boolean {
    return this.bench;
  }

  private set(bench: boolean): void {
    this.bench = bench;
    try {
      localStorage.setItem(KEY, bench ? '1' : '0');
    } catch {
      /* Private browsing, or a user who has turned it off. The choice
         still applies to this session; it just will not be remembered. */
    }
    this.apply();
  }

  private load(): boolean {
    try {
      // Driving unless asked otherwise. A first-time player must not
      // have to find and dismiss the instruments before they can play.
      return localStorage.getItem(KEY) === '1';
    } catch {
      return false;
    }
  }

  private apply(): void {
    document.body.classList.toggle('bench', this.bench);
    this.button.classList.toggle('on', this.bench);
    this.button.textContent = this.bench ? '계기판 끄기' : '계기판';
  }
}
