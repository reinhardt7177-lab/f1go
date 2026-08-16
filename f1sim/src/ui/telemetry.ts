/**
 * Telemetry overlay — the instrument you tune against.
 *
 * The numbers that matter while dialling in a vehicle model are not the
 * ones on a road-car dashboard. Load, slip and grip usage per corner tell
 * you why the car is doing what it is doing; speed alone never does.
 */
import { DEG, KMH, clamp } from '../core/math';
import type { VehicleState } from '../sim/types';
import { gearLabel } from '../sim/drivetrain';

const WHEEL_LABELS = ['FL', 'FR', 'RL', 'RR'];

/** Working window is 100 +/- 25 C; see `defaultThermalParams`. */
const tempClass = (t: number): string => {
  if (t < 75) return 'cold';
  if (t > 125) return 'hot';
  return 'ok';
};

export class TelemetryPanel {
  private readonly root: HTMLElement;
  private readonly readouts = new Map<string, HTMLElement>();
  private readonly gripBars: HTMLElement[] = [];
  private readonly loadBars: HTMLElement[] = [];
  private readonly slipCells: HTMLElement[] = [];
  private readonly tempCells: HTMLElement[] = [];
  private readonly wearCells: HTMLElement[] = [];
  private readonly circle: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly trail: Array<{ x: number; y: number }> = [];

  constructor(mount: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'panel telemetry';
    mount.appendChild(this.root);

    const primary = document.createElement('div');
    primary.className = 'primary';
    primary.innerHTML = `
      <div class="big"><span data-k="speed">0</span><em>km/h</em></div>
      <div class="big"><span data-k="gear">N</span><em>gear</em></div>
    `;
    this.root.appendChild(primary);

    const revBar = document.createElement('div');
    revBar.className = 'rev';
    revBar.innerHTML = '<i data-k="rev"></i>';
    this.root.appendChild(revBar);

    const stats = document.createElement('dl');
    stats.className = 'stats';
    for (const [key, label] of [
      ['rpm', 'RPM'],
      ['downforce', 'Downforce'],
      ['drag', 'Drag'],
      ['glong', 'g long'],
      ['glat', 'g lat'],
      ['aero', 'aero'],
      ['ers', 'battery']
    ] as const) {
      const dt = document.createElement('dt');
      dt.textContent = label;
      const dd = document.createElement('dd');
      dd.dataset.k = key;
      dd.textContent = '0';
      stats.append(dt, dd);
    }
    this.root.appendChild(stats);

    // Per-corner block: load, grip usage and slip for each wheel.
    const wheels = document.createElement('div');
    wheels.className = 'wheels';
    for (let i = 0; i < 4; i++) {
      const cell = document.createElement('div');
      cell.className = 'wheel';
      cell.innerHTML = `
        <h4>${WHEEL_LABELS[i]}</h4>
        <div class="bar load"><i></i></div>
        <div class="bar grip"><i></i></div>
        <p class="slip">0.0&deg; / 0.00</p>
        <p class="cond"><span class="temp">--</span><span class="wear">--</span></p>
      `;
      wheels.appendChild(cell);
      this.loadBars.push(cell.querySelector('.load i') as HTMLElement);
      this.gripBars.push(cell.querySelector('.grip i') as HTMLElement);
      this.slipCells.push(cell.querySelector('.slip') as HTMLElement);
      this.tempCells.push(cell.querySelector('.temp') as HTMLElement);
      this.wearCells.push(cell.querySelector('.wear') as HTMLElement);
    }
    this.root.appendChild(wheels);

    const legend = document.createElement('p');
    legend.className = 'legend';
    legend.textContent = 'load / grip used · tread temp · wear';
    this.root.appendChild(legend);

    // Traction circle: combined g, with a fading trail.
    this.circle = document.createElement('canvas');
    this.circle.className = 'gcircle';
    this.circle.width = 200;
    this.circle.height = 200;
    this.root.appendChild(this.circle);
    this.ctx = this.circle.getContext('2d')!;

    for (const el of this.root.querySelectorAll<HTMLElement>('[data-k]')) {
      this.readouts.set(el.dataset.k!, el);
    }
  }

  private set(key: string, value: string): void {
    const el = this.readouts.get(key);
    if (el) el.textContent = value;
  }

  update(s: VehicleState, redlineRpm: number, ersFraction: number): void {
    this.set('speed', Math.round(Math.abs(s.speed) * KMH).toString());
    this.set('gear', gearLabel(s.gear));
    this.set('rpm', Math.round(s.engineRpm).toLocaleString());
    this.set('downforce', `${Math.round(s.downforce)} N`);
    this.set('drag', `${Math.round(s.drag)} N`);
    this.set('glong', s.gLong.toFixed(2));
    this.set('glat', s.gLat.toFixed(2));
    this.set('aero', s.aeroMode === 'straight' ? 'STRAIGHT' : 'corner');
    const aeroCell = this.readouts.get('aero');
    if (aeroCell) aeroCell.classList.toggle('active', s.aeroMode === 'straight');

    this.set('ers', `${Math.round(ersFraction * 100)}%`);

    const rev = this.readouts.get('rev');
    if (rev) {
      const f = clamp(s.engineRpm / redlineRpm, 0, 1);
      rev.style.width = `${f * 100}%`;
      rev.style.background = f > 0.95 ? '#3b7dff' : f > 0.82 ? '#e2000f' : '#12d16b';
    }

    // Normalise load bars against static corner weight so 100% means
    // "carrying twice its share" — the number you watch under braking.
    for (let i = 0; i < 4; i++) {
      const w = s.wheels[i]!;
      const loadBar = this.loadBars[i];
      const gripBar = this.gripBars[i];
      const slip = this.slipCells[i];
      if (loadBar) loadBar.style.width = `${clamp((w.load / 8000) * 100, 0, 100)}%`;
      if (gripBar) {
        const g = clamp(w.gripUsage, 0, 1.2);
        gripBar.style.width = `${(g / 1.2) * 100}%`;
        gripBar.style.background = g > 0.98 ? '#e2000f' : g > 0.85 ? '#f5c518' : '#12d16b';
      }
      if (slip) {
        slip.textContent = `${(w.slipAngle * DEG).toFixed(1)}° / ${w.slipRatio.toFixed(2)}`;
        slip.classList.toggle('airborne', !w.grounded);
      }

      // Tread temperature is colour-coded against the working window,
      // because the number alone does not tell you whether the tyre is
      // in it: blue is too cold to key into the road, red is greasy.
      const temp = this.tempCells[i];
      if (temp) {
        temp.textContent = `${Math.round(w.surfaceTemp)}°`;
        temp.className = 'temp ' + tempClass(w.surfaceTemp);
      }
      const wearCell = this.wearCells[i];
      if (wearCell) {
        wearCell.textContent = `${Math.round(w.wear * 100)}%`;
        wearCell.classList.toggle('worn', w.wear > 0.6);
      }
    }

    this.drawTractionCircle(s.gLat, s.gLong);
  }

  private drawTractionCircle(gLat: number, gLong: number): void {
    const ctx = this.ctx;
    const size = this.circle.width;
    const c = size / 2;
    const scale = c / 5.5; // full scale is 5.5 g

    this.trail.push({ x: gLat, y: gLong });
    if (this.trail.length > 140) this.trail.shift();

    ctx.clearRect(0, 0, size, size);

    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1;
    for (const g of [1, 2, 3, 4, 5]) {
      ctx.beginPath();
      ctx.arc(c, c, g * scale, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(c, 0);
    ctx.lineTo(c, size);
    ctx.moveTo(0, c);
    ctx.lineTo(size, c);
    ctx.stroke();

    for (let i = 0; i < this.trail.length; i++) {
      const p = this.trail[i]!;
      const a = (i / this.trail.length) ** 2;
      ctx.fillStyle = `rgba(226,0,15,${a.toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(c + p.x * scale, c - p.y * scale, 1.8, 0, Math.PI * 2);
      ctx.fill();
    }

    const last = this.trail[this.trail.length - 1];
    if (last) {
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(c + last.x * scale, c - last.y * scale, 3.4, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = 'rgba(255,255,255,0.42)';
    ctx.font = '10px ui-monospace, monospace';
    ctx.fillText('5 g', c + 4, 12);
  }
}
