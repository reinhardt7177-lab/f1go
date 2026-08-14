/**
 * 자동차 셋업 — 상태창.
 *
 * The sliders next to this show what the setup *is*. This shows what it
 * is currently *doing*: the ride height the springs are actually
 * holding, the multiplier the floor is producing at that height, what
 * the tyres are carrying, and how much grip is left after temperature
 * and wear. Those are the numbers that tell you whether a setup change
 * did what you intended, and none of them can be read off a slider.
 */
import { KMH, clamp } from '../core/math';
import type { VehicleState } from '../sim/types';
import type { VehicleParams } from '../sim/vehicle';

interface Row {
  key: string;
  label: string;
  hint?: string;
}

const ROWS: Row[] = [
  { key: 'ride', label: '차고 (앞/뒤)', hint: '노면에서 플로어까지의 높이' },
  { key: 'ge', label: '그라운드 이펙트', hint: '차고에 따른 다운포스 배율' },
  { key: 'load', label: '총 접지하중', hint: '네 바퀴 하중의 합' },
  { key: 'aero', label: '다운포스 / 항력' },
  { key: 'balance', label: '하중 배분 (앞)', hint: '앞축이 받는 하중의 비율' },
  { key: 'temp', label: '타이어 온도 (앞/뒤)' },
  { key: 'wear', label: '타이어 마모' },
  { key: 'grip', label: '타이어 그립 배율', hint: '온도와 마모를 합친 결과' },
  { key: 'surface', label: '노면 그립' },
  { key: 'ers', label: 'ERS 잔량' }
];

const num = (v: number, digits = 0): string =>
  v.toLocaleString('ko-KR', { minimumFractionDigits: digits, maximumFractionDigits: digits });

export class SetupStatusPanel {
  private readonly cells = new Map<string, HTMLElement>();
  private readonly headline: HTMLElement;
  private readonly bar: HTMLElement;

  constructor(mount: HTMLElement, private readonly params: VehicleParams) {
    const root = document.createElement('div');
    root.className = 'panel setup-status';
    mount.appendChild(root);

    const head = document.createElement('div');
    head.className = 'panel-head';
    head.innerHTML = '<h3>자동차 셋업</h3><span class="tag">상태</span>';
    root.appendChild(head);

    this.headline = document.createElement('div');
    this.headline.className = 'headline';
    root.appendChild(this.headline);

    this.bar = document.createElement('div');
    this.bar.className = 'wearbar';
    this.bar.innerHTML = '<i></i>';
    root.appendChild(this.bar);

    const list = document.createElement('dl');
    list.className = 'status-rows';
    for (const row of ROWS) {
      const dt = document.createElement('dt');
      dt.textContent = row.label;
      if (row.hint) dt.title = row.hint;

      const dd = document.createElement('dd');
      dd.dataset.k = row.key;
      dd.textContent = '—';

      list.append(dt, dd);
      this.cells.set(row.key, dd);
    }
    root.appendChild(list);
  }

  private set(key: string, value: string, cls = ''): void {
    const el = this.cells.get(key);
    if (!el) return;
    el.textContent = value;
    el.className = cls;
  }

  update(s: VehicleState, ersFraction: number): void {
    const [fl, fr, rl, rr] = s.wheels;

    const totalLoad = fl.load + fr.load + rl.load + rr.load;
    const frontLoad = fl.load + fr.load;
    const weight = this.params.chassis.mass * 9.81;

    this.headline.innerHTML =
      `<b>${num(Math.abs(s.speed) * KMH)}</b><span>km/h</span>` +
      `<b>${s.gear}</b><span>단</span>` +
      `<b>${num(s.engineRpm)}</b><span>rpm</span>`;

    this.set('ride', `${num(s.rideHeightFront * 1000)} / ${num(s.rideHeightRear * 1000)} mm`);

    // Below the stall height the floor has given up; that is worth
    // shouting about, because the car will suddenly understeer.
    const ge = (s.groundEffectFront + s.groundEffectRear) / 2;
    const stalled =
      s.rideHeightFront < this.params.aero.stallRideHeight ||
      s.rideHeightRear < this.params.aero.stallRideHeight;
    this.set('ge', `${ge.toFixed(2)}배${stalled ? ' · 실속' : ''}`, stalled ? 'bad' : 'good');

    this.set(
      'load',
      `${num(totalLoad)} N (중량의 ${(totalLoad / weight).toFixed(2)}배)`
    );
    this.set('aero', `${num(s.downforce)} N / ${num(s.drag)} N`);
    this.set(
      'balance',
      totalLoad > 0 ? `${num((frontLoad / totalLoad) * 100, 1)} %` : '—'
    );

    const frontTemp = (fl.surfaceTemp + fr.surfaceTemp) / 2;
    const rearTemp = (rl.surfaceTemp + rr.surfaceTemp) / 2;
    const window = this.params.thermal;
    const inWindow = (t: number): boolean => Math.abs(t - window.optimalTemp) <= window.tempWindow;
    this.set(
      'temp',
      `${num(frontTemp)} / ${num(rearTemp)} °C`,
      inWindow(frontTemp) && inWindow(rearTemp) ? 'good' : 'warn'
    );

    const wear = (fl.wear + fr.wear + rl.wear + rr.wear) / 4;
    this.set('wear', `${num(wear * 100, 1)} %`, wear > 0.6 ? 'warn' : '');
    const fill = this.bar.firstElementChild as HTMLElement;
    fill.style.width = `${clamp(1 - wear, 0, 1) * 100}%`;
    fill.style.background = wear > 0.75 ? '#e2000f' : wear > 0.5 ? '#f5c518' : '#12d16b';

    const grip = (fl.gripScale + fr.gripScale + rl.gripScale + rr.gripScale) / 4;
    this.set('grip', `${(grip * 100).toFixed(0)} %`, grip < 0.85 ? 'warn' : 'good');

    const surface = (fl.surfaceGrip + fr.surfaceGrip + rl.surfaceGrip + rr.surfaceGrip) / 4;
    this.set('surface', `${(surface * 100).toFixed(0)} %`, surface < 0.95 ? 'bad' : 'good');

    this.set('ers', `${num(ersFraction * 100)} %`);
  }
}
