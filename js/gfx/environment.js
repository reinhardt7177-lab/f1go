/* ------------------------------------------------------------------
   EnvironmentManager — everything beside and beyond the road.

   Two quite different jobs live here, split by how far away they are.

   NEAR (barriers, catch fencing, braking boards, marshal posts) rolls
   with the window: it is placed from the same station data as the
   road, rebuilt each frame, and every category is a single
   InstancedMesh. These are the objects that give a street circuit its
   width — a Monaco without walls a metre off the kerb is just a road.

   FAR (skyline, hills, harbour) does not roll at all. The window keeps
   the car at the origin facing -Z, so the world turns around it; a
   mountain placed in that frame would swing across the horizon at
   every corner. Instead the distant scenery is a fixed backdrop that
   counter-rotates by the car's compass heading, which is what makes
   it read as a place the circuit is *in* rather than wallpaper.
   ------------------------------------------------------------------ */
import * as THREE from 'three';

const MAX_BARRIERS = 220;
const MAX_FENCE = 120;
const MAX_BOARDS = 18;
const MAX_MARSHALS = 10;

/* What sits beyond the barriers, per circuit. Kept here rather than in
   tracks.js so the game's own files stay untouched. */
const SCENERY = {
  monaco:      { city: 'riviera', hills: 'steep',  harbour: true,  trees: false },
  singapore:   { city: 'towers',  hills: 'none',   harbour: true,  trees: false },
  monza:       { city: 'none',    hills: 'low',    harbour: false, trees: true },
  silverstone: { city: 'none',    hills: 'none',   harbour: false, trees: true },
  suzuka:      { city: 'none',    hills: 'low',    harbour: false, trees: true },
  spa:         { city: 'none',    hills: 'steep',  harbour: false, trees: true },
  interlagos:  { city: 'towers',  hills: 'low',    harbour: false, trees: true },
  bahrain:     { city: 'none',    hills: 'dunes',  harbour: false, trees: false },
  cota:        { city: 'towers',  hills: 'low',    harbour: false, trees: true },
  redbullring: { city: 'none',    hills: 'steep',  harbour: false, trees: true }
};

/** Chain-link: an alpha-tested grid, which is what a fence is. */
const makeFenceTexture = () => {
  const s = 64;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, s, s);
  ctx.strokeStyle = 'rgba(190,200,210,0.95)';
  ctx.lineWidth = 1.5;
  /* Diagonals both ways: a square grid reads as a window frame, the
     diamond weave reads as catch fencing. */
  for (let i = -s; i < s * 2; i += 8) {
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + s, s); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(i, s); ctx.lineTo(i + s, 0); ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
};

/** A braking board: big number on a dark panel. */
const makeBoardTexture = (label) => {
  const w = 96, h = 128;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#15181d';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#f2f4f6';
  ctx.font = 'bold 74px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, w / 2, h / 2 + 4);
  return new THREE.CanvasTexture(c);
};

export class EnvironmentManager {
  constructor(parent, theme, trackId) {
    this.theme = theme;
    this.scenery = SCENERY[trackId] || SCENERY.silverstone;
    this.walls = !!(theme && theme.walls);

    this.near = new THREE.Group();
    parent.add(this.near);

    /* The backdrop turns with the compass, not with the window. */
    this.far = new THREE.Group();
    parent.add(this.far);

    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._pos = new THREE.Vector3();
    this._scl = new THREE.Vector3(1, 1, 1);
    this._up = new THREE.Vector3(0, 1, 0);

    this._buildBarriers();
    this._buildFencing();
    this._buildBoards();
    this._buildMarshals();
    this._buildBackdrop();
  }

  /* --- concrete barrier ------------------------------------------- */
  _buildBarriers() {
    /* A tapered block: wider at the base, like a real Jersey barrier.
       Length 4 m so a run of them needs few instances. */
    const g = new THREE.BoxGeometry(0.42, 1.05, 4.0);
    this.barrierMat = new THREE.MeshStandardMaterial({
      color: 0xc8ccd2, roughness: 0.88, metalness: 0
    });
    this.barriers = new THREE.InstancedMesh(g, this.barrierMat, MAX_BARRIERS);
    this.barriers.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.barriers.frustumCulled = false;
    this.barriers.castShadow = false;
    this.barriers.receiveShadow = true;
    this.barriers.count = 0;
    this.near.add(this.barriers);

    /* The red band along the top, as a second instanced run so the
       whole thing is still two draw calls rather than a texture. */
    const bandGeo = new THREE.BoxGeometry(0.44, 0.16, 4.0);
    this.bandMat = new THREE.MeshStandardMaterial({
      color: 0xd0402f, roughness: 0.7, metalness: 0
    });
    this.bands = new THREE.InstancedMesh(bandGeo, this.bandMat, MAX_BARRIERS);
    this.bands.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.bands.frustumCulled = false;
    this.bands.count = 0;
    this.near.add(this.bands);

    /* Advertising hoardings on the barrier face. A grand prix circuit
       is lined with them, and their colour is most of what stops a
       wall of concrete reading as a tunnel. Per-instance colour keeps
       the whole run to one draw call. */
    const adGeo = new THREE.PlaneGeometry(4.0, 0.72);
    this.adMat = new THREE.MeshStandardMaterial({
      roughness: 0.55, metalness: 0, side: THREE.DoubleSide
    });
    this.ads = new THREE.InstancedMesh(adGeo, this.adMat, MAX_BARRIERS);
    this.ads.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.ads.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(MAX_BARRIERS * 3), 3);
    this.ads.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.ads.frustumCulled = false;
    this.ads.count = 0;
    this.near.add(this.ads);

    this.adColors = [0x1b4fa8, 0xd8232a, 0xf0f2f4, 0x11835a, 0xf2a81d, 0x24262b];
    this._adColor = new THREE.Color();
  }

  /* --- catch fencing ---------------------------------------------- */
  _buildFencing() {
    const tex = makeFenceTexture();
    tex.repeat.set(3, 2);
    this.fenceMat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      alphaTest: 0.35,
      side: THREE.DoubleSide,
      fog: true,
      depthWrite: false
    });
    const g = new THREE.PlaneGeometry(4.0, 2.4);
    this.fence = new THREE.InstancedMesh(g, this.fenceMat, MAX_FENCE);
    this.fence.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.fence.frustumCulled = false;
    this.fence.count = 0;
    this.fence.renderOrder = 1;
    this.near.add(this.fence);

    /* Posts, so the mesh has something to hang from. */
    const post = new THREE.BoxGeometry(0.10, 2.6, 0.10);
    this.postMat = new THREE.MeshStandardMaterial({
      color: 0x6f757d, roughness: 0.6, metalness: 0.4
    });
    this.posts = new THREE.InstancedMesh(post, this.postMat, MAX_FENCE);
    this.posts.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.posts.frustumCulled = false;
    this.posts.count = 0;
    this.near.add(this.posts);
  }

  /* --- braking boards --------------------------------------------- */
  _buildBoards() {
    this.boards = [];
    const labels = ['150', '100', '50'];
    for (let i = 0; i < labels.length; i++) {
      const mat = new THREE.MeshBasicMaterial({
        map: makeBoardTexture(labels[i]),
        side: THREE.DoubleSide
      });
      const mesh = new THREE.InstancedMesh(
        new THREE.PlaneGeometry(0.95, 1.25), mat, MAX_BOARDS);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.count = 0;
      this.near.add(mesh);
      this.boards.push({ mesh, mat, at: 150 - i * 50 });
    }
  }

  /* --- marshal posts ---------------------------------------------- */
  _buildMarshals() {
    this.marshalMat = new THREE.MeshStandardMaterial({
      color: 0xf07316, roughness: 0.75, metalness: 0
    });
    /* A marshal reads as an orange upright at this distance; the
       detail that matters is that something human is standing there. */
    const g = new THREE.CapsuleGeometry(0.22, 0.75, 3, 6);
    this.marshals = new THREE.InstancedMesh(g, this.marshalMat, MAX_MARSHALS);
    this.marshals.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.marshals.frustumCulled = false;
    this.marshals.count = 0;
    this.near.add(this.marshals);
  }

  /* --- the world beyond ------------------------------------------- */
  _buildBackdrop() {
    const t = this.theme;
    const haze = new THREE.Color(t ? t.haze : '#c8d3da');
    const s = this.scenery;

    /* Sky dome. A vertex-coloured sphere rather than a flat clear
       colour: the gradient from zenith to horizon is most of what
       makes an outdoor scene feel like it has air in it. */
    const skyGeo = new THREE.SphereGeometry(2600, 24, 16);
    const zenith = new THREE.Color(t ? t.sky[0] : '#46586c');
    const mid = new THREE.Color(t ? t.sky[1] : '#7d92a5');
    const colors = new Float32Array(skyGeo.attributes.position.count * 3);
    const pos = skyGeo.attributes.position;
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i) / 2600;               // -1..1
      if (y > 0.35) c.copy(zenith).lerp(mid, 1 - (y - 0.35) / 0.65);
      else c.copy(mid).lerp(haze, Math.min(1, (0.35 - y) / 0.45));
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    }
    skyGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.sky = new THREE.Mesh(skyGeo, new THREE.MeshBasicMaterial({
      vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false
    }));
    this.sky.renderOrder = -1;
    this.far.add(this.sky);

    if (s.hills !== 'none') this.far.add(this._buildHills(s.hills, haze));
    if (s.city !== 'none') this.far.add(this._buildCity(s.city));
    if (s.harbour) this.far.add(this._buildHarbour());
    if (s.trees) this.far.add(this._buildTreeline());
  }

  /** A ridge of low-poly peaks around the horizon. */
  _buildHills(kind, haze) {
    const radius = kind === 'dunes' ? 900 : 1300;
    const peaks = kind === 'steep' ? 34 : 26;
    const base = kind === 'steep' ? 190 : kind === 'dunes' ? 45 : 90;

    const verts = [];
    const cols = [];
    const rock = new THREE.Color(kind === 'dunes' ? 0xc2a874 : 0x5c6f63);
    const far = new THREE.Color().copy(rock).lerp(haze, 0.55);
    const c = new THREE.Color();

    for (let i = 0; i < peaks; i++) {
      const a0 = (i / peaks) * Math.PI * 2;
      const a1 = ((i + 1) / peaks) * Math.PI * 2;
      const am = (a0 + a1) / 2;
      /* Deterministic heights: a random ridge that reshuffles on every
         track change reads as flicker, not landscape. */
      const h = base * (0.45 + (Math.abs(Math.sin(i * 12.9898) * 43758.5) % 1) * 0.85);

      const x0 = Math.cos(a0) * radius, z0 = Math.sin(a0) * radius;
      const x1 = Math.cos(a1) * radius, z1 = Math.sin(a1) * radius;
      const xm = Math.cos(am) * radius, zm = Math.sin(am) * radius;

      verts.push(x0, 0, z0, x1, 0, z1, xm, h, zm);
      c.copy(far); cols.push(c.r, c.g, c.b);
      cols.push(c.r, c.g, c.b);
      c.copy(rock).lerp(haze, 0.25); cols.push(c.r, c.g, c.b);
    }

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(cols), 3));
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
      vertexColors: true, side: THREE.DoubleSide, fog: false
    }));
    m.frustumCulled = false;
    return m;
  }

  /** Blocks of city on the hillside, or a skyline of towers. */
  _buildCity(kind) {
    const group = new THREE.Group();
    const count = kind === 'riviera' ? 120 : 70;
    const radius = kind === 'riviera' ? 420 : 700;

    const geo = new THREE.BoxGeometry(1, 1, 1);
    /* No `vertexColors` here: an InstancedMesh with instanceColor gets
       per-instance tinting on its own, and asking for vertex colours
       as well makes three look for a geometry colour attribute that
       does not exist — which comes out as the wrong colour entirely
       rather than as an error. */
    const mat = new THREE.MeshLambertMaterial({ fog: true });
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(count * 3), 3);
    mesh.frustumCulled = false;

    const m = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const scl = new THREE.Vector3();
    const col = new THREE.Color();
    /* Warm pale render for a Riviera hillside; cool glass for towers. */
    const palette = kind === 'riviera'
      ? [0xe8dcc8, 0xdcc9ad, 0xd9d2c4, 0xc9b79b, 0xeee3d2]
      : [0x6d7d8e, 0x58697a, 0x7c8b9a, 0x4a5765];

    for (let i = 0; i < count; i++) {
      const r1 = Math.abs(Math.sin(i * 12.9898) * 43758.5) % 1;
      const r2 = Math.abs(Math.sin(i * 78.233) * 12345.6) % 1;
      const r3 = Math.abs(Math.sin(i * 39.425) * 24680.1) % 1;

      const ang = (i / count) * Math.PI * 2 + r1 * 0.08;
      const rad = radius * (0.75 + r2 * 0.5);
      /* Riviera towns climb: the further back, the higher up. */
      const lift = kind === 'riviera' ? (rad - radius * 0.75) * 0.42 : 0;
      const h = kind === 'riviera' ? 18 + r3 * 46 : 40 + r3 * 150;
      const w = kind === 'riviera' ? 16 + r1 * 22 : 22 + r2 * 26;

      pos.set(Math.cos(ang) * rad, lift + h / 2, Math.sin(ang) * rad);
      q.setFromAxisAngle(this._up, -ang);
      scl.set(w, h, w * (0.7 + r2 * 0.6));
      m.compose(pos, q, scl);
      mesh.setMatrixAt(i, m);

      col.set(palette[i % palette.length]);
      mesh.instanceColor.setXYZ(i, col.r, col.g, col.b);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;
    group.add(mesh);
    return group;
  }

  /** Water on one side, with boats moored on it. */
  _buildHarbour() {
    const group = new THREE.Group();

    const water = new THREE.Mesh(
      new THREE.PlaneGeometry(1500, 900),
      new THREE.MeshStandardMaterial({
        color: 0x2f6f92, roughness: 0.18, metalness: 0.5
      })
    );
    water.rotation.x = -Math.PI / 2;
    water.position.set(520, -1.6, -180);
    water.frustumCulled = false;
    group.add(water);

    /* Yachts: white hulls with a lighter superstructure, all one
       instanced run because a marina is the same boat many times. */
    const hull = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshStandardMaterial({
      color: 0xf0f2f4, roughness: 0.5, metalness: 0.05
    });
    const count = 26;
    const boats = new THREE.InstancedMesh(hull, mat, count);
    boats.frustumCulled = false;
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      const r1 = Math.abs(Math.sin(i * 12.9898) * 43758.5) % 1;
      const r2 = Math.abs(Math.sin(i * 78.233) * 12345.6) % 1;
      const len = 14 + r1 * 26;
      p.set(180 + r2 * 460, 1.2, -420 + r1 * 640);
      q.setFromAxisAngle(this._up, r2 * 0.5);
      s.set(len * 0.28, 4 + r1 * 3, len);
      m.compose(p, q, s);
      boats.setMatrixAt(i, m);
    }
    boats.instanceMatrix.needsUpdate = true;
    group.add(boats);
    return group;
  }

  /** A band of trees behind the run-off at a parkland circuit. */
  _buildTreeline() {
    const count = 90;
    const geo = new THREE.ConeGeometry(1, 1, 5);
    const mat = new THREE.MeshLambertMaterial({ fog: true });
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(count * 3), 3);
    mesh.frustumCulled = false;

    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const c = new THREE.Color();
    const greens = [0x2f5230, 0x3a6238, 0x274828, 0x44703f];

    for (let i = 0; i < count; i++) {
      const r1 = Math.abs(Math.sin(i * 12.9898) * 43758.5) % 1;
      const r2 = Math.abs(Math.sin(i * 78.233) * 12345.6) % 1;
      const ang = (i / count) * Math.PI * 2;
      const rad = 190 + r1 * 130;
      const h = 12 + r2 * 14;
      p.set(Math.cos(ang) * rad, h / 2, Math.sin(ang) * rad);
      q.identity();
      s.set(5 + r1 * 4, h, 5 + r1 * 4);
      m.compose(p, q, s);
      mesh.setMatrixAt(i, m);
      c.set(greens[i % greens.length]);
      mesh.instanceColor.setXYZ(i, c.r, c.g, c.b);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;
    return mesh;
  }

  /* ----------------------------------------------------------------
     Per-frame: lay the near furniture along the window, and spin the
     backdrop to the car's compass heading.
     ---------------------------------------------------------------- */
  update(spline, detail, absHeading) {
    this.far.rotation.y = -absHeading;
    this._layBarriers(spline, detail);
    this._layBoards(spline);
    this._layMarshals(spline, detail);
  }

  _layBarriers(spline, detail) {
    const n = spline.count;
    const hw = spline.halfWidth;
    /* A barrier block is 4 m and a station is 2.13 m, so every second
       station lays a continuous wall. */
    const stride = Math.max(2, Math.round(2 / Math.max(0.3, detail)));
    /* Street circuits put the wall right against the kerb; permanent
       ones set it back behind the run-off. */
    const offset = this.walls ? 1.32 : 2.35;

    let b = 0, f = 0;
    for (let i = 0; i < n && b < MAX_BARRIERS - 1; i += stride) {
      const d = spline.dist[i];
      if (d < -8) continue;
      if (d > 330) break;

      const px = spline.px[i], pz = spline.pz[i];
      const nx = spline.nx[i], nz = spline.nz[i];
      const heading = Math.atan2(spline.tx[i], -spline.tz[i]);
      this._q.setFromAxisAngle(this._up, heading);

      for (const side of [-1, 1]) {
        if (b >= MAX_BARRIERS) break;
        const off = -side * hw * offset;
        this._pos.set(px + nx * off, 0.42, pz + nz * off);
        this._m.compose(this._pos, this._q, this._scl);
        this.barriers.setMatrixAt(b, this._m);

        this._pos.y = 1.02;
        this._m.compose(this._pos, this._q, this._scl);
        this.bands.setMatrixAt(b, this._m);

        /* Hoarding on the face that looks at the circuit, stepped just
           clear of the concrete so the two do not z-fight. */
        this._pos.set(px + nx * (off - side * 0.23), 0.52, pz + nz * (off - side * 0.23));
        const aq = new THREE.Quaternion().setFromAxisAngle(
          this._up, heading + Math.PI / 2);
        this._m.compose(this._pos, aq, this._scl);
        this.ads.setMatrixAt(b, this._m);
        /* Keyed to the segment so a given stretch of wall keeps its
           sponsor as the window rolls past it. */
        this._adColor.set(this.adColors[spline.segIndex[i] % this.adColors.length]);
        this.ads.instanceColor.setXYZ(b, this._adColor.r, this._adColor.g, this._adColor.b);
        b++;

        /* Catch fencing only on the side that faces the crowd, and
           only where a wall is close enough to carry it. */
        if (this.walls && f < MAX_FENCE - 1 && (i % (stride * 2) === 0)) {
          this._pos.set(px + nx * off, 2.15, pz + nz * off);
          const fq = new THREE.Quaternion().setFromAxisAngle(
            this._up, heading + Math.PI / 2);
          this._m.compose(this._pos, fq, this._scl);
          this.fence.setMatrixAt(f, this._m);

          this._pos.y = 1.30;
          this._m.compose(this._pos, this._q, this._scl);
          this.posts.setMatrixAt(f, this._m);
          f++;
        }
      }
    }

    this.barriers.count = b;
    this.bands.count = b;
    this.ads.count = b;
    this.fence.count = f;
    this.posts.count = f;
    this.barriers.instanceMatrix.needsUpdate = true;
    this.bands.instanceMatrix.needsUpdate = true;
    this.ads.instanceMatrix.needsUpdate = true;
    this.ads.instanceColor.needsUpdate = true;
    this.fence.instanceMatrix.needsUpdate = true;
    this.posts.instanceMatrix.needsUpdate = true;
  }

  /** Boards sit before a corner, counting down to the braking point. */
  _layBoards(spline) {
    const n = spline.count;
    const hw = spline.halfWidth;
    const counts = [0, 0, 0];

    for (let i = 4; i < n - 1; i++) {
      const d = spline.dist[i];
      if (d < 10 || d > 300) continue;

      /* A braking point is where a straight runs into a real corner. */
      const here = spline.segments[spline.segIndex[i]];
      const prev = spline.segments[spline.segIndex[i - 4]];
      if (!here || !prev) continue;
      if (!(Math.abs(here.curve) > 3.5 && Math.abs(prev.curve) < 1.2)) continue;

      const px = spline.px[i], pz = spline.pz[i];
      const nx = spline.nx[i], nz = spline.nz[i];
      const heading = Math.atan2(spline.tx[i], -spline.tz[i]);
      /* On the outside of the corner, where they are actually placed. */
      const side = -(Math.sign(here.curve) || 1);

      for (let k = 0; k < this.boards.length; k++) {
        const board = this.boards[k];
        if (counts[k] >= MAX_BOARDS) continue;
        /* Step back up the road by the board's distance. */
        const backM = board.at * 0.2;
        const j = Math.max(0, i - Math.round(backM / spline.stepM));
        if (spline.dist[j] < 4) continue;

        const bx = spline.px[j], bz = spline.pz[j];
        const bnx = spline.nx[j], bnz = spline.nz[j];
        const off = -side * hw * 1.42;
        this._pos.set(bx + bnx * off, 1.35, bz + bnz * off);
        this._q.setFromAxisAngle(this._up, heading + Math.PI / 2);
        this._m.compose(this._pos, this._q, this._scl);
        board.mesh.setMatrixAt(counts[k]++, this._m);
      }
      i += 12;   // one set of boards per corner, not per station
    }

    for (let k = 0; k < this.boards.length; k++) {
      this.boards[k].mesh.count = counts[k];
      this.boards[k].mesh.instanceMatrix.needsUpdate = true;
    }
  }

  _layMarshals(spline, detail) {
    const n = spline.count;
    const hw = spline.halfWidth;
    let k = 0;
    for (let i = 0; i < n && k < MAX_MARSHALS; i++) {
      const d = spline.dist[i];
      if (d < 20 || d > 300) continue;
      /* One post every so often along the circuit, anchored to the
         segment index so they stay put as the window rolls. */
      if (spline.segIndex[i] % 90 !== 0) continue;

      const px = spline.px[i], pz = spline.pz[i];
      const nx = spline.nx[i], nz = spline.nz[i];
      const off = -1 * hw * (this.walls ? 1.5 : 2.6);
      this._pos.set(px + nx * off, 0.6, pz + nz * off);
      this._q.identity();
      this._m.compose(this._pos, this._q, this._scl);
      this.marshals.setMatrixAt(k++, this._m);
    }
    this.marshals.count = k;
    this.marshals.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    [this.near, this.far].forEach((g) => {
      g.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          mats.forEach((m) => { if (m.map) m.map.dispose(); m.dispose(); });
        }
      });
      g.removeFromParent();
    });
  }
}
