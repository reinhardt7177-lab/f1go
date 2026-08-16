/**
 * Where you are in the race, as opposed to where you are on the lap.
 *
 * The timing panel answers "how fast was that"; this answers "am I
 * winning". They are different questions and a driver looks at them at
 * different moments, so they are different panels.
 *
 * The gap is to the car ahead on the road and is quoted in seconds
 * rather than metres, because seconds are what a driver can act on —
 * two hundred metres means nothing without knowing how fast you are
 * closing it.
 */
export class PositionPanel {
  private readonly root: HTMLElement;
  private readonly place: HTMLElement;
  private readonly gap: HTMLElement;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'panel position';
    this.root.innerHTML =
      '<div class="cap">POSITION</div>' +
      '<div class="place"><span id="pos-place">--</span><small id="pos-of"></small></div>' +
      '<div class="cap">GAP AHEAD</div>' +
      '<div class="gap" id="pos-gap">—</div>';
    parent.appendChild(this.root);
    this.place = this.root.querySelector('#pos-place')!;
    this.gap = this.root.querySelector('#pos-gap')!;
  }

  /**
   * @param place   1-based
   * @param of      size of the field, player included
   * @param gapM    metres to the car ahead, or null when leading
   * @param speed   the player's speed, m/s, to turn metres into seconds
   */
  update(place: number, of: number, gapM: number | null, speed: number): void {
    this.place.textContent = String(place);
    this.root.querySelector('#pos-of')!.textContent = ` / ${of}`;

    if (gapM === null) {
      this.gap.textContent = 'LEADER';
      return;
    }
    /* Below a crawl the arithmetic explodes — a car stopped on the
       grid is not "four hundred seconds behind", it is just behind. */
    if (speed < 5) {
      this.gap.textContent = `${Math.round(gapM)} m`;
      return;
    }
    this.gap.textContent = `+${(gapM / speed).toFixed(1)}s`;
  }
}
