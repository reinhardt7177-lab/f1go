/* ------------------------------------------------------------------
   TrackGeometry — the road surface.

   One mesh, rebuilt each frame from the rolling window. It is built as
   a set of parallel lateral columns rather than a bare two-vertex
   strip, because everything that makes tarmac read as a racing surface
   lives across the road rather than along it: the rubbered-in groove
   down the middle, the white track-limit lines, the darker sealed
   edges, the gravel-and-grass verge beyond.

   Baking those into vertex colours costs one extra float per vertex
   and keeps the whole road to a single draw call — cheaper than the
   half-dozen overlapping meshes the same look would otherwise need.
   Fine grain comes from a procedural texture on top.
   ------------------------------------------------------------------ */
import * as THREE from 'three';

/* Lateral columns, in road half-widths. 1.0 is the painted edge of the
   circuit — the same place the physics puts the track limit, so what
   you see is what you hit.

   `kind` names where the colour comes from: the circuit theme already
   carries a palette for run-off and tarmac, and reading it here is
   what keeps Monaco's grey pavement, Bahrain's sand and Singapore's
   night streets from all turning up as English grass.  */
const COLUMNS = [
  { t: -1.75, kind: 'verge',  shade: 0.92 },
  { t: -1.18, kind: 'verge',  shade: 1.04 },
  { t: -1.18, kind: 'apron',  shade: 1.0 },
  { t: -1.02, kind: 'apron',  shade: 1.08 },
  { t: -1.00, kind: 'line',   shade: 1.0 },
  { t: -0.94, kind: 'line',   shade: 1.0 },
  { t: -0.92, kind: 'road',   shade: 1.12 },   // sun-bleached edge
  { t: -0.42, kind: 'road',   shade: 1.0 },
  { t: -0.16, kind: 'road',   shade: 0.86 },   // rubbered-in groove
  { t:  0.16, kind: 'road',   shade: 0.86 },
  { t:  0.42, kind: 'road',   shade: 1.0 },
  { t:  0.92, kind: 'road',   shade: 1.12 },
  { t:  0.94, kind: 'line',   shade: 1.0 },
  { t:  1.00, kind: 'line',   shade: 1.0 },
  { t:  1.02, kind: 'apron',  shade: 1.08 },
  { t:  1.18, kind: 'apron',  shade: 1.0 },
  { t:  1.18, kind: 'verge',  shade: 1.04 },
  { t:  1.75, kind: 'verge',  shade: 0.92 }
];

const columnColor = (col, theme) => {
  const c = new THREE.Color();
  if (col.kind === 'line') c.set(0xe9edf0);
  else if (col.kind === 'road') c.set(theme ? theme.road[0] : '#4a4d54');
  else if (col.kind === 'apron') c.set(theme ? theme.grass[0] : '#8e9298').lerp(new THREE.Color(0x9aa0a6), 0.45);
  else c.set(theme ? theme.grass[1] : '#4f7042');
  c.multiplyScalar(col.shade);
  /* The grain texture multiplies over this, and a mid-grey texture
     halves whatever it lands on — so the vertex colour is lifted to
     compensate rather than the road coming out black. */
  if (col.kind !== 'line') c.multiplyScalar(1.85);
  return c;
};

/**
 * Asphalt grain. Generated rather than loaded: the repository ships no
 * image assets, and a tiling noise field is a few lines of canvas work
 * that survives any amount of zoom without a download.
 */
const makeAsphaltTexture = () => {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');

  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, size, size);

  /* Aggregate: thousands of small stones at slightly different values.
     Drawn as single pixels so the tile stays sharp at grazing angles,
     where a blurred texture turns to mush. */
  const img = ctx.getImageData(0, 0, size, size);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = 128 + (Math.random() - 0.5) * 74;
    d[i] = d[i + 1] = d[i + 2] = n;
  }
  ctx.putImageData(img, 0, 0);

  /* A few larger patches so the surface has structure at road scale
     and does not read as uniform static. */
  for (let i = 0; i < 90; i++) {
    ctx.globalAlpha = 0.05 + Math.random() * 0.07;
    ctx.fillStyle = Math.random() < 0.5 ? '#000' : '#fff';
    ctx.beginPath();
    ctx.arc(Math.random() * size, Math.random() * size,
      4 + Math.random() * 18, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
};

export class TrackGeometry {
  constructor(maxStations, theme) {
    this.maxStations = maxStations;
    this.theme = theme;
    this.cols = COLUMNS.length;

    const verts = maxStations * this.cols;
    const quads = (maxStations - 1) * (this.cols - 1);

    this.positions = new Float32Array(verts * 3);
    this.colors = new Float32Array(verts * 3);
    this.uvs = new Float32Array(verts * 2);
    this.normals = new Float32Array(verts * 3);

    /* Indices never change — the grid's topology is fixed, only the
       vertex positions move. Written once here and left alone.

       Winding matters and is easy to get backwards: columns run left
       to right across the road while stations run forward, which is
       -Z. Wound the other way every triangle faces the ground and the
       whole road vanishes to backface culling — with the draw call
       still on the books, which makes it look like a shading bug
       rather than a topology one. */
    const idx = new Uint32Array(quads * 6);
    let p = 0;
    for (let s = 0; s < maxStations - 1; s++) {
      for (let c = 0; c < this.cols - 1; c++) {
        const a = s * this.cols + c;
        const b = a + 1;
        const e = a + this.cols;
        const f = e + 1;
        idx[p++] = a; idx[p++] = b; idx[p++] = e;
        idx[p++] = b; idx[p++] = f; idx[p++] = e;
      }
    }

    /* Colours and up-normals are static per column too. */
    const colColors = COLUMNS.map((col) => columnColor(col, theme));
    for (let s = 0; s < maxStations; s++) {
      for (let c = 0; c < this.cols; c++) {
        const v = s * this.cols + c;
        const col = colColors[c];
        this.colors[v * 3] = col.r;
        this.colors[v * 3 + 1] = col.g;
        this.colors[v * 3 + 2] = col.b;
        this.normals[v * 3 + 1] = 1;
        this.uvs[v * 2] = COLUMNS[c].t * 1.6;
      }
    }

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    this.geometry.setAttribute('uv', new THREE.BufferAttribute(this.uvs, 2));
    this.geometry.setAttribute('normal', new THREE.BufferAttribute(this.normals, 3));
    this.geometry.setIndex(new THREE.BufferAttribute(idx, 1));
    this.geometry.setDrawRange(0, 0);

    this.material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      map: makeAsphaltTexture(),
      roughness: 0.92,
      metalness: 0.0
    });
    /* The texture is a grain multiplier over the vertex colour, so it
       must sit around mid-grey rather than tint the road. */
    this.material.map.repeat.set(1, 1);

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;   // it is always around the camera
    this.mesh.receiveShadow = true;
    this.mesh.renderOrder = 0;
  }

  /** Rebuild from the current window. */
  update(spline) {
    const n = Math.min(spline.count, this.maxStations);
    const hw = spline.halfWidth;
    const pos = this.positions;
    const uv = this.uvs;

    for (let i = 0; i < n; i++) {
      const px = spline.px[i];
      const pz = spline.pz[i];
      const nx = spline.nx[i];
      const nz = spline.nz[i];
      const dist = spline.dist[i];

      for (let c = 0; c < this.cols; c++) {
        const col = COLUMNS[c];
        const off = -col.t * hw;          // +t is the driver's right
        const v = (i * this.cols + c) * 3;
        pos[v] = px + nx * off;
        /* The verge sits a little below the racing surface, which is
           what gives the kerb line something to stand on and stops the
           grass from z-fighting with the asphalt. */
        pos[v + 1] = col.kind === 'verge' ? -0.10 : 0;
        pos[v + 2] = pz + nz * off;

        uv[(i * this.cols + c) * 2 + 1] = dist * 0.22;
      }
    }

    this.geometry.getAttribute('position').needsUpdate = true;
    this.geometry.getAttribute('uv').needsUpdate = true;
    this.geometry.setDrawRange(0, Math.max(0, (n - 1) * (this.cols - 1) * 6));
    this.geometry.computeBoundingSphere();
  }

  dispose() {
    this.geometry.dispose();
    this.material.map.dispose();
    this.material.dispose();
  }
}
