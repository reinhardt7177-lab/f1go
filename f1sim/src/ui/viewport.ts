/**
 * Fullscreen and orientation.
 *
 * A racing game wants the whole screen and it wants it landscape. Both
 * requests need a user gesture, and orientation lock additionally
 * requires the document to already be fullscreen — so this is a single
 * tap that does the two in order, and degrades quietly on the platforms
 * that refuse one or both (iOS Safari has no orientation lock, and no
 * fullscreen at all on iPhone).
 *
 * Where the lock is unavailable the portrait prompt is the fallback: the
 * game does not pretend portrait is fine, it asks to be turned.
 */

/**
 * `lock` and `unlock` are typed as present by the DOM lib but are absent
 * on Safari, so they are re-declared optional rather than trusted.
 */
type ScreenOrientationWithLock = Omit<ScreenOrientation, 'lock' | 'unlock'> & {
  lock?: (orientation: 'landscape' | 'portrait' | 'any') => Promise<void>;
  unlock?: () => void;
};

export const isCoarsePointer = (): boolean =>
  typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

export const isPortrait = (): boolean => window.innerHeight > window.innerWidth;

/** True when the document is showing fullscreen right now. */
export const isFullscreen = (): boolean => document.fullscreenElement !== null;

/**
 * Go fullscreen and ask for landscape. Must be called from a user
 * gesture. Never throws — a platform that says no is a normal outcome,
 * not an error worth interrupting anyone over.
 */
export const enterImmersive = async (): Promise<void> => {
  try {
    if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
      await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    }
  } catch {
    // Fullscreen refused; carry on and still try the orientation.
  }

  try {
    const orientation = screen.orientation as ScreenOrientationWithLock | undefined;
    await orientation?.lock?.('landscape');
  } catch {
    // No lock on this platform. The portrait prompt covers it.
  }
};

export const exitImmersive = async (): Promise<void> => {
  try {
    const orientation = screen.orientation as ScreenOrientationWithLock | undefined;
    orientation?.unlock?.();
  } catch {
    /* nothing to undo */
  }
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
  } catch {
    /* already out */
  }
};

/**
 * The tap-to-start card, the rotate prompt, and the fullscreen toggle.
 *
 * On a desktop the start card never appears — there is nothing to ask
 * for, and a click-through before you can drive would be pure friction.
 */
export class ViewportManager {
  private readonly start: HTMLElement;
  private readonly rotate: HTMLElement;
  private readonly toggle: HTMLElement;

  constructor(private readonly onStart: () => void = () => {}) {
    this.start = document.getElementById('start-card')!;
    this.rotate = document.getElementById('rotate-prompt')!;
    this.toggle = document.getElementById('btn-fullscreen')!;

    // Shown everywhere, not just on touch. It began as the gesture
    // fullscreen needs — which only a phone lacks another route to — but
    // it now also carries the title and the circuit choice, and a
    // desktop player needs both of those just as much.
    this.start.classList.remove('hidden');

    /* One button rather than the whole card.
     *
     * The card used to start the session wherever you touched it, which
     * meant reaching for a circuit and missing began the race. Now the
     * only thing that starts it is START — and because a click is a
     * user gesture, fullscreen and the orientation lock still get the
     * permission they need. */
    const begin = (): void => {
      void enterImmersive();
      this.start.classList.add('hidden');
      this.onStart();
    };
    document.getElementById('btn-start')?.addEventListener('click', begin);

    this.toggle.addEventListener('click', () => {
      void (isFullscreen() ? exitImmersive() : enterImmersive());
    });

    const sync = (): void => this.syncRotatePrompt();
    window.addEventListener('resize', sync);
    window.addEventListener('orientationchange', sync);
    document.addEventListener('fullscreenchange', () => {
      this.toggle.classList.toggle('on', isFullscreen());
      sync();
    });
    sync();
  }

  private syncRotatePrompt(): void {
    // Only nag on a touch device, and only once the player has started —
    // otherwise the start card and the prompt fight over the screen.
    const show =
      isCoarsePointer() && isPortrait() && this.start.classList.contains('hidden');
    this.rotate.classList.toggle('hidden', !show);
  }
}
