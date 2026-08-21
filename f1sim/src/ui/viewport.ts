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

/**
 * True when the page is running as an installed app rather than in a
 * browser tab.
 *
 * This is the whole answer to fullscreen on an iPhone, where there is no
 * Fullscreen API at all: Safari will not let a page hide its own chrome,
 * but it *will* run a page added to the home screen with no chrome at
 * all, in the orientation the manifest asks for. So on iOS the honest
 * instruction is not "press this to go fullscreen" — there is no such
 * button — it is "add this to your home screen", and knowing which mode
 * we are in is what lets the interface say the right one.
 */
export const isStandalone = (): boolean => {
  const displayMode =
    typeof matchMedia === 'function' &&
    (matchMedia('(display-mode: standalone)').matches ||
      matchMedia('(display-mode: fullscreen)').matches);
  // The iOS-only flag, which predates the standard query and is still
  // the only one Safari sets for a home-screen app.
  const legacy = (navigator as { standalone?: boolean }).standalone === true;
  return displayMode || legacy;
};

/** True where a page can hide the browser's chrome by asking. */
export const canFullscreen = (): boolean =>
  typeof document !== 'undefined' &&
  document.documentElement.requestFullscreen !== undefined;

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

/** Ask for landscape on its own, for when fullscreen is already held. */
export const lockLandscape = async (): Promise<void> => {
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
    /* And say so on the body, because the title card is not the only
       thing on screen while it is up. The timing tower, the position
       panel, the speedometer and the map were all drawn over it,
       reporting a race that had not started — the card said START while
       the panel behind it said P10, +8 m. Nothing about a session
       belongs on screen before the session exists. */
    document.body.classList.add('titlecard');

    /* A button that cannot do anything is worse than no button. An
       iPhone in Safari has no Fullscreen API, so the toggle was drawn,
       tapped, and silently did nothing — and it sat over the middle of
       the sky while it did. It is hidden where it cannot work, and where
       the page is already running without chrome there is nothing left
       for it to hide. */
    if (!canFullscreen() || isStandalone()) this.toggle.classList.add('hidden');

    /* And in its place, on the one platform that has the other route:
       iOS runs a home-screen app chrome-free and landscape-locked, which
       is everything the fullscreen button was for. Saying so is the only
       way anyone finds out. */
    this.showInstallHint();

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
      document.body.classList.remove('titlecard');
      this.onStart();
    };
    document.getElementById('btn-start')?.addEventListener('click', begin);

    this.toggle.addEventListener('click', () => {
      void (isFullscreen() ? exitImmersive() : enterImmersive());
    });

    const sync = (): void => this.syncRotatePrompt();
    window.addEventListener('resize', sync);
    window.addEventListener('orientationchange', sync);
    window.visualViewport?.addEventListener('resize', sync);
    document.addEventListener('fullscreenchange', () => {
      this.toggle.classList.toggle('on', isFullscreen());
      /* Android grants the orientation lock only while the document is
         fullscreen, and drops it silently on the way out. Re-asking on
         the way *in* covers the case where the first request lost the
         race against the fullscreen transition — which it does on a
         cold load often enough to matter. */
      if (isFullscreen()) void lockLandscape();
      sync();
    });
    sync();
  }

  /**
   * Tell an iOS browser user about Add to Home Screen.
   *
   * Only there, and only in a tab: on Android the fullscreen button
   * works, and in a home-screen app the advice has already been taken.
   * It replaces the control hint rather than joining it, because a
   * screen that says three things says none of them.
   */
  private showInstallHint(): void {
    if (!isCoarsePointer() || canFullscreen() || isStandalone()) return;
    const hint = document.getElementById('install-hint');
    hint?.classList.remove('hidden');
    document.getElementById('touch-hint')?.classList.add('hidden');
  }

  private syncRotatePrompt(): void {
    // Only nag on a touch device, and only once the player has started —
    // otherwise the start card and the prompt fight over the screen.
    const show =
      isCoarsePointer() && isPortrait() && this.start.classList.contains('hidden');
    this.rotate.classList.toggle('hidden', !show);
  }
}
