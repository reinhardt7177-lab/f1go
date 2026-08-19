/**
 * Composition root — the one place where simulation, rendering, input
 * and UI are allowed to know about each other.
 */
import './style.css';

import { FixedLoop } from './core/loop';
import { InputManager } from './input/controls';
import { CAMERA_LABELS, SceneRenderer } from './render/scene';
import type { CameraMode } from './render/scene';
import { driverAids, initialAssistState, sideslipOf, stabilityTorque, tractionControl } from './sim/assists';
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
import { ResultsPanel } from './ui/results';
import { PositionPanel } from './ui/position';
import { Hud } from './ui/hud';
import { RivalLabels } from './ui/labels';
import { SpeedLines } from './ui/speedlines';
import { StartLights } from './ui/lights';
import { OvertakeNotice } from './ui/overtake';
import { HudMode } from './ui/hudmode';
import { EasyMode } from './ui/easymode';
import { Minimap } from './ui/minimap';
import { SessionPanel } from './ui/session';
import { SetupStatusPanel } from './ui/setup-status';
import { TelemetryPanel } from './ui/telemetry';
import { TimingPanel } from './ui/timing';
import { SlidersPanel, TuningPanel } from './ui/tuning';
import { ViewportManager } from './ui/viewport';

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
  // The touch layer listens on the canvas so drags never fight the
  // panels, which keep their own pointer events.
  const input = new InputManager(window, {}, canvas);
  const hud = new Hud(document.body);

  // Left column stacks telemetry over the timing tower; the setup panel
  // sits on the right.
  const left = document.createElement('div');
  left.className = 'stack';
  overlay.appendChild(left);

  // Session kind is chosen from the URL so a run can be linked to:
  // ?session=qualifying, ?session=race. Practice by default.
  const requested = query.get('session') as SessionKind | null;
  const kind: SessionKind =
    requested && requested in SESSION_PRESETS ? requested : 'practice';
  const session = new Session(SESSION_PRESETS[kind]);

  /* Fullscreen, landscape lock and the rotate prompt — and the tap that
     dismisses the title card, which is what starts the session.
     Constructed after the session rather than before it because that
     tap is the session's own beginning: until someone has asked to
     play, the grid stays held and the lights stay dark. */
  new ViewportManager(() => session.begin());

  // Session first: which session is running and how much of it is left is
  // the context everything below is read against.
  const sessionPanel = new SessionPanel(left);
  const telemetry = new TelemetryPanel(left);
  const timing = new TimingPanel(left, world.circuit);
  const positionPanel = new PositionPanel(left);

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
  renderer.setField(field.rivals);
  const rivalLabels = new RivalLabels(document.body, field.rivals);
  const results = new ResultsPanel(document.body);
  let scored = false;

  // Speed lines sit over the canvas and under the panels; the HUD is
  // already mounted on the body, so this goes with it.
  const speedLines = new SpeedLines(document.body);
  const startLights = new StartLights(document.body);
  const overtakeNotice = new OvertakeNotice(document.body);
  /* Which of the two interfaces is on screen. The instruments are for
     tuning the car and are in the way of driving it, so driving is the
     default and the bench is one button away. */
  const hudMode = new HudMode(document.body);
  /* Where everyone is on the circuit. The cockpit can only show the two
     hundred metres in front of you, which is not enough to know whether
     the car you are chasing is about to reach a corner or has already
     cleared it. */
  const minimap = new Minimap(document.body, world.circuit);

  // Right-hand column: live setup state above the controls that shape it.
  const right = document.createElement('div');
  right.className = 'stack right';
  overlay.appendChild(right);

  const setupStatus = new SetupStatusPanel(right, params);

  const tuning = new TuningPanel(right, params, [
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

  // Steering feel gets its own panel so it survives the phone layout,
  // which hides the setup sliders as bench instruments.
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
     the car in front instead of beside it. */
  if (kind === 'race') {
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
        Math.abs(state.wheels[RL]!.slipRatio),
        Math.abs(state.wheels[RR]!.slipRatio)
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
        aids.easy && !aids.autopilot
          ? stabilityTorque(sideslipOf(state), state.angularVelocity.y, state.speed)
          : 0;

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
      world.traffic = field.rivals;

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
        session.onGrid ? 0 : dt,
        session.elapsed,
        session.config.laps ?? null,
        session.onGrid
      );

      if (world.lapJustCompleted) {
        timing.setBest(world.timer.bestLap?.time ?? null);
        timing.record(world.lapJustCompleted);
        /* Best laps are kept per circuit, in the same store the arcade
           game used, so a personal best survives which half you set it
           in. */
        recordLap(circuitId, world.lapJustCompleted.time);
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
      renderer.render(alpha, frameDt);
      const snapshot = world.car.getState();
      const battery = world.car.drivetrain.ersStore / params.drivetrain.ersCapacity;
      hud.update(snapshot, params.drivetrain.redlineRpm, battery);

      /* The two expensive panels are skipped while they are off screen.
         Between them they rewrite some sixty elements a frame — cheap
         enough to leave running, but there is no reason to pay for a
         g-g plot nobody can see. */
      if (hudMode.engineering) {
        telemetry.update(snapshot, params.drivetrain.redlineRpm, battery);
        setupStatus.update(snapshot, battery);
      }
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

      minimap.update(world.distance, field.rivals);

      const now = performance.now();
      startLights.update(session, now);
      overtakeNotice.update(place, field, now, session.phase === 'green');
      speedLines.update(Math.abs(snapshot.speed) * 3.6);
      rivalLabels.update(field.rivals, (point) => renderer.worldToScreen(point));
      sessionPanel.update(session, world.timer);
    }
  });

  // Exposed for console poking and for the browser-driven smoke test.
  Object.assign(window, { world, params, renderer, loop, tuning, session, driver, racingLine, speedProfile, input, field, startLights, overtakeNotice, hudMode, easyMode });
};

void boot();
