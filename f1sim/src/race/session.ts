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
  /** On the grid, held, with the lights filling. */
  | 'formation'
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
  /**
   * Seconds the gantry waits on four lights before the fifth, or 0 for
   * no start procedure at all.
   *
   * The first four are on a fixed cadence — that is what makes them a
   * countdown you can time your launch against. The wait before the
   * last one is the part that is *not* fixed, which is what stops a
   * start being something you can anticipate exactly. It is a parameter
   * rather than a random draw inside the class so a test can pin it,
   * and so the same session run twice is the same session.
   */
  formationHold: number;
}

/** Lights in the gantry, and the seconds between each coming on. */
export const START_LIGHTS = 5;
export const LIGHT_INTERVAL = 0.9;

/**
 * How many light up as the countdown, before the one that means go.
 *
 * Real Formula 1 fills all five and then extinguishes them, and the
 * extinguishing is the flag. That is the correct grammar and it is not
 * the one used here, deliberately: it only reads as a start signal if
 * you already know the sport, and a ten-year-old watching five lights
 * disappear has been given no signal at all — they have been given the
 * absence of one.
 *
 * So four count down and the fifth is the flag. The tension is
 * identical, because the unpredictable wait now sits before the last
 * lamp rather than after it, and the meaning is legible to someone who
 * has never seen a grand prix: all lit, go.
 */
export const COUNTDOWN_LIGHTS = START_LIGHTS - 1;

export const SESSION_PRESETS: Record<SessionKind, SessionConfig> = {
  practice: {
    kind: 'practice',
    strikesAllowed: 99,
    penaltySeconds: 0,
    pitStopDuration: 12,
    /* Every session starts on the grid, practice included.
     *
     * This used to be zero, on the reasoning that practice is for going
     * out and driving and that five lights in front of it would be
     * ceremony. That was wrong about who is playing. The lights are the
     * one piece of motor racing a child already knows how to read, and
     * a session that skipped them dropped the player straight into a
     * moving car with no idea a race had a beginning — which is
     * precisely the confusion the phase was added to remove. */
    formationHold: 0.8
  },
  qualifying: {
    kind: 'qualifying',
    duration: 12 * 60,
    strikesAllowed: 2,
    penaltySeconds: 5,
    pitStopDuration: 12,
    formationHold: 0.8
  },
  race: {
    kind: 'race',
    laps: 5,
    strikesAllowed: 2,
    penaltySeconds: 5,
    pitStopDuration: 22,
    formationHold: 0.8
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
  /** Lights showing on the gantry, 0..5. Zero once they go out. */
  lights: number;
}

export class Session {
  readonly config: SessionConfig;

  phase: SessionPhase;
  elapsed = 0;
  strikes = 0;
  penalties = 0;
  pitStops = 0;

  /** Seconds since the car was released onto the grid. */
  private formationElapsed = 0;

  /**
   * Whether the player is actually here yet.
   *
   * The session used to begin the moment it was constructed, which is
   * some way before anyone is looking at it: the title card is still
   * up, asking to be tapped for fullscreen and offering a choice of
   * circuit. Behind it the lights were already counting down, so by the
   * time you tapped, the start had happened without you.
   *
   * Nothing runs until `begin()`. That is a stronger claim than the
   * formation phase makes — the formation phase says *the race has not
   * started*, this says *the session has not*, and a practice run with
   * no lights at all needs the second one just as much.
   */
  private started = false;

  /** Set for one tick when the lights go out, so a start can be heard. */
  lightsJustWentOut = false;

  /** Seconds left of a stop in progress; null when not in the pits. */
  pitTimeRemaining: number | null = null;

  /** Set for one tick when a stop finishes, so fresh tyres can be fitted. */
  pitStopJustFinished = false;

  private wasOnTrack = true;
  /** Guard so one long excursion counts as a single strike. */
  private strikeArmed = true;

  constructor(config: SessionConfig) {
    this.config = config;
    this.phase = config.formationHold > 0 ? 'formation' : 'green';
  }

  /** Total length of the start procedure (s). */
  get formationDuration(): number {
    return this.config.formationHold > 0
      ? COUNTDOWN_LIGHTS * LIGHT_INTERVAL + this.config.formationHold
      : 0;
  }

  /**
   * Lights showing, 0..5.
   *
   * Four fill on a fixed cadence, then the gantry waits, then the fifth
   * comes on and the car is released in the same instant. All five lit
   * *is* the flag — see `COUNTDOWN_LIGHTS` for why this is deliberately
   * not what Formula 1 does.
   *
   * They stay lit once the session is green, because the signal is the
   * lamp being on. The gantry is taken off screen a moment later by the
   * UI rather than being switched off here, which would read as the
   * start being cancelled.
   */
  get lights(): number {
    if (!this.started) return 0;
    if (this.phase !== 'formation') return START_LIGHTS;
    return Math.min(
      COUNTDOWN_LIGHTS,
      Math.floor(this.formationElapsed / LIGHT_INTERVAL)
    );
  }

  /** True while the car must be held on its grid slot. */
  get onGrid(): boolean {
    return !this.started || this.phase === 'formation';
  }

  /** True once the player has entered — the gantry has nothing to say
      before this, and neither has the clock. */
  get hasBegun(): boolean {
    return this.started;
  }

  /**
   * The player is here. Called from the tap that dismisses the title
   * card, which is the first moment anyone is actually watching.
   */
  begin(): void {
    this.started = true;
  }

  /**
   * Advance the session.
   *
   * @param onTrack  whether the car is inside the white lines
   * @param lapDone  the lap completed this tick, if any
   */
  update(dt: number, onTrack: boolean, lapDone: CompletedLap | null, timer: LapTimer): void {
    this.pitStopJustFinished = false;
    this.lightsJustWentOut = false;
    // Nothing at all happens behind the title card — not the lights,
    // not the clock, not track limits.
    if (!this.started) return;
    if (this.phase === 'finished') return;

    /* The grid.
     *
     * `elapsed` deliberately does not advance here, and that is the
     * whole point of the phase existing: the session used to go green
     * the instant the page finished loading, so the clock was already
     * running while the physics was still settling and the driver was
     * still working out which way the car faced. A race now starts when
     * the lights go out, which is both correct and the only way the
     * first lap time means anything. */
    if (this.phase === 'formation') {
      this.formationElapsed += dt;
      if (this.formationElapsed >= this.formationDuration) {
        this.phase = 'green';
        this.lightsJustWentOut = true;
      }
      return;
    }

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
    /* Nor on the grid. A stationary car on its slot passes the speed
       test below, so without this the whole field could take its stop
       before the lights went out — and the clock, which is not running
       yet, would charge nothing for it. */
    if (this.phase === 'formation') return false;
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
      pitStops: this.pitStops,
      lights: this.lights
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
