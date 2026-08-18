/**
 * Speed lines.
 *
 * A simulator has a problem a comic does not: the honest picture of 300
 * km/h on a wide straight is a slow one. The scenery is far away, the
 * road ahead barely moves, and the only thing that changes quickly is a
 * number in the corner. Fast feels fast in a car because of noise and
 * load, neither of which a screen has.
 *
 * So this borrows the comic's answer. Lines converging on the vanishing
 * point are not a lens artefact or a physical effect — they are a
 * drawing convention for speed, and they work for the same reason the
 * black outline round the cars works: the eye reads the notation
 * directly, without having to be convinced.
 *
 * Drawn once as an SVG and then only ever given a new opacity and
 * scale, so the effect costs two style writes a frame and no layout.
 */

/** Below this the lines are off entirely (km/h). */
const FLOOR = 155;

/** Where they reach full strength (km/h). */
const CEILING = 315;

/** Strongest the ink ever gets. Past this it reads as damage. */
const MAX_OPACITY = 0.5;

const LINES = 52;

/**
 * The rays, as one path.
 *
 * Each is a thin wedge pointing inwards, ending short of the middle:
 * the centre of the screen is where the corner is, and it has to stay
 * clear. Lengths and widths are jittered, because an even fan reads as
 * a machine part rather than as ink.
 *
 * Deterministic jitter rather than `Math.random`, so the pattern is the
 * same every session — the tests build the UI, and a screenshot that
 * differs every run is one nobody can check.
 */
const buildPath = (): string => {
  const parts: string[] = [];

  for (let i = 0; i < LINES; i++) {
    // An irrational step walks the circle without ever repeating, which
    // gives an even spread that is nowhere regular.
    const angle = i * 2.39996 + (i % 3) * 0.11;
    const jitter = ((i * 7919) % 97) / 97;

    const inner = 30 + jitter * 26;
    const outer = 150 + jitter * 40;
    const halfWidth = (0.9 + jitter * 1.9) * (Math.PI / 180);

    const point = (r: number, a: number): string =>
      `${(Math.cos(a) * r).toFixed(2)} ${(Math.sin(a) * r).toFixed(2)}`;

    parts.push(
      `M${point(inner, angle)}` +
        `L${point(outer, angle - halfWidth)}` +
        `L${point(outer, angle + halfWidth)}Z`
    );
  }

  return parts.join('');
};

export class SpeedLines {
  private readonly root: HTMLElement;
  private strength = -1;

  constructor(mount: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'speed-lines';
    /* `slice` keeps the rays radial on any aspect ratio. Stretching the
       viewBox to fit would fan them into ellipses, which stops reading
       as motion and starts reading as a lens. */
    this.root.innerHTML =
      `<svg viewBox="-100 -100 200 200" preserveAspectRatio="xMidYMid slice" aria-hidden="true">` +
      `<path d="${buildPath()}" /></svg>`;
    mount.appendChild(this.root);
  }

  update(kmh: number): void {
    const ramp = Math.min(1, Math.max(0, (kmh - FLOOR) / (CEILING - FLOOR)));
    /* Squared, so the lines stay out of the way through the middle of
       the range and only arrive when the speed is genuinely unusual. */
    const strength = ramp * ramp;

    // Two decimals is finer than the eye and coarse enough that most
    // frames write nothing at all.
    if (Math.abs(strength - this.strength) < 0.005) return;
    this.strength = strength;

    this.root.style.opacity = (strength * MAX_OPACITY).toFixed(3);
    /* Pushing the rays outward as they strengthen widens the clear area
       in the middle, which is the part you are steering with. */
    this.root.style.transform = `scale(${(1 + strength * 0.14).toFixed(3)})`;
  }
}
