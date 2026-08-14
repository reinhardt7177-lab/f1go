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

  const telemetry = new TelemetryPanel(left);
  const timing = new TimingPanel(left, world.circuit);

  // Driver aids shape the controls before they reach the car; the
  // vehicle model never knows they exist.
  const assist = initialAssistState();
  const aids = { tractionControl: true };

  const tuning = new TuningPanel(overlay, params, [
    {
      label: 'Traction control',
      note:
        'First gear delivers far more thrust than the rear tyres can carry, ' +
        'so full throttle from rest is a burnout. Turn this off to feel it.',
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
    }
  });

  // Exposed for console poking and for the browser-driven smoke test.
  Object.assign(window, { world, params, renderer, loop, tuning });
};

void boot();
