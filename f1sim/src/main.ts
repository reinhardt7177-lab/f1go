/**
 * Composition root — the one place where simulation, rendering, input
 * and UI are allowed to know about each other.
 */
import './style.css';

import { FixedLoop } from './core/loop';
import { InputManager } from './input/controls';
import { CAMERA_LABELS, SceneRenderer } from './render/scene';
import type { CameraMode } from './render/scene';
import { driverAids, initialAssistState, tractionControl } from './sim/assists';
import { RL, RR } from './sim/types';
import { defaultVehicleParams } from './sim/vehicle';
import { SimWorld, defaultBarrier, initPhysics } from './sim/world';
import { CIRCUIT_SPECS } from './track/circuits';
import { Driver, driveWorld } from './ai/driver';
import { RacingLine } from './ai/racingline';
import { SpeedProfile } from './ai/speedprofile';
import { SESSION_PRESETS, Session } from './race/session';
import type { SessionKind } from './race/session';
import { Field } from './race/field';
import { recordLap, score, standings } from './race/championship';
import {
  GhostRecorder,
  ghostTimeAtDistance,
  loadGhost,
  sampleGhost,
  saveGhost
} from './race/ghost';
import type { GhostLap } from './race/ghost';
import { ResultsPanel } from './ui/results';
import { DeltaPanel } from './ui/delta';
import { PositionPanel } from './ui/position';
import { Hud } from './ui/hud';
import { RivalLabels } from './ui/labels';
import { SpeedLines } from './ui/speedlines';
import { StartLights } from './ui/lights';
import { OvertakeNotice } from './ui/overtake';
import { EasyMode } from './ui/easymode';
import { Minimap } from './ui/minimap';
import { SessionPanel } from './ui/session';
import { SettingsPanel } from './ui/settings';
import { TimingPanel } from './ui/timing';
import { AidsPanel, SlidersPanel, TuningPanel } from './ui/tuning';
import { KeepAwake, ViewportWatcher } from './ui/screen';
import { TouchPads } from './ui/touchpads';
import { ViewportManager, isCoarsePointer } from './ui/viewport';

const boot = async (): Promise<void> => {
  const status = document.getElementById('status')!;
  status.textContent = 'loading physics…';

  await initPhysics();

  const canvas = document.getElementById('view') as HTMLCanvasElement;
  const overlay = document.getElementById('overlay')!;

  const params = defaultVehicleParams();

  // Circuit comes from the URL for the same reason the session does: a
  // particular run is then a link, which is the only sharing mechanism
  // a static site has.
  const query = new URLSearchParams(location.search);
  const askedCircuit = query.get('circuit');
  const circuitId = askedCircuit && askedCircuit in CIRCUIT_SPECS ? askedCircuit : 'oval';
  const world = new SimWorld(params, { circuitId });
  const renderer = new SceneRenderer(canvas, world.geometry, params, world.circuit);
  /* The touch layer listens on the canvas so drags never fight the
     panels, which keep their own pointer events. The on-screen buttons
     are handed to it so it can keep the pedals out of their footprint —
     measured from these elements rather than declared as a constant, so
     the dead zone follows them through the portrait-to-landscape
     reflow. See `input/zones.ts`. */
  const reserve = [
    'touch-buttons',
    'btn-fullscreen'
  ]
    .map((id) => document.getElementById(id))
    .filter((el): el is HTMLElement => el !== null);

  const input = new InputManager(window, {}, canvas, { reserve });
  const hud = new Hud(document.body);

  /* Which device this is, said out loud on the body, so a panel can ask
     without every one of them re-running a media query. */
  document.body.classList.toggle('touch', isCoarsePointer());

  /* The pads a phone player steers and brakes with. The touch layer has
     reported where each thumb landed since it was written and nothing
     had ever drawn it, so a relative steering pad had no centre on
     screen and an analogue throttle had no travel on screen. */
  const touchPads = new TouchPads(document.body);

  /* A phone dims and locks after a minute of two thumbs the OS cannot
     see, and reports the wrong viewport size for a fifth of a second
     after every rotation. Both are handled here rather than by the
     renderer, which should not have to know what a URL bar is. */
  new KeepAwake();
  new ViewportWatcher(() => {
    renderer.resize();
    touchPads.resize();
  });

  // The left column is the timing tower and what is read against it.
  // The right one carries the settings, and only while they are open.
  const left = document.createElement('div');
  left.className = 'stack';
  overlay.appendChild(left);

  // Session kind is chosen from the URL so a run can be linked to:
  // ?session=qualifying, ?session=race. Practice by default.
  const requested = query.get('session') as SessionKind | null;
  const kind: SessionKind =
    requested && requested in SESSION_PRESETS ? requested : 'practice';
  const session = new Session(SESSION_PRESETS[kind]);
  /* A time trial is you and your own best lap: no field, no contact, and
     a delta instead of a position. */
  const timeTrial = kind === 'timetrial';
  document.body.classList.toggle('timetrial', timeTrial);

  /* Fullscreen, landscape lock and the rotate prompt — and the tap that
     dismisses the title card, which is what starts the session.
     Constructed after the session rather than before it because that
     tap is the session's own beginning: until someone has asked to
     play, the grid stays held and the lights stay dark. */
  new ViewportManager(() => session.begin());

  // Session first: which session is running and how much of it is left is
  // the context everything below is read against.
  const sessionPanel = new SessionPanel(left);
  const timing = new TimingPanel(left, world.circuit);
  const positionPanel = new PositionPanel(left);
  const deltaPanel = new DeltaPanel(left);
  if (!timeTrial) deltaPanel.disable();

  // Driver aids shape the controls before they reach the car; the
  // vehicle model never knows they exist.
  const assist = initialAssistState();
  const aids = { tractionControl: true, autopilot: false, easy: true };

  // The AI produces the same ControlState the keyboard does, so nothing
  // downstream can tell which is driving.
  status.textContent = 'building racing line…';
  const racingLine = new RacingLine(world.circuit);
  const speedProfile = new SpeedProfile(racingLine, params);
  const driver = new Driver(racingLine, speedProfile, params);

  /* The car is drawn rather than loaded.
   *
   * `assets/car.glb` is eleven thousand triangles of photographic
   * detail, which is the wrong input to a renderer whose whole
   * proposition is flat colour inside a black line: the line traces
   * every duct and the result reads as a model someone has outlined.
   * `render/carbody.ts` draws one instead, from the chassis the
   * simulation is actually driving, and the rivals are built from the
   * same geometry — so the grid is ten of one car rather than one
   * detailed car being chased by nine crude ones.
   *
   * The model is still there and still fits: `?car=model` loads it, for
   * anyone who wants to compare or to take the drawing back out. */
  const chassis = params.chassis;
  if (query.get('car') === 'model') {
    void renderer
      .useCarModel('assets/car.glb', {
        wheelbase: chassis.wheelbase,
        axleMidZ: chassis.wheelbase * (chassis.frontWeightBias - 0.5),
        wheelCentreY: chassis.hardpointY - params.suspension.restLength,
        wheelRadius: chassis.wheelRadius
      })
      .catch((e) => console.warn('[render] car model unavailable:', e));
  }

  /* The rest of the grid. Sharing the racing line and speed profile the
     autopilot uses means a rival is driving the same solution, less
     well, rather than following a script laid alongside it. */
  const field = new Field(racingLine, speedProfile, world.circuit.length);
  /* And now they are drawn. The field has produced a position, a
     heading and a colour for every rival since it was written; until
     this line nothing read them, so the race was scored over an empty
     circuit. */
  /* ------------------------------------------------------------------
     The ghost.

     It is a `Rival` and nothing more, which is the whole trick: made to
     satisfy that shape it inherits `render/rivals.ts`, the name labels
     and the minimap without one line of new drawing code. What it never
     joins is `world.traffic` — a ghost is a record of a lap, not a car,
     and driving through it is correct.
     ------------------------------------------------------------------ */
  let ghostLap: GhostLap | null = timeTrial ? loadGhost(circuitId) : null;
  const ghostRecorder = new GhostRecorder();

  const ghostCar = {
    name: '고스트',
    /* Pale, and flat like everything else. A translucent car would need
       `transparent: true` and no depth write, which with an inverted-hull
       outline round it produces a grey smear — the outline exists to give
       a hard silhouette and transparency is the one thing that takes it
       away. A car drawn in one pale value reads as a drawing of a car,
       which is exactly what a ghost is. */
    colour: '#cfd8e2',
    pace: 1,
    distance: 0,
    lap: 0,
    speed: 0,
    position: { x: 0, y: -500, z: 0 },
    heading: 0,
    finishedAt: null,
    gridLateral: 0
  };
  /** Drawn cars: the ghost alone in a time trial, the field otherwise. */
  const drawn = timeTrial ? [ghostCar] : field.rivals;
  /** True while the ghost has a lap to show and has not run out of it. */
  let ghostVisible = false;
  /** Last lap number seen, so a line crossing can clear the recorder. */
  let lastTimedLap = 0;

  renderer.setField(drawn);
  const rivalLabels = new RivalLabels(document.body, drawn);
  const results = new ResultsPanel(document.body);
  let scored = false;

  // Speed lines sit over the canvas and under the panels; the HUD is
  // already mounted on the body, so this goes with it.
  const speedLines = new SpeedLines(document.body);
  const startLights = new StartLights(document.body);
  const overtakeNotice = new OvertakeNotice(document.body);
  /* The settings drawer. Closed by default — a first-time player must
     not have to dismiss a panel before they can drive — and it now holds
     only things you can *change*, the readouts having gone with
     `ui/telemetry.ts` and `ui/setup-status.ts`. */
  const settings = new SettingsPanel(document.body);
  /* Where everyone is on the circuit. The cockpit can only show the two
     hundred metres in front of you, which is not enough to know whether
     the car you are chasing is about to reach a corner or has already
     cleared it. */
  const minimap = new Minimap(document.body, world.circuit);

  // Right-hand column: the controls that shape the car.
  const right = document.createElement('div');
  right.className = 'stack right';
  overlay.appendChild(right);

  const tuning = new TuningPanel(right, params);

  /* The two aids live in their own panel rather than inside the car
     setup, because a phone hides the setup and these are exactly the
     switches a phone player wants. */
  const aidsPanel = new AidsPanel(right, [
    {
      label: '트랙션 컨트롤',
      note:
        '1단은 뒷타이어가 버틸 수 있는 것보다 훨씬 큰 추진력을 냅니다. ' +
        '정지 상태에서 풀스로틀은 곧 휠스핀이라, 꺼 보면 이유를 알 수 있습니다.',
      get: () => aids.tractionControl,
      set: (v) => {
        aids.tractionControl = v;
        assist.throttleLimit = 1;
      }
    },
    {
      label: 'AI 주행',
      note:
        '레이싱 라인과 속도 프로파일을 따라 AI가 대신 운전합니다. ' +
        '스핀하면 스스로 코스에 복귀합니다.',
      get: () => aids.autopilot,
      set: (v) => {
        aids.autopilot = v;
        driver.reset();
      }
    }
  ]);

  // Steering feel gets its own panel: it is the setting a phone player
  // most needs, because a thumb on glass is the input it compensates for.
  const steeringPanel = new SlidersPanel(
    right,
    '조향 설정',
    [
      {
        group: '조향',
        label: '조향 감도',
        note:
          '조향 최대 각도에 곱해지는 값입니다. 차가 너무 예민하면 낮추고, ' +
          '코너에서 안 돌면 올리세요.',
        min: 0.35,
        max: 1,
        step: 0.01,
        scale: 100,
        unit: '%',
        get: () => input.options.steerSensitivity,
        set: (v) => (input.options.steerSensitivity = v)
      },
      {
        group: '조향',
        label: '응답 곡선',
        note:
          '1이면 직선 비례입니다. 값을 올릴수록 중앙 부근이 무뎌지고 ' +
          '끝으로 갈수록 급해집니다 — 작은 수정이 쉬워지는 대신 반응이 느려집니다.',
        min: 1,
        max: 2.6,
        step: 0.05,
        get: () => input.options.steerExpo,
        set: (v) => (input.options.steerExpo = v)
      }
    ],
    'steering'
  );

  /* Easy mode, and the one place everything it changes is written down.
   *
   * Built after `steeringPanel` on purpose: the constructor applies the
   * stored choice immediately, and that reaches in to refresh the
   * steering sliders. Without the refresh the expo slider would show
   * the old number and — worse — the next drag of it would write that
   * stale value back, silently undoing easy mode. */
  const applyEasy = (on: boolean): void => {
    aids.easy = on;
    world.car.gripBoost = on ? 1.25 : 1;
    world.car.tireStartTemp = on ? params.thermal.optimalTemp : null;
    /* Reshaped, not cut. A softer curve means half travel asks for less
       lock; `steerSensitivity` is deliberately untouched, because at 50
       km/h the grip-limited corner genuinely needs almost full lock and
       trimming it there is what makes a car feel disconnected. */
    input.options.steerExpo = on ? 1.9 : 1.6;
    input.options.steerRampTime = on ? 0.45 : 0.34;
    assist.throttleLimit = 1;
    assist.steerLimit = 1;
    assist.stabilityTorque = 0;
    world.car.stabilityTorque = 0;
    steeringPanel.refresh();
  };
  const easyMode = new EasyMode(document.body, applyEasy);

  /* The first set of tyres was fitted by the world's constructor, before
     easy mode existed to say how warm they should be. */
  world.car.fitFreshTires();

  /* And the player into their grid box rather than onto the centreline.
     They start last, so the box is on whichever side the alternating
     order leaves free — otherwise the player is parked squarely behind
     the car in front instead of beside it. Every session, not just a
     race: the title card orbits this car, and a grid is what it should
     be sitting on. */
  {
    const slot = world.gridSlot(0, field.playerGridLateral);
    world.car.reset(slot.position, slot.heading);
  }

  /* And the circuit gets edges. The wall the player sees is drawn by the
     renderer and is deliberately not in the collider — this is what
     actually keeps the car in, by leaning on it rather than blocking
     it. On in both modes: a car vanishing into the scenery was never
     wanted in either. */
  world.barrier = defaultBarrier();

  status.remove();

  // Circuit picker. Choosing one reloads rather than rebuilding in
  // place: the collider, the track mesh, the racing line and the speed
  // profile are all built from the circuit at boot, and swapping them
  // live would mean tearing down and re-creating most of the app for a
  // choice made once at the start.
  const picker = document.getElementById('circuit-picker');
  if (picker) {
    for (const [id, spec] of Object.entries(CIRCUIT_SPECS)) {
      if (id === 'proving') continue; // a test instrument, not a circuit
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = spec.name;
      btn.className = id === circuitId ? 'on' : '';
      // Both events, because the start card behind this listens for
      // `click` — stopping only the pointerdown still lets the card
      // swallow the tap and dismiss itself under the finger.
      btn.addEventListener('click', (e) => e.stopPropagation());
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (id === circuitId) return;
        query.set('circuit', id);
        location.search = query.toString();
      });
      picker.appendChild(btn);
    }
  }

  /* And which session. It was `?session=` only, which is a URL a phone
     player never sees — so the two modes that exist for them, a lap on
     your own against your best and a race against the field, were one of
     them unreachable and the other undiscoverable. Same reload-rather-
     than-rebuild rule as the circuit: the field, the ghost and the
     session config are all decided at boot. */
  const MODES: [string, string][] = [
    ['practice', '연습'],
    ['timetrial', '타임 트라이얼'],
    ['race', '레이스']
  ];
  const modePicker = document.getElementById('mode-picker');
  if (modePicker) {
    for (const [id, label] of MODES) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = label;
      btn.className = id === kind ? 'on' : '';
      btn.addEventListener('click', (e) => e.stopPropagation());
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (id === kind) return;
        query.set('session', id);
        location.search = query.toString();
      });
      modePicker.appendChild(btn);
    }
  }

  // The camera has to be reachable without a keyboard, so the button and
  // the key both go through the renderer's own cycle — keeping the mode
  // in one place means the cockpit's visibility can never disagree with
  // where the camera actually is.
  const cameraBtn = document.getElementById('btn-camera')!;
  const showCamera = (mode: CameraMode): void => {
    cameraBtn.textContent = CAMERA_LABELS[mode];
  };
  showCamera(renderer.cameraMode);

  cameraBtn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    showCamera(renderer.cycleCamera());
  });

  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyC') showCamera(renderer.cycleCamera());
    // A stop is only granted when the car is close to stationary, which
    // stands in for a pit lane until there is one.
    if (e.code === 'KeyP') session.requestPit(world.car.getState().speed);
  });

  // On-screen buttons for the two things a thumb cannot reach: the wings
  // and the boost. Both sit where the right hand already is.
  const bind = (id: string, set: (down: boolean) => void): void => {
    const el = document.getElementById(id)!;
    const press = (down: boolean) => (e: PointerEvent): void => {
      e.preventDefault();
      e.stopPropagation();
      set(down);
      el.classList.toggle('held', down);
    };
    el.addEventListener('pointerdown', press(true));
    el.addEventListener('pointerup', press(false));
    el.addEventListener('pointercancel', press(false));
    el.addEventListener('pointerleave', press(false));
  };
  if (input.touch) {
    bind('btn-aero', (d) => (input.touch!.straightMode = d));
    bind('btn-overtake', (d) => (input.touch!.overtake = d));
  }
  document.getElementById('btn-pit')!.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    session.requestPit(world.car.getState().speed);
  });

  /* Recovery, on screen.
   *
   * A rigid body on four raycast wheels can end up on its roof, wedged
   * against a barrier, or several hundred metres off the map — none of
   * which the simulation is wrong about, and all of which end the
   * session unless there is a way back. The keyboard has had R all
   * along; a phone had nothing, and neither had any way of knowing a
   * recovery existed. It routes through the same edge the key does, so
   * there is one recovery path rather than two. */
  document.getElementById('btn-reset')!.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    input.requestReset();
  });

  const loop = new FixedLoop(120);

  loop.start({
    step: (dt) => {
      // Touch play shifts for itself, which needs to know how fast the
      // car is going before the controls are read.
      const previous = world.car.getState();
      input.observe(Math.abs(previous.speed) * 3.6, previous.gear);

      const human = input.update(dt);
      const state = previous;

      const drivenSlip = Math.max(
        Math.abs(state.wheels[RL].slipRatio),
        Math.abs(state.wheels[RR].slipRatio)
      );

      // The AI emits the same ControlState the keyboard does, so nothing
      // downstream can tell which of them is driving.
      /* Three ways the car can be driven, and only the middle one is
         new. Easy mode runs every aid through one entry point so the
         low-speed bypass lives in a single place; the plain path is the
         simulator with traction control, exactly as it was. */
      let controls;
      if (aids.autopilot) {
        controls = driveWorld(driver, world, dt);
      } else if (aids.easy) {
        controls = driverAids(human, state, assist, dt);
      } else {
        /* The same deadlock guard easy mode gets for free: below
           walking pace the ceiling must be handed back, or a car
           stopped on the grass spins its wheels until the limit decays
           and can never pull away again. */
        if (Math.abs(state.speed) < 3) assist.throttleLimit = 1;
        controls = {
          ...human,
          throttle: aids.tractionControl
            ? tractionControl(human.throttle, drivenSlip, assist, dt)
            : human.throttle
        };
      }

      /* The one thing the aids cannot do through the controls: a car
         already sideways has no front grip left to countersteer with,
         so the moment has to come from somewhere else. Zero unless the
         car is genuinely sliding. */
      world.car.stabilityTorque =
        aids.easy && !aids.autopilot ? assist.stabilityTorque : 0;

      const finished = session.phase === 'finished';
      /* On the grid the car is held, exactly as it is during a pit
         stop — the same mechanism, because it is the same thing: the
         session is running and the car is not allowed to move yet.
         Anticipating the lights therefore does nothing, which is the
         correct answer to anticipating the lights. */
      const held = session.onGrid || session.inPitStop;

      world.car.controls = {
        ...controls,
        throttle: held || finished ? 0 : controls.throttle,
        brake: held ? 1 : controls.brake
      };

      // Whatever is driving — human, AI or autopilot — the wheel in the
      // cockpit shows the request that actually reached the car.
      renderer.setControlSteer(world.car.controls.steer);

      // Reset puts the car back on the racing line where it stands,
      // rather than at the start line — on a seven kilometre circuit the
      // latter would mean driving all the way back round.
      if (input.consumeReset()) {
        world.respawn();
        driver.reset();
        /* And the aids, which otherwise carry a decayed throttle
           ceiling across the recovery — the car comes back on the
           racing line and then will not pull away for another half
           second. */
        assist.throttleLimit = 1;
        assist.steerLimit = 1;
      }

      // Servicing holds the car; the session clock keeps running, which
      // is exactly what makes a stop cost something. On the grid the
      // clock does not run — that is the difference between the two.
      if (held) world.car.holdStationary();
      /* And the tyres stop cooling while it is held. Without this a
         minute spent reading the title card costs six per cent of tyre
         grip before the lights have even gone out. */
      world.car.thermalFrozen = held;

      /* The rest of the field, for contact. Handed over each tick
         rather than owned by the world: the rivals belong to `race/`,
         and the simulation is told where they are rather than going to
         find out. */
      world.traffic = timeTrial ? [] : field.rivals;

      world.step(dt);

      /* A kinematic car cannot be pushed by an impulse, so the other
         half of every contact is done here: whatever the player hit
         loses a little speed, the way a car that has been leaned on
         does. Without it the player bounces off something that sails
         on as though nothing happened. */
      for (const i of world.contacts) {
        const hit = field.rivals[i];
        if (hit) hit.speed *= 0.94;
      }

      session.update(dt, world.onTrack, world.lapJustCompleted, world.timer);
      if (session.pitStopJustFinished) world.car.fitFreshTires();

      // The driver asks to be recovered; the caller decides. It has no
      // business moving the car itself.
      if (aids.autopilot && driver.needsRecovery) {
        world.respawn();
        driver.reset();
        assist.throttleLimit = 1;
        assist.steerLimit = 1;
      }

      /* The field runs whether or not this session scores it: traffic
         to judge in practice, opponents in a race.
         On the grid it is stepped by nothing — which still places every
         car on its slot and points it down the road, but moves none of
         them. Rivals that set off while the player was held would be a
         hundred metres up the road by the time the lights went out. */
      field.update(
        session.onGrid || timeTrial ? 0 : dt,
        session.elapsed,
        session.config.laps ?? null,
        session.onGrid
      );

      if (world.lapJustCompleted) {
        const lap = world.lapJustCompleted;
        timing.setBest(world.timer.bestLap?.time ?? null);
        timing.record(lap);
        /* Best laps are kept per circuit, in the same store the arcade
           game used, so a personal best survives which half you set it
           in. */
        recordLap(circuitId, lap.time);

        /* And the ghost, on the same rule the lap board uses: a lap with
           a wheel over the white line is not a lap, so it is not a
           ghost either. Keeping an invalid one would give the player a
           target they are not allowed to match. */
        if (timeTrial) {
          if (lap.valid && (!ghostLap || lap.time < ghostLap.time)) {
            const taken = ghostRecorder.take(lap.time);
            if (taken) {
              ghostLap = taken;
              saveGhost(circuitId, taken);
            }
          }
          ghostRecorder.reset();
        }
      }

      /* ------------------------------------------------------------
         The ghost, after the lap board and not before it.

         Order is the whole of this. `world.step()` moves the car, then
         advances the lap clock, and crossing the line resets that clock
         to zero. Recording *before* the step samples last tick's
         position against this tick's time; recording before the lap
         handling above means the first line crossing never resets the
         recorder, so the out-lap and the flying lap end up in one
         buffer — and then the distance column is not monotonic, the
         binary search in `ghostTimeAtDistance` has nothing to stand on,
         and the delta reads as "no comparison" for the whole lap.

         That is exactly what it did. Hence: step, bank the lap, then
         record.
         ------------------------------------------------------------ */
      if (timeTrial) {
        /* A new lap started — either the first crossing of the session,
           which banks nothing, or one that just banked a lap above. */
        if (world.timer.lap !== lastTimedLap) {
          lastTimedLap = world.timer.lap;
          ghostRecorder.reset();
        }

        // Nothing is being timed before the first crossing, so there is
        // no lap to record and no clock to record it against.
        if (world.timer.lap >= 1) {
          const state = world.car.getState();
          const rot = state.rotation;
          // Yaw straight out of the quaternion — the same reading
          // `sim/world.ts` takes for its traffic check.
          const yaw = Math.atan2(
            2 * (rot.w * rot.y + rot.x * rot.z),
            1 - 2 * (rot.y * rot.y + rot.z * rot.z)
          );
          ghostRecorder.record(world.timer.lapTime, {
            x: state.position.x,
            y: state.position.y,
            z: state.position.z,
            /* Negated going in because `render/rivals.ts` negates it
               coming out: the field reports a bearing and the renderer
               applies a yaw, and the two differ by a sign. Storing the
               bearing keeps a recording readable by anything that reads
               a `Rival`. */
            heading: -yaw,
            distance: world.distance
          });

          if (ghostLap) {
            const frame = sampleGhost(ghostLap, world.timer.lapTime);

            /* Hidden while it is on top of the camera, which in a time
               trial is most of the time — running level with your own
               best lap is the entire point, and from the driver's seat a
               car half a metre away is not a rival, it is a wall across
               the windscreen.

               The test is against the *camera*, not against the player's
               car, and that is what makes it behave in both views. From
               the chase camera, eight metres back, a ghost alongside is
               eight metres away and stays drawn — which is where you
               actually want to see it. From the cockpit the same ghost
               is half a metre from the eye and goes.

               A fade would be gentler than a cut, but this renderer has
               no per-car opacity to fade: `render/rivals.ts` builds one
               flat material per livery, and the inverted-hull outline
               round it is exactly the thing transparency destroys. So it
               is a cut, placed at a distance where there was nothing
               legible to lose. */
            const eye = renderer.camera.position;
            const near =
              Math.hypot(frame.x - eye.x, frame.y - eye.y, frame.z - eye.z) < 4.5;

            ghostVisible = !frame.finished && !near;
            ghostCar.position.x = frame.x;
            // Dropped through the floor rather than hidden by a flag:
            // `RivalRenderer` has no visibility of its own to set.
            ghostCar.position.y = ghostVisible ? frame.y : -500;
            ghostCar.position.z = frame.z;
            ghostCar.heading = frame.heading;
            ghostCar.speed = frame.speed;
            ghostCar.distance = frame.distance;
          }
        } else {
          ghostVisible = false;
          ghostCar.position.y = -500;
        }
      }

      /* Score once, at the flag. The phase stays 'finished' for the
         rest of the session, so without the guard the table would gain
         a set of points every tick. */
      if (!scored && session.phase === 'finished' && session.config.laps !== undefined) {
        scored = true;
        const order = field.classification(
          Math.max(1, world.timer.lap),
          world.distance,
          session.elapsed
        );
        results.show(order, score(order), standings());
      }

      renderer.pushState(world.car.getState(), world.car.wheelCentres());
    },
    render: (alpha, frameDt) => {
      /* The title card is a caption over the game, not a sheet in front
         of it — so while it is up the camera walks slowly round the car
         on its grid box. */
      /* Three shots, in order: the car on its box while the title is
         up, the grid from behind while the lights fill, and then the
         driver's own view from the moment they are released. */
      renderer.showcase = !session.hasBegun ? 'menu' : session.onGrid ? 'grid' : null;
      renderer.render(alpha, frameDt);
      const snapshot = world.car.getState();
      const battery = world.car.drivetrain.ersStore / params.drivetrain.ersCapacity;
      hud.update(snapshot, params.drivetrain.redlineRpm, battery);

      timing.update(world.timer, world.currentSection(), world.onTrack);
      const place = field.positionOf(
        Math.max(1, world.timer.lap),
        world.distance,
        null
      );
      positionPanel.update(
        place,
        field.rivals.length + 1,
        field.gapAhead(Math.max(1, world.timer.lap), world.distance),
        world.car.getState().speed
      );

      if (timeTrial) {
        /* Null rather than zero wherever there is nothing to compare —
           no ghost yet, or a point on the circuit its lap never reached.
           A zero would read as "dead level", which is a lie. */
        const was = ghostLap ? ghostTimeAtDistance(ghostLap, world.distance) : null;
        deltaPanel.update(was === null ? null : world.timer.lapTime - was);
      }

      minimap.update(world.distance, drawn);

      const now = performance.now();
      startLights.update(session, now);
      overtakeNotice.update(place, field, now, session.phase === 'green');
      speedLines.update(Math.abs(snapshot.speed) * 3.6);
      touchPads.update(
        input.touch?.steerPad() ?? null,
        input.touch?.pedalPad() ?? null
      );
      rivalLabels.update(drawn, (point) => renderer.worldToScreen(point));
      sessionPanel.update(session, world.timer);
    }
  });

  // Exposed for console poking and for the browser-driven smoke test.
  Object.assign(window, { world, params, renderer, loop, tuning, session, driver, racingLine, speedProfile, input, field, startLights, overtakeNotice, settings, aidsPanel, easyMode });
};

void boot();
