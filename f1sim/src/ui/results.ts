/**
 * The chequered flag: where you finished, what it was worth, and where
 * that leaves the season.
 *
 * The simulator could already tell you a lap time to a thousandth and
 * nothing at all about whether the race went well. A finishing position
 * against nine other cars, and a points table that remembers the last
 * one, is what turns a timed run into a reason to start another.
 */
import { resetSeason } from '../race/championship';

const ordinal = (n: number): string => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
};

export class ResultsPanel {
  private readonly root: HTMLElement;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.id = 'results';
    this.root.className = 'hidden';
    parent.appendChild(this.root);
  }

  /**
   * @param order      finishing order, player flagged
   * @param earned     points the player took
   * @param standings  the season table after scoring
   */
  show(
    order: { name: string; player: boolean }[],
    earned: number,
    standings: { name: string; points: number }[]
  ): void {
    const place = order.findIndex((r) => r.player) + 1;
    const headline = place === 1 ? 'RACE WIN' : place <= 3 ? 'PODIUM' : 'CHEQUERED FLAG';

    const rows = order
      .map(
        (r, i) =>
          `<div class="row${r.player ? ' me' : ''}">` +
          `<span>${i + 1}. ${r.name}</span><span>${i < 10 ? `+${[25, 18, 15, 12, 10, 8, 6, 4, 2, 1][i]}` : ''}</span>` +
          '</div>'
      )
      .join('');

    const table = standings
      .map(
        (s, i) =>
          `<div class="row${s.name === 'YOU' ? ' me' : ''}">` +
          `<span>${i + 1}. ${s.name}</span><span>${s.points}</span></div>`
      )
      .join('');

    this.root.innerHTML =
      `<div class="headline">${headline}</div>` +
      `<div class="place">${ordinal(place)}</div>` +
      `<div class="earned">${earned > 0 ? `+${earned} PTS` : 'NO POINTS'}</div>` +
      '<div class="cols">' +
      `<div class="col"><div class="cap">RESULT</div>${rows}</div>` +
      `<div class="col"><div class="cap">CHAMPIONSHIP</div>${table}</div>` +
      '</div>' +
      '<div class="actions">' +
      '<button type="button" id="results-again">RACE AGAIN</button>' +
      '<button type="button" id="results-reset">RESET SEASON</button>' +
      '</div>';

    this.root.classList.remove('hidden');

    /* A reload is the honest way to restart here: the session, the
       field and the car all carry state that a partial reset would
       have to unwind by hand, and getting one of them wrong shows up
       as a race that starts with someone already a lap up. */
    this.root.querySelector('#results-again')!.addEventListener('click', () => {
      location.reload();
    });
    this.root.querySelector('#results-reset')!.addEventListener('click', () => {
      resetSeason();
      location.reload();
    });
  }

  hide(): void {
    this.root.classList.add('hidden');
  }
}
