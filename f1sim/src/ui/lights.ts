/**
 * The start lights.
 *
 * A race used to begin the moment the page finished loading. There was
 * no instant at which it started — the clock was simply already
 * running, and the first thing a driver did was work out that they were
 * late. Everything else in the session had a shape and the start did
 * not.
 *
 * Five lights fix that, and they do it the way the real thing does: the
 * filling is the countdown, and it is the *extinguishing* that is the
 * flag. That grammar is worth keeping exactly, because it is the one
 * piece of motor racing every spectator already knows how to read, and
 * a child watching this has almost certainly seen it before they ever
 * saw the game.
 */
import type { Session } from '../race/session';
import { START_LIGHTS } from '../race/session';

/** How long GO! stays up after the lights go out (ms). */
const GO_DURATION = 900;

export class StartLights {
  private readonly root: HTMLElement;
  private readonly lamps: HTMLElement[] = [];
  private readonly go: HTMLElement;

  private shown = -1;
  private goUntil = 0;
  private done = false;
  /** Whether the car was still being held the last time this ran. */
  private wasOnGrid = false;

  constructor(mount: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'start-lights hidden';

    const gantry = document.createElement('div');
    gantry.className = 'gantry';
    for (let i = 0; i < START_LIGHTS; i++) {
      const lamp = document.createElement('i');
      gantry.appendChild(lamp);
      this.lamps.push(lamp);
    }
    this.root.appendChild(gantry);

    this.go = document.createElement('b');
    this.go.className = 'go';
    this.go.textContent = 'GO!';
    this.root.appendChild(this.go);

    mount.appendChild(this.root);
  }

  /**
   * @param now  a monotonic clock in ms, for the GO! flash — the
   *             session's own elapsed time is no use here because it
   *             starts at zero at exactly the moment this has to run
   */
  update(session: Session, now: number): void {
    /* The transition is observed here rather than taken from
     * `session.lightsJustWentOut`.
     *
     * That flag is set for exactly one simulation tick, and this runs
     * on the render loop. The simulation is fixed at 120 Hz and the
     * display is usually 60, so two steps commonly happen between two
     * frames and a one-tick flag is missed about half the time — which
     * is precisely what happened: the lights stayed lit and GO! never
     * appeared. The flag is still right for anything that runs on the
     * step, a starting horn being the obvious one. It is simply not
     * safe to read from here.
     *
     * Comparing against what was on screen last frame cannot miss: a
     * transition either has happened by now or has not. */
    /* Only once the player has entered. `onGrid` is true before that
       too — the car is held behind the title card — but a gantry
       floating over the title with nothing counting is furniture. */
    const onGrid = session.hasBegun && session.onGrid;
    if (this.wasOnGrid && !onGrid) {
      this.goUntil = now + GO_DURATION;
      for (const lamp of this.lamps) lamp.className = '';
      this.shown = 0;
    }
    this.wasOnGrid = onGrid;

    if (onGrid) {
      this.root.classList.remove('hidden');
      this.go.classList.remove('on');

      const lit = session.lights;
      if (lit !== this.shown) {
        this.shown = lit;
        for (let i = 0; i < this.lamps.length; i++) {
          this.lamps[i]!.className = i < lit ? 'on' : '';
        }
      }
      return;
    }

    if (now < this.goUntil) {
      this.root.classList.remove('hidden');
      this.go.classList.add('on');
      return;
    }

    // Hidden for the rest of the session, and only written once — this
    // runs every frame for the next twenty minutes.
    if (!this.done) {
      this.done = true;
      this.root.classList.add('hidden');
      this.go.classList.remove('on');
    }
  }
}
