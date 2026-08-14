/**
 * Live tuning panel.
 *
 * Stage one exists to get the vehicle model right, and you cannot do
 * that by editing constants and reloading. Every parameter here is bound
 * to the live `VehicleParams` object, so a change takes effect on the
 * next tick.
 *
 * The presets at the bottom are the useful part: they are the ends of
 * the range, so you can feel what each parameter actually does rather
 * than guessing from a number.
 */
import { peakPower } from '../sim/drivetrain';
import { terminalSpeed } from '../sim/aero';
import type { VehicleParams } from '../sim/vehicle';

interface Binding {
  label: string;
  group: string;
  min: number;
  max: number;
  step: number;
  /** Displayed value = stored value * scale. */
  scale?: number;
  unit?: string;
  get: (p: VehicleParams) => number;
  set: (p: VehicleParams, v: number) => void;
}

const BINDINGS: Binding[] = [
  {
    group: 'Aero',
    label: 'Downforce (ClA)',
    min: 0,
    max: 7,
    step: 0.1,
    get: (p) => p.aero.clA,
    set: (p, v) => (p.aero.clA = v)
  },
  {
    group: 'Aero',
    label: 'Drag (CdA)',
    min: 0.4,
    max: 2.5,
    step: 0.05,
    get: (p) => p.aero.cdA,
    set: (p, v) => (p.aero.cdA = v)
  },
  {
    group: 'Aero',
    label: 'Aero balance (front)',
    min: 0.3,
    max: 0.6,
    step: 0.005,
    scale: 100,
    unit: '%',
    get: (p) => p.aero.frontBalance,
    set: (p, v) => (p.aero.frontBalance = v)
  },
  {
    group: 'Tyre',
    label: 'Peak friction',
    min: 0.8,
    max: 2.4,
    step: 0.05,
    get: (p) => p.tire.muNominal,
    set: (p, v) => (p.tire.muNominal = v)
  },
  {
    group: 'Tyre',
    label: 'Load sensitivity',
    min: 0,
    max: 0.25,
    step: 0.005,
    get: (p) => p.tire.loadSensitivity,
    set: (p, v) => (p.tire.loadSensitivity = v)
  },
  {
    group: 'Tyre',
    label: 'Lateral stiffness (B)',
    min: 3,
    max: 18,
    step: 0.5,
    get: (p) => p.tire.latB,
    set: (p, v) => (p.tire.latB = v)
  },
  {
    group: 'Suspension',
    label: 'Front spring',
    min: 40_000,
    max: 320_000,
    step: 10_000,
    scale: 0.001,
    unit: ' kN/m',
    get: (p) => p.suspension.stiffnessFront,
    set: (p, v) => (p.suspension.stiffnessFront = v)
  },
  {
    group: 'Suspension',
    label: 'Rear spring',
    min: 40_000,
    max: 320_000,
    step: 10_000,
    scale: 0.001,
    unit: ' kN/m',
    get: (p) => p.suspension.stiffnessRear,
    set: (p, v) => (p.suspension.stiffnessRear = v)
  },
  {
    group: 'Suspension',
    label: 'Front anti-roll bar',
    min: 0,
    max: 90_000,
    step: 2_000,
    scale: 0.001,
    unit: ' kN/m',
    get: (p) => p.suspension.antiRollFront,
    set: (p, v) => (p.suspension.antiRollFront = v)
  },
  {
    group: 'Suspension',
    label: 'Rear anti-roll bar',
    min: 0,
    max: 90_000,
    step: 2_000,
    scale: 0.001,
    unit: ' kN/m',
    get: (p) => p.suspension.antiRollRear,
    set: (p, v) => (p.suspension.antiRollRear = v)
  },
  {
    group: 'Drivetrain',
    label: 'Peak torque',
    min: 300,
    max: 900,
    step: 10,
    unit: ' Nm',
    get: (p) => p.drivetrain.peakTorque,
    set: (p, v) => (p.drivetrain.peakTorque = v)
  },
  {
    group: 'Drivetrain',
    label: 'Differential lock',
    min: 0,
    max: 1,
    step: 0.05,
    scale: 100,
    unit: '%',
    get: (p) => p.drivetrain.diffLock,
    set: (p, v) => (p.drivetrain.diffLock = v)
  },
  {
    group: 'Drivetrain',
    label: 'Brake bias (front)',
    min: 0.45,
    max: 0.75,
    step: 0.01,
    scale: 100,
    unit: '%',
    get: (p) => p.drivetrain.brakeBias,
    set: (p, v) => (p.drivetrain.brakeBias = v)
  }
];

export interface Preset {
  name: string;
  note: string;
  apply: (p: VehicleParams) => void;
}

export const PRESETS: Preset[] = [
  {
    name: 'Baseline',
    note: 'Representative modern F1 aero and tyre figures.',
    apply: (p) => {
      p.aero.clA = 4.2;
      p.aero.cdA = 1.3;
      p.aero.frontBalance = 0.44;
      p.tire.muNominal = 1.75;
      p.tire.loadSensitivity = 0.08;
      p.suspension.antiRollFront = 22_000;
      p.suspension.antiRollRear = 16_000;
    }
  },
  {
    name: 'Monza trim',
    note: 'Wings off: higher top speed, far less grip in the corners.',
    apply: (p) => {
      p.aero.clA = 2.6;
      p.aero.cdA = 0.95;
      p.aero.frontBalance = 0.42;
    }
  },
  {
    name: 'Monaco trim',
    note: 'Maximum wing: slow down the straight, planted everywhere else.',
    apply: (p) => {
      p.aero.clA = 6.0;
      p.aero.cdA = 1.9;
      p.aero.frontBalance = 0.46;
    }
  },
  {
    name: 'No aero',
    note: 'Downforce off entirely — shows how much of the grip is aero.',
    apply: (p) => {
      p.aero.clA = 0;
      p.aero.cdA = 0.9;
    }
  },
  {
    name: 'Understeer',
    note: 'Stiff front bar loads the front outside tyre and kills its grip.',
    apply: (p) => {
      p.suspension.antiRollFront = 52_000;
      p.suspension.antiRollRear = 6_000;
      p.aero.frontBalance = 0.36;
    }
  },
  {
    name: 'Oversteer',
    note: 'The same trick applied to the rear axle instead.',
    apply: (p) => {
      p.suspension.antiRollFront = 6_000;
      p.suspension.antiRollRear = 52_000;
      p.aero.frontBalance = 0.52;
    }
  }
];

/** A boolean switch, used for driver aids that live outside the sim. */
export interface ToggleBinding {
  label: string;
  note: string;
  get: () => boolean;
  set: (value: boolean) => void;
}

export class TuningPanel {
  private readonly root: HTMLElement;
  private readonly refreshers: Array<() => void> = [];
  private readonly derived: HTMLElement;

  constructor(
    mount: HTMLElement,
    private readonly params: VehicleParams,
    toggles: ToggleBinding[] = []
  ) {
    this.root = document.createElement('div');
    this.root.className = 'panel tuning';
    mount.appendChild(this.root);

    const header = document.createElement('div');
    header.className = 'panel-head';
    header.innerHTML = '<h3>Setup</h3><button type="button" class="collapse">hide</button>';
    this.root.appendChild(header);

    const body = document.createElement('div');
    body.className = 'panel-body';
    this.root.appendChild(body);

    header.querySelector('.collapse')!.addEventListener('click', (e) => {
      const collapsed = body.classList.toggle('collapsed');
      (e.currentTarget as HTMLElement).textContent = collapsed ? 'show' : 'hide';
    });

    let currentGroup = '';
    for (const b of BINDINGS) {
      if (b.group !== currentGroup) {
        currentGroup = b.group;
        const h = document.createElement('h4');
        h.textContent = b.group;
        body.appendChild(h);
      }
      body.appendChild(this.buildSlider(b));
    }

    if (toggles.length > 0) {
      const aidHead = document.createElement('h4');
      aidHead.textContent = 'Driver aids';
      body.appendChild(aidHead);

      for (const toggle of toggles) {
        const row = document.createElement('label');
        row.className = 'toggle';
        row.title = toggle.note;

        const box = document.createElement('input');
        box.type = 'checkbox';
        box.checked = toggle.get();
        box.addEventListener('change', () => toggle.set(box.checked));

        const text = document.createElement('span');
        text.textContent = toggle.label;

        row.append(box, text);
        body.appendChild(row);
        this.refreshers.push(() => (box.checked = toggle.get()));
      }
    }

    const presetHead = document.createElement('h4');
    presetHead.textContent = 'Presets';
    body.appendChild(presetHead);

    const presets = document.createElement('div');
    presets.className = 'presets';
    for (const preset of PRESETS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = preset.name;
      btn.title = preset.note;
      btn.addEventListener('click', () => {
        preset.apply(this.params);
        this.refresh();
      });
      presets.appendChild(btn);
    }
    body.appendChild(presets);

    this.derived = document.createElement('p');
    this.derived.className = 'derived';
    body.appendChild(this.derived);

    this.refresh();
  }

  private buildSlider(b: Binding): HTMLElement {
    const row = document.createElement('label');
    row.className = 'slider';

    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = b.label;

    const value = document.createElement('span');
    value.className = 'value';

    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(b.min);
    input.max = String(b.max);
    input.step = String(b.step);

    const show = (): void => {
      const raw = b.get(this.params);
      const shown = raw * (b.scale ?? 1);
      const decimals = b.scale && b.scale >= 100 ? 0 : shown >= 100 ? 0 : shown >= 10 ? 1 : 2;
      value.textContent = shown.toFixed(decimals) + (b.unit ?? '');
      input.value = String(raw);
    };

    input.addEventListener('input', () => {
      b.set(this.params, Number(input.value));
      show();
      this.updateDerived();
    });

    this.refreshers.push(show);

    row.append(name, value, input);
    return row;
  }

  /** Re-read every control from the params object. */
  refresh(): void {
    for (const r of this.refreshers) r();
    this.updateDerived();
  }

  /**
   * Numbers you cannot set directly but need to see, because they are how
   * you tell whether the setup is physically sensible at all.
   */
  private updateDerived(): void {
    const power = peakPower(this.params.drivetrain);
    const vMax = terminalSpeed(this.params.aero, power.watts);
    const at250 = 0.5 * this.params.aero.airDensity * (250 / 3.6) ** 2 * this.params.aero.clA;
    const weight = this.params.chassis.mass * 9.81;

    this.derived.innerHTML =
      `peak power <b>${Math.round(power.watts / 1000)} kW</b> ` +
      `(${Math.round(power.watts / 745.7)} hp) at ${power.rpm.toLocaleString()} rpm<br>` +
      `drag-limited top speed <b>${Math.round(vMax * 3.6)} km/h</b><br>` +
      `downforce at 250 km/h <b>${Math.round(at250)} N</b> ` +
      `(${(at250 / weight).toFixed(2)}x car weight)`;
  }
}
