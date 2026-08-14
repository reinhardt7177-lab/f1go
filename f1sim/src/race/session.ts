/**
 * Sessions — practice, qualifying, race.
 *
 * A session is the set of rules wrapped around lap timing: how it ends,
 * what counts as a result, what happens when you abuse track limits, and
 * what a pit stop costs. It reads the lap timer and the car's position
 * and owns nothing else, so it stays testable without a renderer.
 *
 * There is still no AI, so a race here has no opponents — it is a timed
 * run against yourself over a fixed number of laps. Everything the rules
 * layer needs for real racing is here; the field is stage three's job.
 */
import { clamp } from '../core/math';
import type { CompletedLap, LapTimer } from './timing';

export type SessionKind = 'practice' | 'qualifying' | 'race';

export type SessionPhase =
  /** Running. */
  | 'green'
  /** Time or laps are up; the lap in progress is the last one. */
  | 'chequered'
  /** Over. */
  | 'finished';

export interface SessionConfig {
  kind: SessionKind;
  /** Wall-clock length (s). Undefined means untimed. */
  duration?: number;
  /** Race distance. Undefined outside a race. */
  laps?: number;
  /** Track-limit strikes tolerated before a penalty lands. */
  strikesAllowed: number;
  /** Seconds added to the result per penalty. */
  penaltySeconds: number;
  /** Stationary time a pit stop costs (s). */
  pitStopDuration: number;
}

export const SESSION_PRESETS: Record<SessionKind, SessionConfig> = {
  practice: {
    kind: 'practice',
    strikesAllowed: 99,
    penaltySeconds: 0,
    pitStopDuration: 12
  },
  qualifying: {
    kind: 'qualifying',
    duration: 12 * 60,
    strikesAllowed: 2,
    penaltySeconds: 5,
    pitStopDuration: 12
  },
  race: {
    kind: 'race',
    laps: 5,
    strikesAllowed: 2,
    penaltySeconds: 5,
    pitStopDuration: 22
  }
};

export interface SessionState {
  kind: SessionKind;
  phase: SessionPhase;
  /** Seconds since the session went green. */
  elapsed: number;
  /** Seconds left, or null when untimed. */
  remaining: number | null;
  /** Laps completed, and the total for a race. */
  lapsDone: number;
  lapsTotal: number | null;
  /** Track-limit strikes taken so far, and penalties they have earned. */
  strikes: number;
  penalties: number;
  /** Seconds of penalty to add to the result. */
  penaltyTime: number;
  /** Non-null while the car is stationary being serviced. */
  pitTimeRemaining: number | null;
  pitStops: number;
}

export class Session {
  readonly config: SessionConfig;

  phase: SessionPhase = 'green';
  elapsed = 0;
  strikes = 0;
  penalties = 0;
  pitStops = 0;

  /** Seconds left of a stop in progress; null when not in the pits. */
  pitTimeRemaining: number | null = null;

  /** Set for one tick when a stop finishes, so fresh tyres can be fitted. */
  pitStopJustFinished = false;

  private wasOnTrack = true;
  /** Guard so one long excursion counts as a single strike. */
  private strikeArmed = true;

  constructor(config: SessionConfig) {
    this.config = config;
  }

  /**
   * Advance the session.
   *
   * @param onTrack  whether the car is inside the white lines
   * @param lapDone  the lap completed this tick, if any
   */
  update(dt: number, onTrack: boolean, lapDone: CompletedLap | null, timer: LapTimer): void {
    this.pitStopJustFinished = false;
    if (this.phase === 'finished') return;

    // A stop holds the car and the clock keeps running — that is the cost.
    if (this.pitTimeRemaining !== null) {
      this.pitTimeRemaining -= dt;
      if (this.pitTimeRemaining <= 0) {
        this.pitTimeRemaining = null;
        this.pitStopJustFinished = true;
        this.pitStops++;
      }
    }

    this.elapsed += dt;

    // --- track limits ------------------------------------------------
    // One strike per excursion, not per tick, and it only re-arms once
    // the car is properly back on the road.
    if (!onTrack && this.wasOnTrack && this.strikeArmed) {
      this.strikes++;
      this.strikeArmed = false;
      if (this.strikes > this.config.strikesAllowed) this.penalties++;
    }
    if (onTrack) this.strikeArmed = true;
    this.wasOnTrack = onTrack;

    // --- ending ------------------------------------------------------
    const lapsDone = timer.history.length;

    if (this.config.laps !== undefined) {
      // A race ends the moment the last lap is completed.
      if (lapsDone >= this.config.laps) {
        this.phase = 'finished';
        return;
      }
      if (lapsDone === this.config.laps - 1) this.phase = 'chequered';
    }

    if (this.config.duration !== undefined && this.elapsed >= this.config.duration) {
      // Time sessions let the lap in progress finish, as they do in
      // reality — the flag falls, but you get to complete your run.
      if (this.phase === 'green') this.phase = 'chequered';
      if (lapDone) this.phase = 'finished';
    }
  }

  /**
   * Ask for a pit stop. Only granted when the car is close to stationary,
   * which stands in for pit-lane geometry until there is a pit lane.
   */
  requestPit(speed: number): boolean {
    if (this.phase === 'finished') return false;
    if (this.pitTimeRemaining !== null) return false;
    if (Math.abs(speed) > 5) return false;

    this.pitTimeRemaining = this.config.pitStopDuration;
    return true;
  }

  /** True while the car should be held stationary. */
  get inPitStop(): boolean {
    return this.pitTimeRemaining !== null;
  }

  get penaltyTime(): number {
    return this.penalties * this.config.penaltySeconds;
  }

  state(timer: LapTimer): SessionState {
    return {
      kind: this.config.kind,
      phase: this.phase,
      elapsed: this.elapsed,
      remaining:
        this.config.duration === undefined
          ? null
          : Math.max(0, this.config.duration - this.elapsed),
      lapsDone: timer.history.length,
      lapsTotal: this.config.laps ?? null,
      strikes: this.strikes,
      penalties: this.penalties,
      penaltyTime: this.penaltyTime,
      pitTimeRemaining: this.pitTimeRemaining,
      pitStops: this.pitStops
    };
  }

  /**
   * The number the session is judged on: best lap when qualifying, total
   * elapsed plus penalties when racing, and nothing in practice.
   */
  result(timer: LapTimer): { label: string; time: number | null } {
    switch (this.config.kind) {
      case 'qualifying':
        return { label: 'best lap', time: timer.bestLap?.time ?? null };
      case 'race':
        return {
          label: 'race time',
          time: timer.history.length > 0 ? this.elapsed + this.penaltyTime : null
        };
      default:
        return { label: 'best lap', time: timer.bestLap?.time ?? null };
    }
  }

  /** Fraction of the session run, for a progress bar. */
  progress(timer: LapTimer): number {
    if (this.config.laps !== undefined) {
      return clamp(timer.history.length / this.config.laps, 0, 1);
    }
    if (this.config.duration !== undefined) {
      return clamp(this.elapsed / this.config.duration, 0, 1);
    }
    return 0;
  }
}
