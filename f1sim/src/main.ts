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
import { TuningPanel } from './ui/tuning';
import { vec3 } from './core/math';

const boot = async (): Promise<void> => {
  const status = document.getElementById('status')!;
  status.textContent = 'loading physics…';

  await initPhysics();

  const canvas = document.getElementById('view') as HTMLCanvasElement;
  const overlay = document.getElementById('overlay')!;

  const params = defaultVehicleParams();
  const world = new SimWorld(params);
  const renderer = new SceneRenderer(canvas);
  const input = new InputManager(window);
  const telemetry = new TelemetryPanel(overlay);

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

  // Camera cycling is a view concern, so it lives here rather than in
  // the input manager, which only produces driving controls.
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

      if (input.consumeReset()) world.car.reset(vec3(0, 0.4, 0), 0);
      world.step(dt);
      renderer.pushState(world.car.getState(), world.car.wheelCentres());
    },
    render: (alpha, frameDt) => {
      renderer.render(alpha, frameDt);
      telemetry.update(
        world.car.getState(),
        params.drivetrain.redlineRpm,
        world.car.drivetrain.ersStore / params.drivetrain.ersCapacity
      );
    }
  });

  // Exposed for console poking and for the browser-driven smoke test.
  Object.assign(window, { world, params, renderer, loop, tuning });
};

void boot();
