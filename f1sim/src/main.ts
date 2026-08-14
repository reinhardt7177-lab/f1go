/**
 * Composition root — the one place where simulation, rendering, input
 * and UI are allowed to know about each other.
 */
import './style.css';

import { FixedLoop } from './core/loop';
import { InputManager } from './input/controls';
import { SceneRenderer } from './render/scene';
import type { CameraMode } from './render/scene';
import { initialAssistState, tractionControl } from './sim/assists';
import { RL, RR } from './sim/types';
import { defaultVehicleParams } from './sim/vehicle';
import { SimWorld, initPhysics } from './sim/world';
import { SESSION_PRESETS, Session } from './race/session';
import type { SessionKind } from './race/session';
import { SessionPanel } from './ui/session';
import { SetupStatusPanel } from './ui/setup-status';
import { TelemetryPanel } from './ui/telemetry';
import { TimingPanel } from './ui/timing';
import { TuningPanel } from './ui/tuning';

const boot = async (): Promise<void> => {
  const status = document.getElementById('status')!;
  status.textContent = 'loading physics…';

  await initPhysics();

  const canvas = document.getElementById('view') as HTMLCanvasElement;
  const overlay = document.getElementById('overlay')!;

  const params = defaultVehicleParams();
  const world = new SimWorld(params, { circuitId: 'spa' });
  const renderer = new SceneRenderer(canvas, world.geometry);
  const input = new InputManager(window);

  // Left column stacks telemetry over the timing tower; the setup panel
  // sits on the right.
  const left = document.createElement('div');
  left.className = 'stack';
  overlay.appendChild(left);

  // Session kind is chosen from the URL so a run can be linked to:
  // ?session=qualifying, ?session=race. Practice by default.
  const requested = new URLSearchParams(location.search).get('session') as SessionKind | null;
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
  const aids = { tractionControl: true };

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
    }
  ]);

  status.remove();

  const modes: CameraMode[] = ['chase', 'cockpit', 'trackside'];
  let modeIndex = 0;
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyC') {
      modeIndex = (modeIndex + 1) % modes.length;
      renderer.cameraMode = modes[modeIndex]!;
    }
    // A stop is only granted when the car is close to stationary, which
    // stands in for a pit lane until there is one.
    if (e.code === 'KeyP') session.requestPit(world.car.getState().speed);
  });

  const loop = new FixedLoop(120);

  loop.start({
    step: (dt) => {
      const controls = input.update(dt);
      const state = world.car.getState();

      const drivenSlip = Math.max(
        Math.abs(state.wheels[RL]!.slipRatio),
        Math.abs(state.wheels[RR]!.slipRatio)
      );

      world.car.controls = {
        ...controls,
        throttle: aids.tractionControl
          ? tractionControl(controls.throttle, drivenSlip, assist, dt)
          : controls.throttle
      };

      // Reset puts the car back on the racing line where it stands,
      // rather than at the start line — on a seven kilometre circuit the
      // latter would mean driving all the way back round.
      if (input.consumeReset()) world.respawn();

      world.step(dt);

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
      timing.update(world.timer, world.currentSection(), world.onTrack);
      sessionPanel.update(session, world.timer);
      setupStatus.update(
        world.car.getState(),
        world.car.drivetrain.ersStore / params.drivetrain.ersCapacity
      );
    }
  });

  // Exposed for console poking and for the browser-driven smoke test.
  Object.assign(window, { world, params, renderer, loop, tuning, session });
};

void boot();
