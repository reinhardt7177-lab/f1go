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

/**
 * The trophy, drawn.
 *
 * Inline SVG rather than an image for the same reason the cars are
 * geometry rather than a model: it is a handful of shapes, it has to
 * come in three metals, and it has to carry the same heavy black line
 * as everything else on screen. A file could do none of those without
 * being three files.
 *
 * Only the top three get one. A trophy handed to everybody is not a
 * trophy, and a child who finishes fourth knowing exactly what they
 * missed has a reason to press RACE AGAIN — which is the only thing
 * this screen is really for.
 */
const TROPHY_METAL: Record<number, [string, string, string]> = {
  1: ['#f5c518', '#c99a06', 'CHAMPION'],
  2: ['#cfd6dd', '#98a2ad', 'SECOND'],
  3: ['#cd7f32', '#9a5d24', 'THIRD']
};

const trophy = (place: number): string => {
  const metal = TROPHY_METAL[place];
  if (!metal) return '';
  const [light, dark, label] = metal;

  return (
    `<svg class="trophy" viewBox="0 0 120 140" aria-label="${label}">` +
    // Handles, drawn behind the cup so the cup's own line closes over
    // them and the three read as one object rather than three.
    `<path d="M32 34 C10 34 10 66 34 70" fill="none" stroke="#000" stroke-width="7"/>` +
    `<path d="M88 34 C110 34 110 66 86 70" fill="none" stroke="#000" stroke-width="7"/>` +
    `<path d="M32 34 C14 34 14 63 34 67" fill="none" stroke="${dark}" stroke-width="3"/>` +
    `<path d="M88 34 C106 34 106 63 86 67" fill="none" stroke="${dark}" stroke-width="3"/>` +
    // Cup, stem, base.
    `<path d="M28 24 H92 V56 C92 78 78 90 60 90 C42 90 28 78 28 56 Z" ` +
    `fill="${light}" stroke="#000" stroke-width="4" stroke-linejoin="round"/>` +
    `<path d="M28 24 H92 V38 H28 Z" fill="${dark}" stroke="#000" stroke-width="4"/>` +
    `<rect x="52" y="88" width="16" height="18" fill="${dark}" stroke="#000" stroke-width="4"/>` +
    `<path d="M34 106 H86 L92 124 H28 Z" fill="${light}" stroke="#000" stroke-width="4" stroke-linejoin="round"/>` +
    `<text x="60" y="72" text-anchor="middle" font-size="26" font-weight="800" fill="#000">${place}</text>` +
    '</svg>'
  );
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
      trophy(place) +
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
