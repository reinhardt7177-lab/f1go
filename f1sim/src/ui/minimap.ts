/**
 * The circuit, seen from above.
 *
 * A driver's problem in traffic is not knowing where the next car is —
 * the gap readout answers that — but knowing where it is *on the
 * circuit*: whether the car you are chasing is about to reach a corner
 * you could follow it through, or has already cleared it and is gone.
 * From inside the cockpit that question is unanswerable, because the
 * only part of the lap you can see is the two hundred metres in front
 * of you.
 *
 * It also answers a question a first-time player has and nobody else
 * does — *what shape is this place, and how much of it is left* — which
 * on a seven kilometre circuit is otherwise learned only by driving it
 * four times.
 *
 * Two canvases: the circuit is drawn once, because it never changes,
 * and the cars are drawn over a copy of it every frame. Redrawing a
 * thousand-segment outline sixty times a second to move ten dots would
 * be most of a frame's budget spent on the one thing in the picture
 * that is constant.
 */
import type { Rival } from '../race/field';
import type { Circuit } from '../track/circuit';

/** Drawing size. Scaled to the element by CSS, so this is resolution. */
const SIZE = 260;

/** Space left round the outline, in the same units (px). */
const PAD = 18;

/** Metres between samples of the centreline. */
const STEP = 12;

export class Minimap {
  private readonly root: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  /** The circuit, drawn once and blitted every frame. */
  private readonly base: HTMLCanvasElement;

  private readonly circuit: Circuit;
  /** Centreline in canvas coordinates, indexed by sample. */
  private readonly path: { x: number; y: number }[] = [];

  constructor(mount: HTMLElement, circuit: Circuit) {
    this.circuit = circuit;

    this.root = document.createElement('div');
    this.root.className = 'minimap';
    this.canvas = document.createElement('canvas');
    this.canvas.width = SIZE;
    this.canvas.height = SIZE;
    this.root.appendChild(this.canvas);
    mount.appendChild(this.root);

    this.ctx = this.canvas.getContext('2d')!;
    this.base = document.createElement('canvas');
    this.base.width = SIZE;
    this.base.height = SIZE;

    this.buildPath();
    this.drawCircuit();
  }

  /**
   * Sample the centreline and fit it to the canvas.
   *
   * The fit is a single uniform scale rather than one per axis: a
   * circuit stretched to fill a square is a different shape, and the
   * whole value of this is being able to recognise the corner you are
   * in from its shape.
   *
   * `+z` is drawn downward. The world's forward is `-z`, so a plan view
   * that put `+z` up would be a mirror image of every track map ever
   * printed of the place.
   */
  private buildPath(): void {
    const raw: { x: number; z: number }[] = [];
    for (let s = 0; s < this.circuit.length; s += STEP) {
      const p = this.circuit.spline.sampleAt(s).position;
      raw.push({ x: p.x, z: p.z });
    }

    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const p of raw) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z);
      maxZ = Math.max(maxZ, p.z);
    }

    const span = Math.max(maxX - minX, maxZ - minZ, 1);
    const scale = (SIZE - PAD * 2) / span;
    // Centre whichever axis is the shorter one.
    const offX = (SIZE - (maxX - minX) * scale) / 2;
    const offY = (SIZE - (maxZ - minZ) * scale) / 2;

    for (const p of raw) {
      this.path.push({
        x: (p.x - minX) * scale + offX,
        y: (p.z - minZ) * scale + offY
      });
    }
  }

  /** Where a distance along the lap falls on the canvas. */
  private at(distance: number): { x: number; y: number } {
    const n = this.path.length;
    const wrapped = ((distance % this.circuit.length) + this.circuit.length) % this.circuit.length;
    const i = Math.floor(wrapped / STEP) % n;
    return this.path[i] ?? { x: 0, y: 0 };
  }

  /**
   * The outline, drawn once.
   *
   * Twice, really: a heavy black stroke and a lighter one over it, which
   * is how you draw a road at this size. A single-width line is a wire
   * diagram; a pale line inside a black one reads as tarmac with kerbs,
   * and it is the same convention as the ink round everything else.
   */
  private drawCircuit(): void {
    const c = this.base.getContext('2d')!;
    c.clearRect(0, 0, SIZE, SIZE);
    if (this.path.length < 2) return;

    const trace = (): void => {
      c.beginPath();
      c.moveTo(this.path[0]!.x, this.path[0]!.y);
      for (let i = 1; i < this.path.length; i++) c.lineTo(this.path[i]!.x, this.path[i]!.y);
      c.closePath();
    };

    c.lineJoin = 'round';
    c.lineCap = 'round';

    trace();
    c.strokeStyle = '#000';
    c.lineWidth = 13;
    c.stroke();

    trace();
    c.strokeStyle = '#8a939d';
    c.lineWidth = 7;
    c.stroke();

    /* The start line, across the road rather than along it. Without it
       a closed loop has no beginning, and "how much of the lap is left"
       is exactly what this is for. */
    const start = this.at(0);
    const next = this.at(STEP * 2);
    const dx = next.x - start.x;
    const dy = next.y - start.y;
    const len = Math.hypot(dx, dy) || 1;
    c.strokeStyle = '#fff';
    c.lineWidth = 3.5;
    c.beginPath();
    c.moveTo(start.x - (dy / len) * 7, start.y + (dx / len) * 7);
    c.lineTo(start.x + (dy / len) * 7, start.y - (dx / len) * 7);
    c.stroke();
  }

  /** A car: a filled disc with the same black line as everything else. */
  private dot(
    c: CanvasRenderingContext2D,
    distance: number,
    fill: string,
    radius: number
  ): void {
    const p = this.at(distance);
    c.beginPath();
    c.arc(p.x, p.y, radius, 0, Math.PI * 2);
    c.fillStyle = fill;
    c.fill();
    c.lineWidth = 2.5;
    c.strokeStyle = '#000';
    c.stroke();
  }

  update(playerDistance: number, rivals: readonly Rival[]): void {
    const c = this.ctx;
    c.clearRect(0, 0, SIZE, SIZE);
    c.drawImage(this.base, 0, 0);

    for (const rival of rivals) this.dot(c, rival.distance, rival.colour, 5);
    /* The player last and larger, so a car being lapped never hides the
       one dot you are actually looking for. */
    this.dot(c, playerDistance, '#ffffff', 6.5);
  }
}
