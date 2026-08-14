/**
 * Timing tower.
 *
 * Everything shown here is derived from `(s, t)` — see `race/timing.ts`.
 * Sector times are coloured the way a timing screen colours them:
 * purple for a personal best in that sector, green for a lap that
 * improves, yellow otherwise.
 */
import type { CompletedLap, LapTimer } from '../race/timing';
import type { Circuit } from '../track/circuit';

export const formatTime = (seconds: number | null | undefined): string => {
  if (seconds === null || seconds === undefined || !isFinite(seconds)) return '--:--.---';
  const minutes = Math.floor(seconds / 60);
  const rest = seconds - minutes * 60;
  const whole = Math.floor(rest);
  const ms = Math.round((rest - whole) * 1000);
  return `${minutes}:${String(whole).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
};

const formatSector = (seconds: number | undefined): string =>
  seconds === undefined || !isFinite(seconds) ? '--.---' : seconds.toFixed(3);

export class TimingPanel {
  private readonly root: HTMLElement;
  private readonly lapValue: HTMLElement;
  private readonly current: HTMLElement;
  private readonly best: HTMLElement;
  private readonly last: HTMLElement;
  private readonly optimal: HTMLElement;
  private readonly sectorCells: HTMLElement[] = [];
  private readonly section: HTMLElement;
  private readonly flag: HTMLElement;
  private readonly log: HTMLElement;

  constructor(mount: HTMLElement, circuit: Circuit) {
    this.root = document.createElement('div');
    this.root.className = 'panel timing';
    mount.appendChild(this.root);

    this.root.innerHTML = `
      <div class="circuit">
        <h3>${circuit.spec.name}</h3>
        <span>${circuit.spec.country} · ${(circuit.length / 1000).toFixed(3)} km</span>
      </div>
      <div class="section"></div>
      <div class="clock"><b></b><em>lap time</em></div>
      <div class="sectors"></div>
      <dl class="times">
        <dt>Lap</dt><dd class="lapno">1</dd>
        <dt>Last</dt><dd class="last">--:--.---</dd>
        <dt>Best</dt><dd class="best">--:--.---</dd>
        <dt>Optimal</dt><dd class="optimal">--:--.---</dd>
      </dl>
      <div class="flag"></div>
      <ol class="log"></ol>
    `;

    this.section = this.root.querySelector('.section')!;
    this.current = this.root.querySelector('.clock b')!;
    this.lapValue = this.root.querySelector('.lapno')!;
    this.last = this.root.querySelector('.last')!;
    this.best = this.root.querySelector('.best')!;
    this.optimal = this.root.querySelector('.optimal')!;
    this.flag = this.root.querySelector('.flag')!;
    this.log = this.root.querySelector('.log')!;

    const sectors = this.root.querySelector('.sectors')!;
    for (let i = 0; i < circuit.sectorSplits.length; i++) {
      const cell = document.createElement('span');
      cell.className = 'sector';
      cell.textContent = '--.---';
      sectors.appendChild(cell);
      this.sectorCells.push(cell);
    }
  }

  update(timer: LapTimer, sectionName: string, onTrack: boolean): void {
    this.section.textContent = sectionName;
    this.current.textContent = formatTime(timer.lapTime);
    this.lapValue.textContent = String(timer.lap);
    this.last.textContent = formatTime(timer.lastLap?.time);
    this.best.textContent = formatTime(timer.bestLap?.time);
    this.optimal.textContent = formatTime(timer.optimalLap());

    for (let i = 0; i < this.sectorCells.length; i++) {
      const cell = this.sectorCells[i]!;
      const running = timer.currentSectors[i];
      const previous = timer.lastLap?.sectors[i];
      const value = running ?? previous;

      cell.textContent = formatSector(value);
      cell.classList.toggle('active', i === timer.sector);
      cell.classList.toggle('purple', value !== undefined && value <= (timer.bestSectors[i] ?? Infinity) + 1e-9);
      cell.classList.toggle('pending', running === undefined && previous === undefined);
    }

    this.flag.textContent = onTrack ? '' : 'OFF TRACK';
    this.flag.classList.toggle('on', !onTrack);
  }

  /** Append a completed lap to the running log. */
  record(lap: CompletedLap): void {
    const row = document.createElement('li');
    row.className = lap.valid ? '' : 'invalid';
    const isBest = lap.valid && lap.time === (this.circuitBest ?? lap.time);
    row.innerHTML =
      `<span>${lap.number}</span><b>${formatTime(lap.time)}</b>` +
      `<i>${lap.valid ? (isBest ? 'best' : '') : 'deleted'}</i>`;
    this.log.prepend(row);
    while (this.log.children.length > 6) this.log.lastElementChild?.remove();
  }

  private circuitBest: number | null = null;

  setBest(time: number | null): void {
    this.circuitBest = time;
  }
}
