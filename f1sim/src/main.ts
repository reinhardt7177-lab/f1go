/**
 * Composition root — the one place where simulation, rendering, input
 * and UI are allowed to know about each other.
 */
import './style.css';

import { FixedLoop } from './core/loop';
import { InputManager } from './input/controls';
import { CAMERA_LABELS, SceneRenderer } from './render/scene';
import type { CameraMode } from './render/scene';
import { initialAssistState, tractionControl } from './sim/assists';
import { RL, RR } from './sim/types';
import { defaultVehicleParams } from './sim/vehicle';
import { SimWorld, initPhysics } from './sim/world';
import { CIRCUIT_SPECS } from './track/circuits';
import { Driver, driveWorld } from './ai/driver';
import { RacingLine } from './ai/racingline';
import { SpeedProfile } from './ai/speedprofile';
import { SESSION_PRESETS, Session } from './race/session';
import type { SessionKind } from './race/session';
import { Hud } from './ui/hud';
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
  const circuitId = askedCircuit && askedCircuit in CIRCUIT_SPECS ? askedCircuit : 'spa';
  const world = new SimWorld(params, { circuitId });
  const renderer = new SceneRenderer(canvas, world.geometry);
  // The touch layer listens on the canvas so drags never fight the
  // panels, which keep their own pointer events.
  const input = new InputManager(window, {}, canvas);
  const hud = new Hud(document.body);

  // Fullscreen, landscape lock and the rotate prompt. On a desktop this
  // installs a toggle and otherwise stays out of the way.
  new ViewportManager();

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

  // Session first: which session is running and how much of it is left is
  // the context everything below is read against.
  const sessionPanel = new SessionPanel(left);
  const telemetry = new TelemetryPanel(left);
  const timing = new TimingPanel(left, world.circuit);

  // Driver aids shape the controls before they reach the car; the
  // vehicle model never knows they exist.
  const assist = initialAssistState();
  const aids = { tractionControl: true, autopilot: false };

  // The AI produces the same ControlState the keyboard does, so nothing
  // downstream can tell which is driving.
  status.textContent = 'building racing line…';
  const racingLine = new RacingLine(world.circuit);
  const speedProfile = new SpeedProfile(racingLine, params);
  const driver = new Driver(racingLine, speedProfile, params);

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
  void steeringPanel;

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
      const controls = aids.autopilot
        ? driveWorld(driver, world, dt)
        : {
            ...human,
            throttle: aids.tractionControl
              ? tractionControl(human.throttle, drivenSlip, assist, dt)
              : human.throttle
          };

      const finished = session.phase === 'finished';

      world.car.controls = {
        ...controls,
        throttle: session.inPitStop || finished ? 0 : controls.throttle,
        brake: session.inPitStop ? 1 : controls.brake
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
      }

      // Servicing holds the car; the session clock keeps running, which
      // is exactly what makes a stop cost something.
      if (session.inPitStop) world.car.holdStationary();

      world.step(dt);
      session.update(dt, world.onTrack, world.lapJustCompleted, world.timer);
      if (session.pitStopJustFinished) world.car.fitFreshTires();

      // The driver asks to be recovered; the caller decides. It has no
      // business moving the car itself.
      if (aids.autopilot && driver.needsRecovery) {
        world.respawn();
        driver.reset();
      }

      if (world.lapJustCompleted) {
        timing.setBest(world.timer.bestLap?.time ?? null);
        timing.record(world.lapJustCompleted);
      }

      renderer.pushState(world.car.getState(), world.car.wheelCentres());
    },
    render: (alpha, frameDt) => {
      renderer.render(alpha, frameDt);
      telemetry.update(
        world.car.getState(),
        params.drivetrain.redlineRpm,
        world.car.drivetrain.ersStore / params.drivetrain.ersCapacity
      );
      const snapshot = world.car.getState();
      const battery = world.car.drivetrain.ersStore / params.drivetrain.ersCapacity;
      hud.update(snapshot, params.drivetrain.redlineRpm, battery);
      timing.update(world.timer, world.currentSection(), world.onTrack);
      sessionPanel.update(session, world.timer);
      setupStatus.update(
        world.car.getState(),
        world.car.drivetrain.ersStore / params.drivetrain.ersCapacity
      );
    }
  });

  // Exposed for console poking and for the browser-driven smoke test.
  Object.assign(window, { world, params, renderer, loop, tuning, session, driver, racingLine, speedProfile, input });
};

void boot();
