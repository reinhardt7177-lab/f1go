/* ------------------------------------------------------------------
   TrackSpline — the centreline, sampled around the car.

   WHY THIS IS A ROLLING WINDOW AND NOT A CLOSED LOOP
   --------------------------------------------------
   The obvious design is to integrate the whole circuit once into a
   closed 3D loop and drive around inside it. That was tried and it
   does not work with this data, for a reason worth writing down.

   These circuits were authored as *sequences of corners*, by feel.
   Nothing ever required them to close. Measured, they miss the start
   line by 5% to 54% of a lap — and forcing them shut distorts every
   corner on the track, which changes how the game drives. Since the
   brief is to keep the gameplay exactly as it is, the geometry has to
   bend to the physics rather than the other way round.

   So the world is generated the way the original 2D renderer draws it:
   a window of road around the car, in a local frame with the car at
   the origin facing -Z. Nothing far away needs to line up with
   anything, because nothing far away is ever drawn — the fog closes in
   well before the seam would. The player cannot tell the difference,
   and the physics never has to be re-tuned.

   The window is re-integrated every frame. That sounds expensive and
   is not: it is a few hundred iterations of two trig calls, into
   preallocated arrays, and it buys automatic level of detail — the
   triangle count depends on the draw distance, never on the circuit.
   ------------------------------------------------------------------ */
import * as THREE from 'three';

/* The road's half-width in metres — the one dimension a player can
   judge on screen, so the scale is anchored here. */
const ROAD_HALF_WIDTH_M = 8;

/* The circuits are authored far wider than they are long, which is a
   gameplay choice worth keeping. Stretching the longitudinal axis puts
   the straights back into believable proportion. Cosmetic only: the
   physics never sees metres. */
const LONGITUDINAL_STRETCH = 4;

/* Radians of bend per unit of `curve`, per segment. Set so a
   CRV.HAIRPIN comes out around a 20 m radius and a CRV.EASY around
   110 m — hairpin and fast kink respectively, which is what those
   values mean in tracks.js. */
const CURVE_TO_RADIANS = 0.0095;

export class TrackSpline {
  /**
   * @param segments        Game.segments
   * @param roadWidthUnits  ROAD_WIDTH (half-width, game units)
   * @param segmentLength   SEGMENT_LENGTH
   */
  constructor(segments, roadWidthUnits, segmentLength) {
    this.segments = segments;
    this.segmentCount = segments.length;
    this.segmentLength = segmentLength;
    this.lapUnits = segments.length * segmentLength;

    this.metersPerUnit = ROAD_HALF_WIDTH_M / roadWidthUnits;
    this.halfWidth = ROAD_HALF_WIDTH_M;
    this.stepM = segmentLength * this.metersPerUnit * LONGITUDINAL_STRETCH;
    this.lengthM = this.segmentCount * this.stepM;

    /* Curvature per segment, precomputed once — it is read every frame
       for the road, the kerbs and the barriers. */
    this.bend = new Float32Array(this.segmentCount);
    for (let i = 0; i < this.segmentCount; i++) {
      this.bend[i] = segments[i].curve * CURVE_TO_RADIANS;
    }

    /* Compass heading at each segment, accumulated from the start.
       The rolling window always puts the car at the origin facing -Z,
       which means the distant scenery has to rotate instead — without
       this the mountains would swing round with every corner and sit
       in a different place each lap. */
    this.absHeading = new Float32Array(this.segmentCount);
    let h = 0;
    for (let i = 0; i < this.segmentCount; i++) {
      h += this.bend[i];
      this.absHeading[i] = h;
    }

    /* --- the window ---------------------------------------------- */
    /* Sized once, at the largest draw distance any quality tier asks
       for, and then only partly filled. Growing it mid-race would mean
       reallocating every buffer downstream of it. */
    this.maxStations = 512;
    this.count = 0;

    this.px = new Float32Array(this.maxStations);
    this.py = new Float32Array(this.maxStations);
    this.pz = new Float32Array(this.maxStations);
    /* Unit tangent, and the left-hand normal, per station. */
    this.tx = new Float32Array(this.maxStations);
    this.tz = new Float32Array(this.maxStations);
    this.nx = new Float32Array(this.maxStations);
    this.nz = new Float32Array(this.maxStations);
    /* Distance from the car, and the source segment — the road needs
       the first for fog and LOD, the trackside needs the second to
       know which props belong here. */
    this.dist = new Float32Array(this.maxStations);
    this.segIndex = new Int32Array(this.maxStations);

    /** Segment index the car is in, and how far through it. */
    this.carSegment = 0;
    this.carFrac = 0;
  }

  /** Wrap a segment index into range. */
  wrap(i) {
    const n = this.segmentCount;
    return ((i % n) + n) % n;
  }

  /**
   * Rebuild the window around the car.
   *
   * @param distanceUnits  the game's `position` — where the car is
   * @param aheadM         how far forward to generate
   * @param behindM        how far back (for mirrors and the car's own
   *                       shadow; a little goes a long way)
   * @param stride         segments per station; 1 is full detail, and
   *                       the road stepping up to 2 or 3 in the
   *                       distance is invisible and nearly free
   */
  build(distanceUnits, aheadM, behindM, stride) {
    const step = this.stepM;
    const lap = ((distanceUnits % this.lapUnits) + this.lapUnits) % this.lapUnits;
    const exact = lap / this.segmentLength;
    this.carSegment = Math.floor(exact);
    this.carFrac = exact - this.carSegment;

    const back = Math.max(1, Math.round(behindM / step));
    const fwd = Math.max(8, Math.round(aheadM / step));
    const st = Math.max(1, stride | 0);

    /* Walk backwards from the car first, then forwards, so the whole
       window comes out in travel order and the road mesh can just run
       down it. The car sits at the origin facing -Z, so the frame is
       built by integrating heading out from zero in both directions. */
    let heading = 0;
    let x = 0;
    let z = 0;

    /* Reverse pass: step back along the ribbon, undoing each bend. */
    const backX = [];
    const backZ = [];
    const backH = [];
    const backSeg = [];
    for (let k = 0; k < back; k++) {
      const seg = this.wrap(this.carSegment - k);
      /* Undo this segment's bend before stepping back through it. */
      x -= Math.sin(heading) * step;
      z += Math.cos(heading) * step;
      heading -= this.bend[seg];
      backX.push(x); backZ.push(z); backH.push(heading); backSeg.push(seg);
    }

    let n = 0;
    for (let k = back - 1; k >= 0; k -= st) {
      this._station(n++, backX[k], backZ[k], backH[k], backSeg[k], -(k + 1) * step);
      if (n >= this.maxStations) break;
    }

    /* Forward pass from the car's exact position. */
    heading = 0;
    x = 0;
    z = 0;
    /* Start at the car, backed off by however far it is into its
       current segment, so the geometry lines up with the physics. */
    z += this.carFrac * step;

    for (let k = 0; k < fwd && n < this.maxStations; k++) {
      const seg = this.wrap(this.carSegment + k);
      if (k % st === 0) {
        this._station(n++, x, z, heading, seg, k * step);
      }
      heading += this.bend[seg];
      x += Math.sin(heading) * step;
      z -= Math.cos(heading) * step;
    }

    this.count = n;

    /* Tangents and normals from the finished polyline: taking them
       from the integrated heading instead would ignore the stride and
       leave the road twisted where stations are far apart. */
    for (let i = 0; i < n; i++) {
      const j = Math.min(i + 1, n - 1);
      const h = Math.max(i - 1, 0);
      let dx = this.px[j] - this.px[h];
      let dz = this.pz[j] - this.pz[h];
      const len = Math.hypot(dx, dz) || 1;
      dx /= len; dz /= len;
      this.tx[i] = dx;
      this.tz[i] = dz;
      /* Left of travel: rotate the tangent by +90° about Y. */
      this.nx[i] = dz;
      this.nz[i] = -dx;
    }

    return n;
  }

  _station(i, x, z, heading, seg, dist) {
    this.px[i] = x;
    this.py[i] = 0;
    this.pz[i] = z;
    this.segIndex[i] = seg;
    this.dist[i] = dist;
    /* Tangent/normal are filled in after the walk. */
  }

  /**
   * Where something sits in the current local frame.
   *
   * @param distanceUnits  its `position` / `z` along the ribbon
   * @param lateral        normalised offset, the same units the physics
   *                       uses (1 = the edge of the road)
   * @returns {x, y, z, heading} or null when it is outside the window
   */
  localPose(distanceUnits, lateral, out) {
    const target = out || { x: 0, y: 0, z: 0, heading: 0 };
    const n = this.count;
    if (!n) return null;

    /* Distance from the car along the ribbon, wrapped to the shorter
       way round so a rival just behind is not reported a lap ahead. */
    let delta = distanceUnits - (this.carSegment + this.carFrac) * this.segmentLength;
    const half = this.lapUnits / 2;
    if (delta > half) delta -= this.lapUnits;
    if (delta < -half) delta += this.lapUnits;

    const wantM = (delta / this.segmentLength) * this.stepM;
    if (wantM < this.dist[0] || wantM > this.dist[n - 1]) return null;

    /* The window is monotonic in distance, so a scan from a
       proportional guess lands in a couple of steps. */
    let i = Math.min(n - 2, Math.max(0, Math.round(
      ((wantM - this.dist[0]) / (this.dist[n - 1] - this.dist[0])) * (n - 1))));
    while (i > 0 && this.dist[i] > wantM) i--;
    while (i < n - 2 && this.dist[i + 1] < wantM) i++;

    const span = this.dist[i + 1] - this.dist[i] || 1;
    const f = (wantM - this.dist[i]) / span;

    const px = this.px[i] + (this.px[i + 1] - this.px[i]) * f;
    const pz = this.pz[i] + (this.pz[i + 1] - this.pz[i]) * f;
    const nx = this.nx[i] + (this.nx[i + 1] - this.nx[i]) * f;
    const nz = this.nz[i] + (this.nz[i + 1] - this.nz[i]) * f;

    /* `lateral` grows to the driver's right; the normal points left. */
    target.x = px - nx * lateral * this.halfWidth;
    target.y = 0;
    target.z = pz - nz * lateral * this.halfWidth;
    const tx = this.tx[i] + (this.tx[i + 1] - this.tx[i]) * f;
    const tz = this.tz[i] + (this.tz[i + 1] - this.tz[i]) * f;
    target.heading = Math.atan2(tx, -tz);
    return target;
  }

  dispose() {
    this.segments = null;
  }
}
