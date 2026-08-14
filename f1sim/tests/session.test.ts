import { beforeEach, describe, expect, it } from 'vitest';

import { LapTimer } from '../src/race/timing';
import { SESSION_PRESETS, Session } from '../src/race/session';
import type { SessionConfig } from '../src/race/session';
import { getCircuit } from '../src/track/circuits';

const circuit = getCircuit('proving');
const DT = 1 / 120;

let timer: LapTimer;

beforeEach(() => {
  timer = new LapTimer(circuit);
  timer.update(0, true, DT);
});

/** Drive the timer round the lap at a constant speed. */
const lap = (session: Session, speed: number, onTrack = true): void => {
  const steps = Math.ceil(circuit.length / (speed * DT));
  for (let i = 0; i < steps; i++) {
    const s = ((i + 1) * speed * DT) % circuit.length;
    const done = timer.update(s, onTrack, DT);
    session.update(DT, onTrack, done, timer);
  }
};

const hold = (session: Session, seconds: number, onTrack = true): void => {
  for (let i = 0; i < seconds / DT; i++) session.update(DT, onTrack, null, timer);
};

describe('practice', () => {
  it('never ends on its own', () => {
    const session = new Session(SESSION_PRESETS.practice);
    hold(session, 600);
    expect(session.phase).toBe('green');
    expect(session.state(timer).remaining).toBeNull();
  });

  it('reports the best lap as its result', () => {
    const session = new Session(SESSION_PRESETS.practice);
    lap(session, 40);
    expect(session.result(timer).time).toBeCloseTo(timer.bestLap!.time, 3);
  });
});

describe('qualifying', () => {
  const config = (): SessionConfig => ({ ...SESSION_PRESETS.qualifying, duration: 120 });

  it('counts down and throws the flag when time is up', () => {
    const session = new Session(config());
    expect(session.state(timer).remaining).toBeCloseTo(120, 1);

    hold(session, 121);
    expect(session.phase).toBe('chequered');
    expect(session.state(timer).remaining).toBe(0);
  });

  it('lets the lap in progress finish after the flag', () => {
    const session = new Session(config());
    hold(session, 121);
    expect(session.phase).toBe('chequered');

    // The flag has fallen but the run still counts, as it does in reality.
    lap(session, 60);
    expect(session.phase).toBe('finished');
    expect(timer.history.length).toBe(1);
  });

  it('stops updating once finished', () => {
    const session = new Session(config());
    hold(session, 121);
    lap(session, 60);
    const frozen = session.elapsed;
    hold(session, 30);
    expect(session.elapsed).toBeCloseTo(frozen, 6);
  });
});

describe('race', () => {
  const config = (): SessionConfig => ({ ...SESSION_PRESETS.race, laps: 2 });

  it('finishes on the last lap', () => {
    const session = new Session(config());
    lap(session, 60);
    expect(session.phase).toBe('chequered');
    expect(session.state(timer).lapsDone).toBe(1);

    lap(session, 60);
    expect(session.phase).toBe('finished');
    expect(session.state(timer).lapsDone).toBe(2);
  });

  it('reports elapsed time plus penalties as the result', () => {
    const session = new Session(config());
    lap(session, 60);
    lap(session, 60);

    const result = session.result(timer);
    expect(result.time).toBeCloseTo(session.elapsed + session.penaltyTime, 6);
  });
});

describe('track limits', () => {
  it('counts one strike per excursion, not per tick', () => {
    const session = new Session({ ...SESSION_PRESETS.race, strikesAllowed: 5 });

    hold(session, 1, true);
    hold(session, 3, false); // one long excursion
    hold(session, 1, true);
    expect(session.strikes).toBe(1);

    hold(session, 2, false); // a second, separate one
    hold(session, 1, true);
    expect(session.strikes).toBe(2);
  });

  it('applies a penalty once the allowance is used up', () => {
    const session = new Session({
      ...SESSION_PRESETS.race,
      strikesAllowed: 1,
      penaltySeconds: 5
    });

    for (let i = 0; i < 3; i++) {
      hold(session, 0.5, true);
      hold(session, 0.5, false);
    }
    hold(session, 0.5, true);

    expect(session.strikes).toBe(3);
    expect(session.penalties).toBe(2);
    expect(session.penaltyTime).toBe(10);
  });

  it('leaves practice unpunished', () => {
    const session = new Session(SESSION_PRESETS.practice);
    for (let i = 0; i < 5; i++) {
      hold(session, 0.5, true);
      hold(session, 0.5, false);
    }
    expect(session.strikes).toBe(5);
    expect(session.penalties).toBe(0);
  });
});

describe('pit stops', () => {
  it('is refused while the car is moving', () => {
    const session = new Session(SESSION_PRESETS.race);
    expect(session.requestPit(40)).toBe(false);
    expect(session.inPitStop).toBe(false);
  });

  it('holds the car for the service time, then releases it', () => {
    const session = new Session({ ...SESSION_PRESETS.race, pitStopDuration: 22 });

    expect(session.requestPit(1)).toBe(true);
    expect(session.inPitStop).toBe(true);

    hold(session, 10);
    expect(session.inPitStop).toBe(true);
    expect(session.pitTimeRemaining).toBeGreaterThan(0);

    hold(session, 13);
    expect(session.inPitStop).toBe(false);
    expect(session.pitStops).toBe(1);
  });

  it('signals exactly once so tyres are fitted once', () => {
    const session = new Session({ ...SESSION_PRESETS.race, pitStopDuration: 2 });
    session.requestPit(0);

    let signals = 0;
    for (let i = 0; i < 120 * 5; i++) {
      session.update(DT, true, null, timer);
      if (session.pitStopJustFinished) signals++;
    }
    expect(signals).toBe(1);
  });

  it('costs the session clock the full stop', () => {
    const session = new Session({ ...SESSION_PRESETS.race, pitStopDuration: 22 });
    session.requestPit(0);
    hold(session, 22.5);
    // The clock runs through a stop; that is what makes it a cost.
    expect(session.elapsed).toBeGreaterThan(22);
  });

  it('cannot be stacked', () => {
    const session = new Session(SESSION_PRESETS.race);
    expect(session.requestPit(0)).toBe(true);
    expect(session.requestPit(0)).toBe(false);
  });
});
