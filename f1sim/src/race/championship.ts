/**
 * Points across a season.
 *
 * A single race is a lap time; a championship is a reason to come back.
 * The table lives in localStorage under the same key the arcade game
 * used, so a season started there carries over rather than resetting
 * when the two halves became one.
 *
 * Scoring is deliberately dumb: it takes a finishing order and adds
 * points. It knows nothing about circuits, physics or sessions, which
 * is what lets it sit above both.
 */

/** The current F1 allocation, first to tenth. */
export const POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];

const KEY = 'f1go-season';

export type Table = Record<string, number>;

export const loadSeason = (): Table => {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Table) : {};
  } catch {
    /* A corrupt or blocked store is not worth failing a race over. */
    return {};
  }
};

export const saveSeason = (table: Table): void => {
  try {
    localStorage.setItem(KEY, JSON.stringify(table));
  } catch {
    /* Private browsing, quota, or a user who has turned it off. The
       race still happened; it just will not be remembered. */
  }
};

export const resetSeason = (): void => {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing to undo */
  }
};

/**
 * Score a finishing order into the season table.
 *
 * @returns the points the player took, for the results screen.
 */
export const score = (order: { name: string; player: boolean }[]): number => {
  const table = loadSeason();
  let earned = 0;
  order.forEach((row, i) => {
    const pts = POINTS[i] ?? 0;
    table[row.name] = (table[row.name] ?? 0) + pts;
    if (row.player) earned = pts;
  });
  saveSeason(table);
  return earned;
};

/** The table as a sorted list, for display. */
export const standings = (): { name: string; points: number }[] =>
  Object.entries(loadSeason())
    .map(([name, points]) => ({ name, points }))
    .sort((a, b) => b.points - a.points);

/* ------------------------------------------------------------------
   Best laps, kept per circuit. Also shares the arcade game's keys.
   ------------------------------------------------------------------ */
const bestKey = (circuitId: string): string => `f1go-best-${circuitId}`;

export const loadBest = (circuitId: string): number | null => {
  try {
    const v = Number.parseFloat(localStorage.getItem(bestKey(circuitId)) ?? '');
    return Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
};

export const saveBest = (circuitId: string, seconds: number): void => {
  try {
    localStorage.setItem(bestKey(circuitId), seconds.toFixed(3));
  } catch {
    /* see saveSeason */
  }
};

/** Records a lap and says whether it was a new best. */
export const recordLap = (circuitId: string, seconds: number): boolean => {
  const best = loadBest(circuitId);
  if (best !== null && seconds >= best) return false;
  saveBest(circuitId, seconds);
  return true;
};
