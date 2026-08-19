import { beforeEach, describe, expect, it } from 'vitest';

import { LapTimer } from '../src/race/timing';
import { LIGHT_INTERVAL, SESSION_PRESETS, START_LIGHTS, Session } from '../src/race/session';
import type { SessionConfig, SessionKind } from '../src/race/session';
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

/**
 * A race that is already under way.
 *
 * A race now begins on the grid with the lights filling, and until they
 * go out the session is deliberately inert: the clock does not run,
 * track limits are not policed, and a pit stop is refused. That is the
 * subject of its own describe block below. Every test that is about
 * something else starts past it, because otherwise each one would open
 * with five seconds of waiting that has nothing to do with what it is
 * checking.
 */
/**
 * A session with the player already in it.
 *
 * Nothing in a session runs until `begin()`, because the title card is
 * still up when it is constructed — see the block at the bottom of this
 * file. Every test above that one is about what happens once you are
 * playing, so they all start from here.
 */
const started = (config: SessionConfig): Session => {
  const session = new Session(config);
  session.begin();
  return session;
};

const racing = (overrides: Partial<SessionConfig> = {}): SessionConfig => ({
  ...SESSION_PRESETS.race,
  formationHold: 0,
  ...overrides
});

/** The same, for a session of any other kind. */
const underWay = (kind: SessionKind, overrides: Partial<SessionConfig> = {}): SessionConfig => ({
  ...SESSION_PRESETS[kind],
  formationHold: 0,
  ...overrides
});

describe('practice', () => {
  it('never ends on its own', () => {
    const session = started(underWay('practice'));
    hold(session, 600);
    expect(session.phase).toBe('green');
    expect(session.state(timer).remaining).toBeNull();
  });

  it('reports the best lap as its result', () => {
    const session = started(underWay('practice'));
    lap(session, 40);
    expect(session.result(timer).time).toBeCloseTo(timer.bestLap!.time, 3);
  });
});

describe('qualifying', () => {
  const config = (): SessionConfig => underWay('qualifying', { duration: 120 });

  it('counts down and throws the flag when time is up', () => {
    const session = started(config());
    expect(session.state(timer).remaining).toBeCloseTo(120, 1);

    hold(session, 121);
    expect(session.phase).toBe('chequered');
    expect(session.state(timer).remaining).toBe(0);
  });

  it('lets the lap in progress finish after the flag', () => {
    const session = started(config());
    hold(session, 121);
    expect(session.phase).toBe('chequered');

    // The flag has fallen but the run still counts, as it does in reality.
    lap(session, 60);
    expect(session.phase).toBe('finished');
    expect(timer.history.length).toBe(1);
  });

  it('stops updating once finished', () => {
    const session = started(config());
    hold(session, 121);
    lap(session, 60);
    const frozen = session.elapsed;
    hold(session, 30);
    expect(session.elapsed).toBeCloseTo(frozen, 6);
  });
});

describe('race', () => {
  const config = (): SessionConfig => racing({ laps: 2 });

  it('finishes on the last lap', () => {
    const session = started(config());
    lap(session, 60);
    expect(session.phase).toBe('chequered');
    expect(session.state(timer).lapsDone).toBe(1);

    lap(session, 60);
    expect(session.phase).toBe('finished');
    expect(session.state(timer).lapsDone).toBe(2);
  });

  it('reports elapsed time plus penalties as the result', () => {
    const session = started(config());
    lap(session, 60);
    lap(session, 60);

    const result = session.result(timer);
    expect(result.time).toBeCloseTo(session.elapsed + session.penaltyTime, 6);
  });
});

describe('track limits', () => {
  it('counts one strike per excursion, not per tick', () => {
    const session = started(racing({ strikesAllowed: 5 }));

    hold(session, 1, true);
    hold(session, 3, false); // one long excursion
    hold(session, 1, true);
    expect(session.strikes).toBe(1);

    hold(session, 2, false); // a second, separate one
    hold(session, 1, true);
    expect(session.strikes).toBe(2);
  });

  it('applies a penalty once the allowance is used up', () => {
    const session = started({
      ...racing(),
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
    const session = started(underWay('practice'));
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
    const session = started(racing());
    expect(session.requestPit(40)).toBe(false);
    expect(session.inPitStop).toBe(false);
  });

  it('holds the car for the service time, then releases it', () => {
    const session = started(racing({ pitStopDuration: 22 }));

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
    const session = started(racing({ pitStopDuration: 2 }));
    session.requestPit(0);

    let signals = 0;
    for (let i = 0; i < 120 * 5; i++) {
      session.update(DT, true, null, timer);
      if (session.pitStopJustFinished) signals++;
    }
    expect(signals).toBe(1);
  });

  it('costs the session clock the full stop', () => {
    const session = started(racing({ pitStopDuration: 22 }));
    session.requestPit(0);
    hold(session, 22.5);
    // The clock runs through a stop; that is what makes it a cost.
    expect(session.elapsed).toBeGreaterThan(22);
  });

  it('cannot be stacked', () => {
    const session = started(racing());
    expect(session.requestPit(0)).toBe(true);
    expect(session.requestPit(0)).toBe(false);
  });
});

/**
 * The start.
 *
 * Before this existed a race went green the instant the page finished
 * loading: the clock was already running while the physics was still
 * settling, and the first thing a driver did was discover they were
 * late. What is being pinned here is not the animation but the two
 * facts it stands on — nothing counts until the lights go out, and the
 * lights go out at a time you cannot quite predict.
 */
describe('the start', () => {
  it('holds the race on the grid before it goes green', () => {
    const session = started(SESSION_PRESETS.race);
    expect(session.phase).toBe('formation');
    expect(session.onGrid).toBe(true);

    hold(session, 1);
    // The one thing a start procedure must not do is charge you for it.
    expect(session.elapsed).toBe(0);
    expect(session.state(timer).lapsDone).toBe(0);
  });

  it('fills the lights one a second and puts them all out together', () => {
    const session = started(SESSION_PRESETS.race);
    expect(session.lights).toBe(0);

    /* Sampled in the middle of each light's second rather than on the
       boundary. Stepping at 1/120 s never lands exactly on a multiple
       of 0.9, so a sample taken at the edge reads whichever side the
       accumulated float happens to fall — which would make this test
       fail for a reason that has nothing to do with the lights. */
    const seen: number[] = [];
    let held = 0;
    for (let i = 0; i < START_LIGHTS; i++) {
      // Half a beat after the light is due, so nothing lands on a boundary.
      const target = (i + 1.5) * LIGHT_INTERVAL;
      hold(session, target - held);
      held = target;
      seen.push(session.lights);
    }
    expect(seen).toEqual([1, 2, 3, 4, START_LIGHTS]);

    /* And then all five at once, rather than counting back down. That
       is the grammar of an F1 start: you launch on the extinguishing,
       not on the last lamp of a countdown. */
    hold(session, SESSION_PRESETS.race.formationHold + DT);
    expect(session.phase).toBe('green');
    expect(session.lights).toBe(0);
  });

  it('announces the start exactly once', () => {
    const session = started(SESSION_PRESETS.race);
    let signals = 0;
    for (let i = 0; i < 120 * 12; i++) {
      session.update(DT, true, null, timer);
      if (session.lightsJustWentOut) signals++;
    }
    expect(signals).toBe(1);
  });

  it('refuses a pit stop and ignores track limits on the grid', () => {
    const session = started(SESSION_PRESETS.race);
    // Stationary on its slot, the car passes the speed test for a stop.
    expect(session.requestPit(0)).toBe(false);

    hold(session, 1, false);
    expect(session.strikes).toBe(0);
  });

  it('holds every session on the grid, not just a race', () => {
    /* Practice used to skip the lights on the reasoning that it is for
       going out and driving. That dropped a ten-year-old straight into
       a moving car with no sign that anything had begun — which is the
       exact confusion the phase exists to remove, so every session now
       starts the same way. */
    for (const kind of ['practice', 'qualifying', 'race'] as const) {
      const session = started(SESSION_PRESETS[kind]);
      expect(session.phase, kind).toBe('formation');
      expect(session.onGrid, kind).toBe(true);
      expect(session.formationDuration, kind).toBeGreaterThan(4);
    }
  });

  it('costs the same wherever the hold falls', () => {
    /* The hold is the unpredictable part, so it is a parameter rather
       than a draw inside the class — which is what lets this assert
       that a longer one delays the green and nothing else. */
    const quick = started({ ...SESSION_PRESETS.race, formationHold: 0.2 });
    const slow = started({ ...SESSION_PRESETS.race, formationHold: 2 });

    hold(quick, START_LIGHTS * LIGHT_INTERVAL + 0.3);
    hold(slow, START_LIGHTS * LIGHT_INTERVAL + 0.3);

    expect(quick.phase).toBe('green');
    expect(slow.phase).toBe('formation');
    /* The clock on the quick one is only the time since its own lights
       went out, not the five seconds it spent watching them. */
    expect(quick.elapsed).toBeLessThan(0.2);
  });
});

/**
 * Before anyone is playing.
 *
 * The title card is up when the session is constructed: it asks for
 * fullscreen, it offers a choice of circuit, and until it is tapped
 * nobody is looking at the road. The session used to run anyway, so the
 * five lights counted down behind the card and the race started without
 * the player — tap, and you were already several seconds late off a
 * grid you never saw.
 */
describe('before the player has entered', () => {
  it('runs nothing at all', () => {
    const session = new Session(SESSION_PRESETS.race);
    expect(session.hasBegun).toBe(false);

    hold(session, 20);
    expect(session.phase).toBe('formation');
    expect(session.lights).toBe(0);
    expect(session.elapsed).toBe(0);
  });

  it('holds the car even in a session with no lights', () => {
    /* A session configured without a start procedure goes green
       immediately, so `formation` cannot be what holds it behind the
       title card. The gate has to be its own thing, or the run would be
       under way before anyone had pressed START. */
    const session = new Session(underWay('practice'));
    expect(session.phase).toBe('green');
    expect(session.onGrid).toBe(true);

    hold(session, 5);
    expect(session.elapsed).toBe(0);
  });

  it('starts the lights only once the card is tapped', () => {
    const session = new Session(SESSION_PRESETS.race);
    hold(session, 4);
    expect(session.lights).toBe(0);

    session.begin();
    hold(session, 1.5 * LIGHT_INTERVAL);
    expect(session.lights).toBe(1);
    expect(session.onGrid).toBe(true);
  });
});
