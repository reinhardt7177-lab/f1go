/**
 * Lap and sector timing.
 *
 * Everything here is arithmetic on `(s, t)` — the pair the centreline
 * spline produces from a world position. Crossing the timing line is a
 * wrap in `s`; a sector split is `s` passing a threshold; running wide is
 * `|t|` exceeding the road half-width. No trigger volumes, no colliders,
 * no special-case geometry anywhere on the track.
 */
import type { Circuit } from '../track/circuit';

export interface SectorTime {
  index: number;
  time: number;
  /** True when this is the best time recorded for the sector. */
  personalBest: boolean;
}

export interface CompletedLap {
  number: number;
  time: number;
  sectors: number[];
  /** A lap with any wheel beyond the white line does not count. */
  valid: boolean;
}

export class LapTimer {
  /** Laps started, 1-based. Zero until the line is first crossed. */
  lap = 0;
  /** Time since the timing line, in seconds. */
  lapTime = 0;
  /** Sector currently being driven, 0-based. */
  sector = 0;
  /** Splits banked so far this lap. */
  currentSectors: number[] = [];

  bestLap: CompletedLap | null = null;
  lastLap: CompletedLap | null = null;
  bestSectors: number[] = [];
  readonly history: CompletedLap[] = [];

  /** Cleared at the timing line; set the moment a wheel runs wide. */
  private lapValid = true;
  private started = false;
  private lastS = 0;
  /** Distance travelled this lap, used to reject a spurious wrap. */
  private travelled = 0;

  constructor(private readonly circuit: Circuit) {
    this.bestSectors = new Array(circuit.sectorSplits.length).fill(Infinity);
  }

  /**
   * Advance the timer.
   *
   * @param s        distance along the centreline
   * @param onTrack  whether the car is currently within the white lines
   * @returns the lap just completed, if the line was crossed this tick
   */
  update(s: number, onTrack: boolean, dt: number): CompletedLap | null {
    const length = this.circuit.length;

    if (!this.started) {
      this.started = true;
      this.lastS = s;
      this.lap = 1;
      return null;
    }

    // Unwrap progress across the timing line. A jump of more than half a
    // lap in either direction is the line, not a teleport.
    const raw = s - this.lastS;
    let delta = raw;
    let crossedForward = false;

    if (raw < -length / 2) {
      delta = raw + length;
      crossedForward = true;
    } else if (raw > length / 2) {
      delta = raw - length;
    }

    this.lastS = s;
    this.travelled += delta;
    this.lapTime += dt;
    if (!onTrack) this.lapValid = false;

    // Sector splits. The travelled guard stops a car that rolls back and
    // forth over a line from banking the same sector repeatedly.
    const splits = this.circuit.sectorSplits;
    while (
      this.sector < splits.length - 1 &&
      s >= splits[this.sector]! &&
      this.travelled >= splits[this.sector]! * 0.5
    ) {
      const banked = this.currentSectors.reduce((a, b) => a + b, 0);
      this.currentSectors.push(this.lapTime - banked);
      this.sector++;
    }

    if (crossedForward && this.travelled > length * 0.5) {
      return this.completeLap();
    }
    return null;
  }

  private completeLap(): CompletedLap {
    const banked = this.currentSectors.reduce((a, b) => a + b, 0);
    const sectors = [...this.currentSectors, this.lapTime - banked];

    const lap: CompletedLap = {
      number: this.lap,
      time: this.lapTime,
      sectors,
      valid: this.lapValid
    };

    if (lap.valid) {
      for (let i = 0; i < sectors.length; i++) {
        if (sectors[i]! < (this.bestSectors[i] ?? Infinity)) this.bestSectors[i] = sectors[i]!;
      }
      if (!this.bestLap || lap.time < this.bestLap.time) this.bestLap = lap;
    }

    this.lastLap = lap;
    this.history.push(lap);
    this.beginLap();
    return lap;
  }

  private beginLap(): void {
    this.lap++;
    this.lapTime = 0;
    this.sector = 0;
    this.currentSectors = [];
    this.lapValid = true;
    this.travelled = 0;
  }

  /** Restart timing from scratch, keeping the records. */
  resetLap(): void {
    this.beginLap();
    this.started = false;
  }

  /** Best sector times added together — the theoretical best lap. */
  optimalLap(): number | null {
    if (this.bestSectors.some((t) => !isFinite(t))) return null;
    return this.bestSectors.reduce((a, b) => a + b, 0);
  }
}
