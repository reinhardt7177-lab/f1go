/**
 * How big the screen actually is, and keeping it lit.
 *
 * `window.innerHeight` is not the answer on a phone, and `100vh` is not
 * the answer anywhere. Mobile Safari sizes `vh` against the viewport
 * with the URL bar *retracted*, so a page laid out in `vh` is taller
 * than the space it is shown in for as long as the bar is out — which is
 * from load until the first scroll, and a game never scrolls. Chrome on
 * Android does the same in a different direction. The measurement that
 * is true right now lives on `visualViewport`, so it is read from there
 * and published as `--app-height` for the stylesheet to use.
 *
 * Rotating is worse than resizing. Both platforms fire
 * `orientationchange` before the new size is readable — iOS reports the
 * old dimensions for something like a fifth of a second, and Android
 * reports an intermediate size mid-animation. A renderer that sizes its
 * framebuffer from that measurement gets a canvas of the wrong shape and
 * keeps it until something else happens to resize. So a change is not
 * one event: it is a burst of re-measurements over the following half
 * second, each cheap, and the last one is the one that is right.
 *
 * And a phone left alone dims and locks. That is correct behaviour for a
 * page and wrong for a game being played with two thumbs, neither of
 * which is generating the touch events the idle timer is watching for —
 * a long stint on a fast circuit is minutes of continuous input that the
 * OS cannot see. `WakeLockSentinel` is the fix where it exists, and it
 * has to be re-taken every time the tab comes back, because the browser
 * drops it whenever the page is hidden.
 */

type WakeLockSentinelish = { released: boolean; release: () => Promise<void> };
type WakeLockish = { request: (type: 'screen') => Promise<WakeLockSentinelish> };

/**
 * Publish the true viewport height as `--app-height`.
 *
 * A custom property rather than `100dvh` alone: `dvh` is not in older
 * iOS, and where both work they agree, so this costs one line and covers
 * four more years of phones.
 */
export const publishViewportSize = (): void => {
  const vv = window.visualViewport;
  const h = vv?.height ?? window.innerHeight;
  const w = vv?.width ?? window.innerWidth;
  const root = document.documentElement;
  root.style.setProperty('--app-height', `${Math.round(h)}px`);
  root.style.setProperty('--app-width', `${Math.round(w)}px`);
};

/**
 * Call `onChange` whenever the usable viewport may have changed, and
 * keep calling it until the platform has stopped lying about the size.
 */
export class ViewportWatcher {
  private timers: ReturnType<typeof setTimeout>[] = [];

  /**
   * Re-measurements after a rotation, in milliseconds. The first is the
   * next frame — enough for a plain resize — and the rest cover iOS,
   * which finishes its rotation animation somewhere in the third.
   */
  private static readonly SETTLE = [0, 120, 300, 550];

  constructor(private readonly onChange: () => void) {
    publishViewportSize();

    const settle = (): void => this.settle();
    window.addEventListener('resize', settle);
    window.addEventListener('orientationchange', settle);
    window.visualViewport?.addEventListener('resize', settle);
    /* Leaving fullscreen gives the browser chrome back, which is a
       viewport change the resize event does not always precede. */
    document.addEventListener('fullscreenchange', settle);
    /* And a tab returning from the background may have been resized
       while it was not being painted. */
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) settle();
    });
  }

  /** Re-measure now, and again as the platform settles. */
  settle(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers = ViewportWatcher.SETTLE.map((ms) =>
      setTimeout(() => {
        publishViewportSize();
        this.onChange();
      }, ms)
    );
  }
}

/**
 * Hold the screen awake for as long as the page is visible.
 *
 * Every failure here is a normal outcome: Safari before 16.4 has no API,
 * a browser may refuse on battery saver, and the lock is dropped on
 * every tab switch by design. None of them is worth telling anyone
 * about, so all of them are swallowed and re-tried on the next return.
 */
export class KeepAwake {
  private sentinel: WakeLockSentinelish | null = null;

  constructor() {
    void this.acquire();
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) void this.acquire();
    });
  }

  private async acquire(): Promise<void> {
    const lock = (navigator as unknown as { wakeLock?: WakeLockish }).wakeLock;
    if (!lock) return;
    if (this.sentinel && !this.sentinel.released) return;
    try {
      this.sentinel = await lock.request('screen');
    } catch {
      // Refused. The screen will dim; the game carries on.
      this.sentinel = null;
    }
  }
}
