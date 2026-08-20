/**
 * How much frame to spend, and on what.
 *
 * The desktop settings — two-times pixel ratio, multisampling, shadow
 * maps, a full forest — are not a *preference* a phone can also hold.
 * They are a budget, and a mid-range phone has perhaps a fifth of it.
 * Every mesh here is drawn twice (once in colour, once as the outline
 * hull), so the scene is already paying double before the resolution is
 * chosen, and resolution is the one term that costs the *square* of what
 * you change: dropping a 3x device from 2.0 to 1.25 is 2.6x fewer pixels
 * shaded, every frame, for a difference nobody can see at arm's length.
 *
 * Two mechanisms, and they do different jobs:
 *
 *   - The **tier** is chosen once, from what the device says about
 *     itself. It decides the things that cannot change later without
 *     rebuilding the scene — how many trees, how big the shadow map,
 *     whether there is a shadow map at all.
 *   - The **scaler** runs every frame and moves resolution alone, which
 *     is the one dial that can be turned mid-race for free. A device
 *     that guesses well never sees it move; a device that guesses badly
 *     — a cheap phone that reports eight cores, a laptop throttling on
 *     battery — is corrected by measurement within a second.
 *
 * Both halves are pure functions over plain numbers so they can be
 * tested without a GPU. `detectProfile()` is the only part that reads
 * the browser, and it is defensive about every field: `deviceMemory` is
 * Chrome-only, `hardwareConcurrency` lies on iOS, and neither exists in
 * node.
 */

export type QualityTier = 'low' | 'medium' | 'high';

/** What the device is willing to say about itself. */
export interface DeviceProfile {
  /** A finger rather than a mouse — the strongest single signal. */
  coarsePointer: boolean;
  /** GiB of RAM, as `navigator.deviceMemory` reports it. Null if absent. */
  deviceMemory: number | null;
  /** Logical cores. Null if absent. */
  cores: number | null;
  /** CSS pixels to device pixels. */
  devicePixelRatio: number;
  /** Longest edge of the viewport in CSS pixels. */
  viewportLongEdge: number;
}

export interface QualitySettings {
  /** Ceiling on `renderer.setPixelRatio`. */
  maxPixelRatio: number;
  /** Multisampling. Costs bandwidth, which is exactly what a phone lacks. */
  antialias: boolean;
  /** Whether anything casts a shadow at all. */
  shadows: boolean;
  /** Edge of the shadow map, when there is one. */
  shadowMapSize: number;
  /** Fraction of the scenery to place, 0..1. */
  sceneryDensity: number;
  /** Tyre smoke particles held in the pool. */
  smokePool: number;
  /** Where fog starts and ends, in metres. */
  fog: readonly [number, number];
  /** Lowest resolution scale the frame-time scaler may fall to. */
  minResolutionScale: number;
}

const SETTINGS: Record<QualityTier, QualitySettings> = {
  /* A phone that told us it is cheap, or one that never said. No shadow
     map, no multisampling, one pixel per CSS pixel and half the forest.
     It still reads as the same game: flat colour inside a black line
     survives being drawn small in a way that a photographic renderer
     does not. */
  low: {
    maxPixelRatio: 1,
    antialias: false,
    shadows: false,
    shadowMapSize: 512,
    sceneryDensity: 0.42,
    smokePool: 48,
    fog: [520, 2000],
    minResolutionScale: 0.6
  },
  /* Any recent phone. Shadows come back — a car with no shadow reads as
     floating, and at 512 the hard-edged shadow this renderer uses is
     indistinguishable from the 1024 one at phone size — but the
     resolution stays under the retina ceiling. */
  medium: {
    maxPixelRatio: 1.5,
    antialias: false,
    shadows: true,
    shadowMapSize: 512,
    sceneryDensity: 0.7,
    smokePool: 96,
    fog: [700, 2600],
    minResolutionScale: 0.7
  },
  /* What the game was written against. */
  high: {
    maxPixelRatio: 2,
    antialias: true,
    shadows: true,
    shadowMapSize: 1024,
    sceneryDensity: 1,
    smokePool: 160,
    fog: [900, 3200],
    minResolutionScale: 0.8
  }
};

/** A copy, so a caller cannot edit the table everyone else reads. */
export const settingsFor = (tier: QualityTier): QualitySettings => {
  const s = SETTINGS[tier];
  return { ...s, fog: [s.fog[0], s.fog[1]] };
};

/**
 * Choose a tier from what the device admits to.
 *
 * The rule is deliberately pessimistic on touch. A desktop that guesses
 * low loses some trees; a phone that guesses high drops to twelve frames
 * a second, and the scaler can claw back resolution but cannot un-place
 * a forest or un-build a shadow map. Guessing low and being corrected
 * upward by measurement is the recoverable direction.
 *
 * `hardwareConcurrency` is used only as a *floor* on touch, never as
 * permission to go high: an iPhone reports the same core count as a
 * laptop and a £120 Android reports eight, so a large number means
 * nothing while a small one is honest.
 */
export const pickTier = (p: DeviceProfile): QualityTier => {
  if (!p.coarsePointer) {
    // A mouse means a computer, and a computer with 2 GiB is a computer
    // that will still manage this scene.
    return p.deviceMemory !== null && p.deviceMemory <= 2 ? 'medium' : 'high';
  }

  // Chrome tells the truth here and it is the one number worth having.
  if (p.deviceMemory !== null) {
    if (p.deviceMemory <= 2) return 'low';
    if (p.deviceMemory <= 4) return 'medium';
    // 6 GiB or more is a flagship, but a flagship phone is still a phone
    // being held at arm's length: medium, and let measurement promote it.
    return 'medium';
  }

  // No memory hint — Safari. Two honest signals are left.
  if (p.cores !== null && p.cores <= 4) return 'low';
  /* A small screen is a small phone is an old phone. 812 CSS px is the
     long edge of an iPhone X; anything shorter than that is older than
     it. */
  if (p.viewportLongEdge > 0 && p.viewportLongEdge < 780) return 'low';
  return 'medium';
};

/** Read the profile from the browser. Safe to call anywhere. */
export const detectProfile = (): DeviceProfile => {
  const nav = typeof navigator === 'undefined' ? undefined : navigator;
  const memory = (nav as { deviceMemory?: number } | undefined)?.deviceMemory;
  const win = typeof window === 'undefined' ? undefined : window;

  return {
    coarsePointer:
      typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches,
    deviceMemory: typeof memory === 'number' && memory > 0 ? memory : null,
    cores:
      typeof nav?.hardwareConcurrency === 'number' && nav.hardwareConcurrency > 0
        ? nav.hardwareConcurrency
        : null,
    devicePixelRatio: win?.devicePixelRatio ?? 1,
    viewportLongEdge: win ? Math.max(win.innerWidth, win.innerHeight) : 0
  };
};

/** A tier can be pinned from the URL, which is how a bug report is made. */
export const tierFromQuery = (search: string): QualityTier | null => {
  const asked = new URLSearchParams(search).get('quality');
  return asked === 'low' || asked === 'medium' || asked === 'high' ? asked : null;
};

export interface ScalerOptions {
  /** Frame time above which the frame is judged too expensive (ms). */
  slowMs: number;
  /** Frame time below which there is room to spend more (ms). */
  fastMs: number;
  /** Frames averaged before either judgement is acted on. */
  window: number;
  /** Multiplier applied on each correction. */
  step: number;
  min: number;
  max: number;
  /** Frames to wait after a change before judging again. */
  cooldown: number;
}

const scalerDefaults = (min: number): ScalerOptions => ({
  /* 60 Hz is 16.7 ms. 20 ms is "we are missing frames"; 13 ms is "we
     have a third of the budget spare". The gap between them is what
     stops the controller hunting: a device that settles anywhere inside
     it never moves again. */
  slowMs: 20,
  fastMs: 13,
  window: 30,
  step: 0.85,
  min,
  max: 1,
  /* Long enough that a change has been through the compositor and shown
     up in the measurement before the next judgement is made. */
  cooldown: 45
});

/**
 * Move render resolution to fit the measured frame time.
 *
 * Deliberately asymmetric: it drops fast and climbs slowly. A player who
 * has just found the frame rate falling wants it back now; a player
 * whose frame rate is fine does not want the picture quality oscillating
 * because a garbage collection ran. Climbing uses twice the window and a
 * gentler step for the same reason.
 *
 * Feeds on frame *times*, not frame rates, because the thing being
 * defended is a deadline and averaging rates hides exactly the frames
 * that missed it.
 */
export class ResolutionScaler {
  private readonly options: ScalerOptions;
  private samples: number[] = [];
  private wait = 0;
  private current: number;
  /** Consecutive windows that came back with room to spare. */
  private calm = 0;

  constructor(min = 0.6, options: Partial<ScalerOptions> = {}) {
    this.options = { ...scalerDefaults(min), ...options };
    this.current = this.options.max;
  }

  /** The scale in force, 0..1 of the tier's pixel ratio. */
  get scale(): number {
    return this.current;
  }

  /**
   * Record a frame and, if the evidence has piled up, move.
   *
   * @returns the new scale when it changed, else null — so a caller can
   *          treat "no change" as "nothing to do" rather than resizing
   *          the framebuffer sixty times a second.
   */
  sample(frameMs: number): number | null {
    /* A frame that took a quarter of a second was a stall — a tab coming
       back, a texture upload, a garbage collection. Feeding it in would
       have the controller respond to something that has already
       finished happening. */
    if (!Number.isFinite(frameMs) || frameMs <= 0 || frameMs > 250) return null;

    if (this.wait > 0) {
      this.wait--;
      return null;
    }

    this.samples.push(frameMs);
    if (this.samples.length < this.options.window) return null;

    /* The median, not the mean. One 90 ms hitch in thirty frames moves a
       mean by 2.5 ms — enough to trip the threshold on its own — and
       moves a median by nothing, which is the correct response to one
       bad frame among twenty-nine good ones. */
    const typical = median(this.samples);
    this.samples = [];

    if (typical > this.options.slowMs) {
      this.calm = 0;
      return this.current > this.options.min
        ? this.moveTo(this.current * this.options.step)
        : null;
    }

    if (typical < this.options.fastMs) {
      /* Half a step up against a full step down, and only after two
         windows agree: the cost of climbing too eagerly is a picture
         that visibly breathes, and the cost of climbing too slowly is a
         slightly soft one for another half-second. */
      this.calm++;
      if (this.calm < 2 || this.current >= this.options.max) return null;
      this.calm = 0;
      return this.moveTo(this.current / Math.sqrt(this.options.step));
    }

    /* Inside the band. This is the state the controller is trying to
       reach, so forget the run of calm windows rather than letting them
       accumulate across it and trigger a climb later. */
    this.calm = 0;
    return null;
  }

  private moveTo(raw: number): number | null {
    const next = Math.min(this.options.max, Math.max(this.options.min, round(raw)));
    if (next === this.current) return null;
    this.current = next;
    this.wait = this.options.cooldown;
    return next;
  }
}

/** Quantised, so a 0.4% move never costs a framebuffer reallocation. */
const round = (v: number): number => Math.round(v * 20) / 20;

const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 0
    ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
    : (sorted[mid] ?? 0);
};
