/**
 * Session banner: which session is running, how much of it is left, and
 * what it will be judged on.
 */
import type { Session } from '../race/session';
import type { LapTimer } from '../race/timing';
import { formatTime } from './timing';

const KIND_LABEL: Record<string, string> = {
  practice: 'PRACTICE',
  qualifying: 'QUALIFYING',
  race: 'RACE',
  timetrial: 'TIME TRIAL'
};

const clock = (seconds: number): string => {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds - m * 60);
  return `${m}:${String(s).padStart(2, '0')}`;
};

export class SessionPanel {
  private readonly root: HTMLElement;
  private readonly kind: HTMLElement;
  private readonly clockEl: HTMLElement;
  private readonly progress: HTMLElement;
  private readonly rows: HTMLElement;
  private readonly banner: HTMLElement;

  constructor(mount: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'panel session';
    mount.appendChild(this.root);

    this.root.innerHTML = `
      <div class="session-head"><h3></h3><b class="clock"></b></div>
      <div class="progress"><i></i></div>
      <dl class="rows"></dl>
      <div class="banner"></div>
    `;

    this.kind = this.root.querySelector('h3')!;
    this.clockEl = this.root.querySelector('.clock')!;
    this.progress = this.root.querySelector('.progress i')!;
    this.rows = this.root.querySelector('.rows')!;
    this.banner = this.root.querySelector('.banner')!;
  }

  update(session: Session, timer: LapTimer): void {
    const state = session.state(timer);
    this.kind.textContent = KIND_LABEL[state.kind] ?? state.kind;

    this.clockEl.textContent =
      state.remaining !== null
        ? clock(state.remaining)
        : state.lapsTotal !== null
          ? `${Math.min(state.lapsDone + 1, state.lapsTotal)} / ${state.lapsTotal}`
          : clock(state.elapsed);

    this.progress.style.width = `${session.progress(timer) * 100}%`;

    const result = session.result(timer);
    const entries: Array<[string, string, string]> = [
      [result.label, formatTime(result.time), ''],
      ['track limits', `${state.strikes}`, state.strikes > 0 ? 'warn' : ''],
      [
        'penalties',
        state.penalties > 0 ? `${state.penalties} · +${state.penaltyTime.toFixed(0)}s` : '—',
        state.penalties > 0 ? 'bad' : ''
      ],
      ['pit stops', `${state.pitStops}`, '']
    ];

    this.rows.innerHTML = entries
      .map(([k, v, cls]) => `<dt>${k}</dt><dd class="${cls}">${v}</dd>`)
      .join('');

    // The banner is the one thing that must be unmissable.
    if (state.pitTimeRemaining !== null) {
      this.show(`IN THE PITS · ${state.pitTimeRemaining.toFixed(1)}s`, 'pit');
    } else if (state.phase === 'finished') {
      this.show('SESSION OVER', 'done');
    } else if (state.phase === 'chequered') {
      this.show('CHEQUERED FLAG · LAST LAP', 'flag');
    } else {
      this.show('', '');
    }
  }

  private show(text: string, kind: string): void {
    this.banner.textContent = text;
    this.banner.className = `banner ${kind}`;
  }
}
