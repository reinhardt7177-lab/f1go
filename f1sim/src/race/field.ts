/**
 * The rest of the grid.
 *
 * A race needs someone to race. The simulation models one car properly —
 * a rigid body on four raycast wheels — and putting nine more of those
 * in the world would multiply the physics cost by ten to produce
 * opponents the player mostly sees from behind.
 *
 * So rivals are run along the racing line instead, at a fraction of the
 * speed profile the line is worth. That profile already knows what
 * every corner on the circuit can be taken at, because it is the same
 * one the autopilot drives to; a rival is therefore not following a
 * scripted path so much as driving the same solution the AI does, less
 * well. Give one a pace of 0.96 and it takes Eau Rouge four per cent
 * below the limit, all the way round, which is what a slightly slower
 * driver looks like.
 *
 * What this deliberately does not model is contact. Rivals do not
 * collide with the player or with each other — they are traffic to be
 * judged and passed, not objects to lean on. Making them physical is a
 * later problem and a much larger one.
 */
import { vec3 } from '../core/math';
import type { Vec3 } from '../core/math';
import type { RacingLine } from '../ai/racingline';
import type { SpeedProfile } from '../ai/speedprofile';

export interface Rival {
  readonly name: string;
  readonly colour: string;
  /** Fraction of the racing line's own speed this driver manages. */
  readonly pace: number;
  /** Distance along the centreline, metres. */
  distance: number;
  /** Laps completed. */
  lap: number;
  /** Current speed, m/s — for the gap readout and for the renderer. */
  speed: number;
  /** Where it is now, and which way it points. */
  position: Vec3;
  heading: number;
  /** Set once it takes the flag, so a finisher stops being overtaken. */
  finishedAt: number | null;
}

const NAMES = [
  'VERGARA', 'ANDERSSON', 'KIM', 'ROSSI', 'DUBOIS',
  'NAKAMURA', 'SILVA', 'MULLER', 'OKONKWO'
];

/* Paint rather than highlighter: these are read as a tint over a plain
   white car, so a fully saturated value comes back glowing. */
const COLOURS = [
  '#0f6b46', '#a8161d', '#c25410', '#1c4a9c', '#5b4a9e',
  '#b08a12', '#127d92', '#9c2450', '#4f6b28'
];

export interface FieldOptions {
  /** How many rivals. Nine makes a twenty-car grid look like ten. */
  count?: number;
  /** Fastest and slowest rival, as fractions of the line's own pace. */
  fastest?: number;
  slowest?: number;
  /** Metres between cars on the grid. */
  gridGap?: number;
}

export class Field {
  readonly rivals: Rival[] = [];
  private readonly lapLength: number;

  constructor(
    private readonly line: RacingLine,
    private readonly profile: SpeedProfile,
    lapLength: number,
    options: FieldOptions = {}
  ) {
    this.lapLength = lapLength;
    const count = options.count ?? 9;
    const fastest = options.fastest ?? 0.99;
    const slowest = options.slowest ?? 0.90;
    const gap = options.gridGap ?? 14;

    for (let i = 0; i < count; i++) {
      const t = count === 1 ? 0 : i / (count - 1);
      this.rivals.push({
        name: NAMES[i % NAMES.length]!,
        colour: COLOURS[i % COLOURS.length]!,
        pace: fastest + (slowest - fastest) * t,
        /* Ahead of the player, who starts last — the whole race is then
           about getting through them rather than defending a lead
           handed over at the lights. */
        distance: (count - i) * gap,
        lap: 1,
        speed: 0,
        position: vec3(0, 0, 0),
        heading: 0,
        finishedAt: null
      });
    }
  }

  /**
   * @param dt        seconds
   * @param raceTime  elapsed session time, for recording finishes
   * @param totalLaps null in practice, where nobody finishes
   */
  update(dt: number, raceTime: number, totalLaps: number | null): void {
    for (const rival of this.rivals) {
      if (rival.finishedAt !== null) continue;

      /* The line's speed at this point, scaled by how good this driver
         is. Sampling a little ahead rather than underfoot is what stops
         a rival braking at the apex instead of before it. */
      const target = this.profile.lookahead(rival.distance, 30) * rival.pace;
      /* Ease toward it rather than snapping: a rival that changed speed
         instantly would close and open gaps in single frames, which
         reads as teleporting when you are following one. */
      rival.speed += (target - rival.speed) * Math.min(1, dt * 2.5);

      const before = rival.distance;
      rival.distance += rival.speed * dt;
      if (rival.distance >= this.lapLength) {
        rival.distance -= this.lapLength;
        rival.lap += 1;
        if (totalLaps !== null && rival.lap > totalLaps) {
          rival.finishedAt = raceTime;
        }
      }
      void before;

      const p = this.line.pointAt(rival.distance);
      /* Heading from a short step along the line, which keeps a rival
         pointing where it is going through a corner rather than where
         the centreline happens to aim. */
      const ahead = this.line.pointAt((rival.distance + 4) % this.lapLength);
      rival.position = p;
      rival.heading = Math.atan2(ahead.x - p.x, -(ahead.z - p.z));
    }
  }

  /** Total distance covered, for ordering the field. */
  private covered(rival: Rival): number {
    if (rival.finishedAt !== null) {
      /* Finishers rank by when they took the flag and always ahead of
         anyone still running. */
      return Number.MAX_SAFE_INTEGER - rival.finishedAt;
    }
    return (rival.lap - 1) * this.lapLength + rival.distance;
  }

  /**
   * Where the player sits, 1-based.
   *
   * @param playerLap       laps completed, 1-based like the rivals'
   * @param playerDistance  metres into the current lap
   * @param playerFinished  session time at the flag, or null
   */
  positionOf(playerLap: number, playerDistance: number, playerFinished: number | null): number {
    const mine = playerFinished !== null
      ? Number.MAX_SAFE_INTEGER - playerFinished
      : (playerLap - 1) * this.lapLength + playerDistance;
    let ahead = 0;
    for (const rival of this.rivals) if (this.covered(rival) > mine) ahead++;
    return ahead + 1;
  }

  /** Everyone in finishing order, player included, for the results. */
  classification(
    playerLap: number,
    playerDistance: number,
    playerFinished: number | null
  ): { name: string; player: boolean }[] {
    const rows = this.rivals.map((r) => ({
      name: r.name,
      player: false,
      covered: this.covered(r)
    }));
    rows.push({
      name: 'YOU',
      player: true,
      covered: playerFinished !== null
        ? Number.MAX_SAFE_INTEGER - playerFinished
        : (playerLap - 1) * this.lapLength + playerDistance
    });
    rows.sort((a, b) => b.covered - a.covered);
    return rows.map(({ name, player }) => ({ name, player }));
  }

  /** The car immediately ahead on the road, for the gap readout. */
  gapAhead(playerLap: number, playerDistance: number): number | null {
    const mine = (playerLap - 1) * this.lapLength + playerDistance;
    let best: number | null = null;
    for (const rival of this.rivals) {
      const d = this.covered(rival) - mine;
      if (d > 0 && (best === null || d < best)) best = d;
    }
    return best;
  }
}
