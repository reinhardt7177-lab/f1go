/* ------------------------------------------------------------------
   The 3D driving view.

   This module owns the WebGL context and nothing else. It reads the
   game's state and draws it; it never writes back. `Game.update()`
   stays exactly as it was — physics still run on the 1D ribbon, and
   this renderer is one of two possible ways to show that state, the
   other being the original 2D painter.

   Enable with ?gfx=1 (or GFX.enable()) while it is being built out;
   the 2D renderer remains the default until every stage is done.
   ------------------------------------------------------------------ */
import * as THREE from 'three';
import { PerformanceMonitor } from './perf.js';
import { QualityManager } from './quality.js';
import { TrackSpline } from './spline.js';
import { TrackGeometry } from './geometry.js';
import { KerbInstancing } from './kerbs.js';
import { PlayerCockpit } from './cockpit.js';
import { EnvironmentManager } from './environment.js';

/* Field of view is split by orientation because the two shapes want
   different framing: a landscape screen wants a near-cinematic 68°,
   while portrait is so narrow that the same value crops the road to a
   letterbox — it needs to see wider to show the same corner. */
const FOV_LANDSCAPE = 68;
const FOV_PORTRAIT = 82;

export class Renderer3D {
  constructor(canvas) {
    this.canvas = canvas;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,        // resolution scaling is the cheaper knob
      powerPreference: 'high-performance',
      stencil: false
    });
    this.renderer.setClearColor(0x9fc4de, 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    /* ACES filmic keeps the bright sky from clipping to flat white and
       is most of what separates "stylised realism" from "flat toy". */
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.perf = new PerformanceMonitor();
    this.quality = new QualityManager(this.renderer);
    this.quality.refreshDpr();

    this.scene = new THREE.Scene();
    /* Aerial perspective: distant geometry fades into the horizon
       colour instead of ending at a hard edge. Range is retuned per
       quality tier, since draw distance moves with it. */
    this.scene.fog = new THREE.Fog(0xbcd4e4, 120, this.quality.settings.drawDistance);
    this.scene.background = new THREE.Color(0x9fc4de);

    this.camera = new THREE.PerspectiveCamera(FOV_LANDSCAPE, 1, 0.12, 4000);
    this.camera.position.set(0, 1.6, 0);
    /* The cockpit hangs off the camera, and three only updates the
       world matrices of objects it can reach from the scene — so the
       camera has to be in the graph, not merely pointed at it. */
    this.scene.add(this.camera);

    this.cockpit = new PlayerCockpit(this.camera, 0xe2000f);

    /* Everything that belongs to the current circuit hangs off this,
       so switching tracks is one removal rather than a bookkeeping
       exercise across every subsystem. */
    this.world = new THREE.Group();
    this.scene.add(this.world);

    /* Provisional lighting so the standard materials are visible at
       all. LightingManager takes this over in stage 7. */
    this.sun = new THREE.DirectionalLight(0xfff2dd, 2.6);
    this.sun.position.set(60, 90, 40);
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xbcd4e4, 0x4a5340, 1.1);
    this.scene.add(this.hemi);

    this._placeholder();

    this.enabled = false;
    this.ready = false;
    this._lastNow = 0;

    /* Current circuit. Rebuilt when the game starts a different one. */
    this.spline = null;
    this.trackId = null;
    this._pose = {
      position: new THREE.Vector3(),
      tangent: new THREE.Vector3(),
      normal: new THREE.Vector3(),
      heading: 0
    };
    this._camTarget = new THREE.Vector3();

    window.addEventListener('resize', () => this.resize());
    window.addEventListener('orientationchange', () => this.resize());
    this.resize();
  }

  /* Stage 1 stand-in: a ground plane and a grid, purely so the camera
     and the frame loop can be verified before there is a track. Both
     are removed the moment real geometry arrives. */
  _placeholder() {
    const g = new THREE.Group();

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(3000, 3000),
      new THREE.MeshBasicMaterial({ color: 0x4a6b43 })
    );
    ground.rotation.x = -Math.PI / 2;
    g.add(ground);

    const grid = new THREE.GridHelper(600, 60, 0x8899aa, 0x6b7d8c);
    grid.position.y = 0.02;
    g.add(grid);

    this.placeholder = g;
    this.world.add(g);
  }

  clearPlaceholder() {
    if (!this.placeholder) return;
    this.world.remove(this.placeholder);
    this.placeholder.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
    this.placeholder = null;
  }

  /* ----------------------------------------------------------------
     Circuit setup. Everything visual is rebuilt from the spline, so
     this is the one place a track change has to be handled.
     ---------------------------------------------------------------- */
  setTrack(game) {
    this.clearTrack();
    this.clearPlaceholder();

    this.spline = new TrackSpline(game.segments, ROAD_WIDTH, SEGMENT_LENGTH);
    this.trackId = game.track.id;

    this.trackGroup = new THREE.Group();
    this.world.add(this.trackGroup);

    this.theme = game.theme;

    this.road = new TrackGeometry(this.spline.maxStations, this.theme);
    this.trackGroup.add(this.road.mesh);

    this.kerbs = new KerbInstancing(this.trackGroup);
    this.environment = new EnvironmentManager(this.trackGroup, this.theme, this.trackId);

    /* Ground under everything. The window never reaches far, so this
       only has to cover the draw distance, not a whole circuit. */
    this.ground = new THREE.Mesh(
      new THREE.PlaneGeometry(6000, 6000),
      new THREE.MeshStandardMaterial({
        color: this.theme ? new THREE.Color(this.theme.grass[1]) : 0x4a6b43,
        roughness: 1,
        metalness: 0
      })
    );
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.position.y = -0.12;
    this.ground.frustumCulled = false;
    this.ground.receiveShadow = true;
    this.trackGroup.add(this.ground);

    /* Sky and haze follow the circuit's palette, so a night race in
       Singapore and a desert afternoon in Bahrain do not share a
       horizon. The 2D renderer already carried these colours; this
       just reads them from the same place. */
    if (this.theme) {
      const haze = new THREE.Color(this.theme.haze);
      const sky = new THREE.Color(this.theme.sky[1]);
      this.scene.fog.color.copy(haze);
      this.scene.background = sky;
      this.renderer.setClearColor(sky, 1);
    }

    this.ready = true;
  }

  clearTrack() {
    if (!this.trackGroup) return;
    this.world.remove(this.trackGroup);
    this.trackGroup.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach((m) => m.dispose());
      }
    });
    if (this.road) { this.road.dispose(); this.road = null; }
    if (this.kerbs) { this.kerbs.dispose(); this.kerbs = null; }
    if (this.environment) { this.environment.dispose(); this.environment = null; }
    this.trackGroup = null;
    this.ground = null;
    if (this.spline) this.spline.dispose();
    this.spline = null;
    this.ready = false;
  }

  get portrait() { return window.innerHeight > window.innerWidth; }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    /* setSize with updateStyle=false: the canvas is sized by CSS, and
       letting three write inline styles fights the stylesheet. */
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(h, 1);
    this.camera.fov = this.portrait ? FOV_PORTRAIT : FOV_LANDSCAPE;
    this.camera.updateProjectionMatrix();
    this.quality.refreshDpr();
  }

  enable(on) {
    this.enabled = on !== false;
    this.canvas.classList.toggle('hidden', !this.enabled);
    if (this.enabled) this.resize();
  }

  /**
   * Place the camera in the driver's seat.
   *
   * The window is built with the car at the origin facing -Z, so the
   * camera barely has to move: it sits at eye height, shifted sideways
   * by however far off centre the car is, and looks down the road.
   * Keeping the car at the origin also keeps world coordinates small,
   * which keeps float precision comfortable however long the race.
   */
  updateCamera(game) {
    const eye = 1.12;                       // driver's eye height, metres
    const lateral = game.playerX * this.spline.halfWidth;

    this.camera.position.set(lateral, eye, 0);

    /* Aim a little way down the road rather than straight ahead: the
       eye leads the car into a corner, and a camera that does not do
       the same feels like being driven rather than driving. */
    const s = this.spline;
    let ahead = 0;
    for (let i = 0; i < s.count; i++) {
      if (s.dist[i] >= 22) { ahead = i; break; }
    }
    const lookX = s.count ? s.px[ahead] * 0.55 + lateral * 0.45 : lateral;
    const lookZ = s.count ? s.pz[ahead] : -22;
    this._camTarget.set(lookX, eye * 0.86, lookZ);
    this.camera.lookAt(this._camTarget);
  }

  /** Draw straight from the live game object — no snapshot copy. */
  renderFromGame(game, now) {
    if (!this.enabled) return;
    if (!game.segments || !game.segments.length) return;

    if (!this.ready || this.trackId !== game.track.id) this.setTrack(game);

    /* Rebuild the window around the car, then everything downstream
       reads from it. Draw distance comes from the quality tier, so a
       slow device generates less road as well as drawing it smaller. */
    const q = this.quality.settings;
    const roadReach = q.drawDistance * 0.5;
    this.spline.build(game.position, roadReach, 24, 1);

    /* Aerial perspective is tied to how far the road actually reaches,
       not to an arbitrary constant: the haze has to close in just
       before the geometry runs out, or the road ends at a visible
       edge instead of dissolving into the distance. */
    this.scene.fog.near = roadReach * 0.10;
    this.scene.fog.far = roadReach * 0.92;
    this.road.update(this.spline);
    this.kerbs.update(this.spline, this.theme, q.kerbLod);

    /* The backdrop needs the car's compass bearing, which the window
       deliberately throws away — it always faces -Z. */
    const s = this.spline;
    const seg = s.absHeading[s.carSegment] || 0;
    this.environment.update(s, q.envDetail, seg);

    this.updateCamera(game);

    this.cockpit.update(
      game.steerInput,
      game.rpm,
      game.speed / game.maxSpeed,
      Math.min(this.perf.frameMs / 1000, 0.05),
      game.drs
    );
    this.render(null, now || performance.now());
  }

  /**
   * Draw one frame. `state` is a plain snapshot from the game — this
   * renderer holds no gameplay state of its own.
   */
  render(state, now) {
    if (!this.enabled) return;

    this.perf.beginFrame(now);
    const dt = this.perf.frameMs / 1000;

    /* Stage 1 camera: a slow orbit, so the scene can be seen at all
       before the track exists to stand on. */
    if (this.placeholder) {
      const t = now * 0.0002;
      this.camera.position.set(Math.sin(t) * 40, 12, Math.cos(t) * 40);
      this.camera.lookAt(0, 0, 0);
    }

    this.renderer.render(this.scene, this.camera);
    this.perf.endFrame(this.renderer);

    if (this.quality.update(this.perf, dt)) {
      this.scene.fog.far = this.quality.settings.drawDistance;
    }
    this.perf.updateOverlay(dt, this.quality);
  }
}

/* ------------------------------------------------------------------
   Boot. The 3D layer attaches itself to the page and exposes a small
   handle; the game looks for that handle and delegates drawing to it
   when it is present and enabled.
   ------------------------------------------------------------------ */
const params = new URLSearchParams(location.search);
const canvas = document.getElementById('canvas3d');

if (canvas) {
  let gfx = null;
  try {
    gfx = new Renderer3D(canvas);
  } catch (err) {
    /* No WebGL, or a driver that refuses: the 2D renderer is still
       there and is a complete game, so this is a downgrade, not a
       failure worth showing anyone. */
    console.warn('[gfx] WebGL unavailable, staying on the 2D renderer:', err);
  }

  if (gfx) {
    window.GFX = gfx;

    /* Take over drawing without touching game.js.
     *
     * Game.render() does two separable things: it paints the world on
     * a 2D canvas, and it pushes the HUD into the DOM. Only the first
     * is being replaced, so the wrapper calls the 3D renderer and then
     * runs the HUD update the original would have run. Wrapping rather
     * than editing keeps the 2D renderer intact and one flag away —
     * which is what makes this swap reversible on a device where WebGL
     * turns out to be a bad bet. */
    const draw2D = Game.render.bind(Game);
    Game.render = function () {
      if (!gfx.enabled) { draw2D(); return; }

      if (this.state === 'menu' || !this.segments.length) {
        /* Nothing to drive through yet; the menu overlay covers the
           canvas anyway, so this only has to not throw. */
        return;
      }

      gfx.renderFromGame(this, performance.now());
      this.updateHud(this.speed / this.maxSpeed);
    };

    if (params.has('gfx')) gfx.enable(params.get('gfx') !== '0');
    if (params.has('perf')) gfx.perf.showOverlay(params.get('perf') !== '0');
  }
}
