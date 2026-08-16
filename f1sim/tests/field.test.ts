import { describe, expect, it } from 'vitest';

import { RacingLine, defaultRacingLineOptions } from '../src/ai/racingline';
import { SpeedProfile, defaultProfileOptions } from '../src/ai/speedprofile';
import { Field } from '../src/race/field';
import { POINTS } from '../src/race/championship';
import { defaultVehicleParams } from '../src/sim/vehicle';
import { getCircuit } from '../src/track/circuits';

const circuit = getCircuit('monza');
const line = new RacingLine(circuit, defaultRacingLineOptions());
const profile = new SpeedProfile(line, defaultVehicleParams(), defaultProfileOptions());

const makeField = () => new Field(line, profile, circuit.length);

describe('the field', () => {
  it('lines up ahead of the player', () => {
    // The player starts last: the race is then about getting through
    // the field rather than defending a lead handed over at the lights.
    const field = makeField();
    for (const rival of field.rivals) expect(rival.distance).toBeGreaterThan(0);
    expect(field.positionOf(1, 0, null)).toBe(field.rivals.length + 1);
  });

  it('gives every rival a different pace', () => {
    const paces = makeField().rivals.map((r) => r.pace);
    expect(new Set(paces).size).toBe(paces.length);
    for (const p of paces) {
      expect(p).toBeGreaterThan(0.5);
      expect(p).toBeLessThanOrEqual(1);
    }
  });

  it('drives them round at something like a racing speed', () => {
    const field = makeField();
    for (let i = 0; i < 60 * 30; i++) field.update(1 / 60, i / 60, null);
    for (const rival of field.rivals) {
      // Half a minute of Monza is a good chunk of a lap, and nobody
      // should be crawling or teleporting.
      expect(rival.speed).toBeGreaterThan(20);
      expect(rival.speed).toBeLessThan(120);
      expect(Number.isFinite(rival.position.x)).toBe(true);
    }
  });

  it('orders the field by pace once they are running', () => {
    const field = makeField();
    for (let i = 0; i < 60 * 120; i++) field.update(1 / 60, i / 60, null);
    const byPace = [...field.rivals].sort((a, b) => b.pace - a.pace);
    const covered = (r: (typeof field.rivals)[number]) =>
      (r.lap - 1) * circuit.length + r.distance;
    // The quickest driver should be leading the others after two
    // minutes; if pace does not decide the order it means nothing.
    expect(covered(byPace[0]!)).toBeGreaterThan(covered(byPace[byPace.length - 1]!));
  });

  it('counts laps and retires them at the flag', () => {
    const field = makeField();
    for (let i = 0; i < 60 * 600; i++) field.update(1 / 60, i / 60, 1);
    // One lap of Monza takes well under ten minutes at any pace.
    for (const rival of field.rivals) expect(rival.finishedAt).not.toBeNull();
  });

  it('puts a finisher ahead of anyone still running', () => {
    const field = makeField();
    for (let i = 0; i < 60 * 600; i++) field.update(1 / 60, i / 60, 1);
    // Everyone has finished; a player still on lap one is last.
    expect(field.positionOf(1, 0, null)).toBe(field.rivals.length + 1);
  });

  it('classifies the player among the rivals', () => {
    const field = makeField();
    const order = field.classification(1, 0, null);
    expect(order).toHaveLength(field.rivals.length + 1);
    expect(order.filter((r) => r.player)).toHaveLength(1);
    // Started last, so last until something happens.
    expect(order[order.length - 1]!.player).toBe(true);
  });

  it('reports a gap to the car ahead, and none when leading', () => {
    const field = makeField();
    expect(field.gapAhead(1, 0)).toBeGreaterThan(0);
    // A player a full lap up has nobody in front.
    expect(field.gapAhead(3, 0)).toBeNull();
  });
});

describe('championship points', () => {
  it('awards the F1 allocation down to tenth', () => {
    expect(POINTS).toEqual([25, 18, 15, 12, 10, 8, 6, 4, 2, 1]);
    expect(POINTS[0]! - POINTS[1]!).toBe(7);
  });
});
