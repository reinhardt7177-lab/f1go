/**
 * The lap you drove, driving beside you.
 *
 * A ghost is the oldest good idea in racing games and the cheapest thing
 * a simulator can offer, because the hard part — knowing where the car
 * was and when — is something the game already computes every tick. All
 * this file does is write it down and read it back.
 *
 * ## Why a path and not a replay
 *
 * `ARCHITECTURE.md` promises that determinism buys replays, ghosts and
 * multiplayer, and it is right about the first and third. A *replay*
 * needs determinism: you store the inputs, re-run the simulation, and
 * the car goes where it went. A ghost does not. A ghost is drawn, never
 * simulated — it has no grip to solve for and nothing can hit it — so
 * storing the answer is strictly better than storing the question. It
 * costs no second physics world, it cannot drift if the tyre model is
 * ever retuned, and a lap recorded today still plays back after a
 * change that would invalidate an input replay.
 *
 * So this stores a path, and the determinism guarantee stays in the bank
 * for the thing that actually needs it.
 *
 * ## What a sample is
 *
 * Five floats — x, y, z, heading, and distance along the centreline —
 * taken at a fixed rate. Time is not stored because it is the index:
 * sample `i` is the car at `i / SAMPLE_HZ` seconds into the lap. That is
 * a fifth of the file saved and it removes a whole class of bug where
 * the timestamps and the positions disagree.
 *
 * The distance is what earns its place least obviously and matters
 * most. Position tells you where to draw the ghost; distance tells you
 * *when the ghost was here*, which is the only way to answer the one
 * question a time trial is about — am I up or down on it, right now.
 * Comparing positions cannot answer that, because two cars at the same
 * moment are in different places and two cars in the same place were
 * there at different times.
 *
 * Attitude is not stored either. A ghost that rolls and pitches is a
 * ghost that needs four more floats to say something nobody looks at at
 * a hundred metres — `render/rivals.ts` already ignores banking on the
 * rivals for the same reason.
 *
 * 20 Hz is the rate, and it is chosen rather than inherited. At 85 m/s
 * that is a sample every 4.25 m; through a 100 m radius corner the
 * straight line between two samples departs from the arc by
 * `4.25² / (8 × 100)` ≈ **2.3 cm**, which is a tenth of the width of a
 * tyre. Recording at the simulation's own 120 Hz would be six times the
 * file for an error already far below what anyone can see.
 */

/** Samples a second. See the note above on why this number. */
export const SAMPLE_HZ = 20;

/** Floats per sample: x, y, z, heading, distance. */
const STRIDE = 5;

/**
 * Longest lap worth keeping, in seconds.
 *
 * A lap this slow is not going to be anybody's best, so the recording
 * would be stored and never played. The cap exists so that a player who
 * parks on the grass and goes to lunch does not write a megabyte into
 * `localStorage`.
 */
export const MAX_LAP_SECONDS = 360;

export interface GhostSample {
  x: number;
  y: number;
  z: number;
  heading: number;
  /** Metres along the circuit centreline. Monotonic within a lap. */
  distance: number;
}

export interface GhostLap {
  /** Lap time in seconds, as the timer recorded it. */
  time: number;
  /** `[x, y, z, heading, distance]` per sample, at `SAMPLE_HZ`. */
  path: Float32Array;
}

/** Seconds of recorded lap, from the sample count. */
export const ghostDuration = (lap: GhostLap): number =>
  Math.max(0, lap.path.length / STRIDE - 1) / SAMPLE_HZ;

/* ------------------------------------------------------------------
   Recording
   ------------------------------------------------------------------ */

/**
 * Accumulates one lap.
 *
 * Fed the car's position every simulation tick and told the lap time; it
 * decides for itself which ticks become samples. Driving that from the
 * *lap clock* rather than from a tick counter is what keeps a sample at
 * a known second even though the simulation runs at 120 Hz and the
 * sample rate is 20 — no accumulator to drift, and the same lap driven
 * twice produces samples at the same times.
 */
export class GhostRecorder {
  private samples: number[] = [];
  /** Index of the next sample owed, so a stalled frame cannot skip one. */
  private next = 0;
  private overrun = false;

  /** Samples taken so far. */
  get length(): number {
    return this.samples.length / STRIDE;
  }

  /** True once the lap has run past `MAX_LAP_SECONDS` and been abandoned. */
  get abandoned(): boolean {
    return this.overrun;
  }

  reset(): void {
    this.samples.length = 0;
    this.next = 0;
    this.overrun = false;
  }

  /**
   * Offer the car's state at `lapTime` seconds into the lap.
   *
   * Called every tick; takes a sample only when the lap clock has
   * reached the next slot. A frame that swallowed several ticks fills
   * every slot it passed rather than leaving a hole, which is what stops
   * a hitch on a phone from shortening the recorded lap.
   */
  record(lapTime: number, at: GhostSample): void {
    if (this.overrun) return;
    if (lapTime > MAX_LAP_SECONDS) {
      this.overrun = true;
      this.samples.length = 0;
      return;
    }
    while (this.next <= lapTime * SAMPLE_HZ) {
      this.samples.push(at.x, at.y, at.z, at.heading, at.distance);
      this.next++;
    }
  }

  /**
   * The lap just finished, as a recording — or null if there is not
   * enough of one to play back.
   */
  take(time: number): GhostLap | null {
    if (this.overrun || this.length < 2) return null;
    return { time, path: Float32Array.from(this.samples) };
  }
}

/* ------------------------------------------------------------------
   Playback
   ------------------------------------------------------------------ */

/** Shortest signed way round from `a` to `b`, in radians. */
const angleDelta = (a: number, b: number): number => {
  const TWO_PI = Math.PI * 2;
  let d = (b - a) % TWO_PI;
  if (d > Math.PI) d -= TWO_PI;
  if (d < -Math.PI) d += TWO_PI;
  return d;
};

export interface GhostFrame extends GhostSample {
  /** Metres a second, from the two samples either side. */
  speed: number;
  /** True once the recorded lap has run out. */
  finished: boolean;
}

/**
 * Where the ghost was `lapTime` seconds into its lap.
 *
 * Linear between samples for position. Heading is interpolated *along
 * the shortest arc*, and it has to be: a car pointing at 179° and then
 * at −179° has turned two degrees, and a naive lerp sends it 358° the
 * other way. At 20 Hz that shows up as the ghost spinning on the spot
 * every time it crosses whichever compass bearing the circuit was
 * authored around — an obvious bug that is invisible until the layout
 * happens to put a corner there.
 *
 * Past the end the ghost holds its last sample and reports `finished`,
 * so the caller can stop drawing a car that has already taken the flag
 * rather than parking it on the road.
 */
export const sampleGhost = (lap: GhostLap, lapTime: number): GhostFrame => {
  const count = lap.path.length / STRIDE;
  const at = (i: number, k: number): number => lap.path[i * STRIDE + k] as number;

  if (count === 0) {
    return { x: 0, y: 0, z: 0, heading: 0, distance: 0, speed: 0, finished: true };
  }

  const exact = Math.max(0, lapTime) * SAMPLE_HZ;
  if (exact >= count - 1) {
    const i = count - 1;
    return {
      x: at(i, 0),
      y: at(i, 1),
      z: at(i, 2),
      heading: at(i, 3),
      distance: at(i, 4),
      speed: 0,
      finished: true
    };
  }

  const i = Math.floor(exact);
  const f = exact - i;
  const j = i + 1;

  const x = at(i, 0) + (at(j, 0) - at(i, 0)) * f;
  const y = at(i, 1) + (at(j, 1) - at(i, 1)) * f;
  const z = at(i, 2) + (at(j, 2) - at(i, 2)) * f;
  const heading = at(i, 3) + angleDelta(at(i, 3), at(j, 3)) * f;
  const distance = at(i, 4) + (at(j, 4) - at(i, 4)) * f;

  const dx = at(j, 0) - at(i, 0);
  const dy = at(j, 1) - at(i, 1);
  const dz = at(j, 2) - at(i, 2);
  const speed = Math.hypot(dx, dy, dz) * SAMPLE_HZ;

  return { x, y, z, heading, distance, speed, finished: false };
};

/**
 * When the ghost reached `distance` metres, in seconds into its lap.
 *
 * This is the whole of the delta readout: subtract the answer from the
 * player's current lap time and the sign says whether they are up or
 * down, at this point on the circuit rather than at this instant.
 *
 * Binary search, because the distance column is monotonic within a lap
 * and a linear scan would be a thousand comparisons a frame for a number
 * that changes by four metres.
 *
 * Returns null before the ghost's first sample or after its last, which
 * is the honest answer rather than a clamped one: a delta against a
 * point the ghost never reached is not a delta.
 */
export const ghostTimeAtDistance = (lap: GhostLap, distance: number): number | null => {
  const count = lap.path.length / STRIDE;
  if (count < 2) return null;
  const d = (i: number): number => lap.path[i * STRIDE + 4] as number;
  if (distance < d(0) || distance > d(count - 1)) return null;

  /* Lower bound: the first sample at or past `distance`, which is the
     ghost's *first arrival* there.
     
     That "first" is load-bearing rather than a detail. If the ghost was
     stationary for half a second — a spin, or a car sitting in the
     gravel — several samples share one distance, and taking the last of
     them would credit the player with the whole time the ghost stood
     still. The delta would read as a gain that was never made, at
     exactly the point on the circuit where a driver is looking hardest
     at it. */
  let lo = 0;
  let hi = count - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (d(mid) >= distance) hi = mid;
    else lo = mid + 1;
  }
  if (lo === 0) return 0;

  const span = d(lo) - d(lo - 1);
  const f = span > 1e-6 ? (distance - d(lo - 1)) / span : 1;
  return (lo - 1 + f) / SAMPLE_HZ;
};

/* ------------------------------------------------------------------
   Storage
   ------------------------------------------------------------------ */

const key = (circuitId: string): string => `f1go-ghost-${circuitId}`;

/**
 * Base64 of the raw float bytes.
 *
 * `localStorage` holds strings, and JSON of an array of floats is about
 * four times the size of the bytes it describes — a 90 s lap is 1,800
 * samples, which is 28.8 KB of Float32 against something over 100 KB
 * once every number has been printed with a decimal point. Base64 costs
 * a third on top of the bytes, which still leaves it comfortably ahead,
 * and it round-trips exactly where a printed float does not.
 */
export const encodeGhost = (lap: GhostLap): string => {
  const bytes = new Uint8Array(lap.path.buffer, lap.path.byteOffset, lap.path.byteLength);
  let binary = '';
  /* In chunks, because `String.fromCharCode(...bytes)` on a 30 KB array
     is a 30,000-argument call and browsers throw on it. */
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
};

export const decodeGhost = (time: number, encoded: string): GhostLap | null => {
  try {
    const binary = atob(encoded);
    /* A Float32Array cannot be built over a buffer whose length is not a
       multiple of four, and a truncated or hand-edited entry is exactly
       how that happens. */
    if (binary.length % (STRIDE * 4) !== 0 || binary.length === 0) return null;
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return { time, path: new Float32Array(bytes.buffer) };
  } catch {
    return null;
  }
};

export const loadGhost = (circuitId: string): GhostLap | null => {
  try {
    const raw = localStorage.getItem(key(circuitId));
    if (!raw) return null;
    const stored = JSON.parse(raw) as { time?: unknown; path?: unknown };
    if (typeof stored.time !== 'number' || typeof stored.path !== 'string') return null;
    return decodeGhost(stored.time, stored.path);
  } catch {
    /* A corrupt or blocked store is not worth failing a session over —
       the same position `race/championship.ts` takes. */
    return null;
  }
};

export const saveGhost = (circuitId: string, lap: GhostLap): void => {
  try {
    localStorage.setItem(
      key(circuitId),
      JSON.stringify({ time: lap.time, path: encodeGhost(lap) })
    );
  } catch {
    /* Private browsing, quota, or a user who has turned it off. The lap
       still counted; it just will not be raced against. */
  }
};

export const clearGhost = (circuitId: string): void => {
  try {
    localStorage.removeItem(key(circuitId));
  } catch {
    /* nothing to undo */
  }
};
