/* ------------------------------------------------------------------
   LightingManager — one sun, one sky, and the reflections.

   The budget allows a single real-time light, so the sun does all the
   shadow work and everything else is cheated. That is not a
   compromise for its own sake: one strong directional and a good
   ambient is how a clear day actually reads, and spending the saving
   on a proper environment map buys far more than a second lamp would.

   The environment map is the part that matters most here. Clear-coated
   paint and carbon weave are defined by what they reflect — without a
   reflection they are flat colour, which is exactly why the cockpit
   looked like moulded plastic before this existed. Generating one from
   the circuit's own sky costs a few milliseconds once per track.
   ------------------------------------------------------------------ */
import * as THREE from 'three';

/**
 * An equirectangular sky, painted to a canvas: gradient overhead,
 * haze at the horizon, ground below, and a bright sun disc where the
 * directional light is. That disc is what shows up as a highlight
 * sliding along the halo.
 */
const makeSkyEquirect = (theme, sunAzimuth, night) => {
  const w = 256, h = 128;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');

  const zenith = theme ? theme.sky[0] : '#46586c';
  const mid = theme ? theme.sky[1] : '#7d92a5';
  const haze = theme ? theme.haze : '#c8d3da';
  const ground = theme ? theme.grass[1] : '#3a5a35';

  const sky = ctx.createLinearGradient(0, 0, 0, h * 0.5);
  sky.addColorStop(0, zenith);
  sky.addColorStop(0.65, mid);
  sky.addColorStop(1, haze);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h * 0.5);

  const below = ctx.createLinearGradient(0, h * 0.5, 0, h);
  below.addColorStop(0, haze);
  below.addColorStop(0.35, ground);
  below.addColorStop(1, ground);
  ctx.fillStyle = below;
  ctx.fillRect(0, h * 0.5, w, h * 0.5);

  if (!night) {
    /* Sun. Drawn twice — a small hot core inside a wide soft glow —
       because a single disc gives a hard-edged reflection that reads
       as a sticker rather than a light. */
    const sx = ((sunAzimuth / (Math.PI * 2)) % 1 + 1) % 1 * w;
    const sy = h * 0.22;
    const glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, w * 0.16);
    glow.addColorStop(0, 'rgba(255,250,235,1)');
    glow.addColorStop(0.12, 'rgba(255,244,214,0.85)');
    glow.addColorStop(1, 'rgba(255,240,210,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(sx - w * 0.16, sy - w * 0.16, w * 0.32, w * 0.32);
  } else {
    /* Night: no sun, but a scatter of floodlights round the horizon
       so a street circuit still has something to catch on the paint. */
    for (let i = 0; i < 14; i++) {
      const x = (i / 14) * w;
      const g2 = ctx.createRadialGradient(x, h * 0.42, 0, x, h * 0.42, 14);
      g2.addColorStop(0, 'rgba(255,240,205,0.85)');
      g2.addColorStop(1, 'rgba(255,240,205,0)');
      ctx.fillStyle = g2;
      ctx.fillRect(x - 14, h * 0.42 - 14, 28, 28);
    }
  }

  const tex = new THREE.CanvasTexture(c);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
};

export class LightingManager {
  constructor(renderer, scene) {
    this.renderer = renderer;
    this.scene = scene;

    /* The one real-time light. */
    this.sun = new THREE.DirectionalLight(0xfff4e2, 3.0);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    /* The car sits at the origin and the world rolls past it, so the
       shadow camera never has to move — it only has to be big enough
       to hold the cars near enough for their shadows to matter, and
       tight enough that 1024 pixels is real resolution. */
    const d = 42;
    this.sun.shadow.camera.left = -d;
    this.sun.shadow.camera.right = d;
    this.sun.shadow.camera.top = d;
    this.sun.shadow.camera.bottom = -d;
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 220;
    this.sun.shadow.bias = -0.0012;
    this.sun.shadow.normalBias = 0.02;
    scene.add(this.sun);
    scene.add(this.sun.target);

    /* Sky and bounced ground light, which is what fills the shadows. */
    this.hemi = new THREE.HemisphereLight(0xbcd4e4, 0x50553f, 1.0);
    scene.add(this.hemi);

    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envRT = null;
    this.skyTex = null;

    /* Azimuth is fixed per track rather than animated: a sun that
       moves while you drive gives away that the world is rotating
       around the car instead of the other way round. */
    this.azimuth = 2.1;
  }

  /** Rebuild sun colour, angle and reflections for a circuit. */
  applyTheme(theme, trackId) {
    const night = trackId === 'singapore';
    this.night = night;

    /* Ambient is kept deliberately low against the sun. A strong fill
       is the other half of why everything looked washed out: it lifts
       the shadows until they stop being shadows, and a scene with no
       dark in it has no shape in it either. Roughly 4:1 sun to sky is
       what a clear day actually measures. */
    if (night) {
      this.sun.color.set(0xc6d4ff);
      this.sun.intensity = 0.9;
      this.hemi.color.set(0x2c3550);
      this.hemi.groundColor.set(0x14171c);
      this.hemi.intensity = 0.40;
    } else if (trackId === 'bahrain') {
      this.sun.color.set(0xffe4b8);
      this.sun.intensity = 3.6;
      this.hemi.color.set(0xd8c9a8);
      this.hemi.groundColor.set(0x6e5c3f);
      this.hemi.intensity = 0.50;
    } else {
      this.sun.color.set(0xfff0d8);
      this.sun.intensity = 3.3;
      this.hemi.color.set(theme ? new THREE.Color(theme.haze) : 0xbcd4e4);
      this.hemi.groundColor.set(theme ? new THREE.Color(theme.grass[1]) : 0x3a3f33);
      this.hemi.intensity = 0.45;
    }

    /* A LOW sun, and low on purpose.

       The first version put it near the zenith, where a car's shadow
       hides underneath it and every surface is lit head-on. That is
       what made the whole scene read as flat paper: no cast shadows
       anywhere, no shaded sides, nothing to tell the eye which way a
       surface faces. A sun 18° above the horizon throws shadows long
       across the road, lights one flank and shades the other, and
       does more for the picture than any amount of geometry. */
    const elev = night ? 0.55 : 0.32;          // radians above horizon
    const r = 120;
    this.sun.position.set(
      Math.cos(this.azimuth) * Math.cos(elev) * r,
      Math.sin(elev) * r,
      Math.sin(this.azimuth) * Math.cos(elev) * r
    );
    this.sun.target.position.set(0, 0, -20);
    this.sun.target.updateMatrixWorld();

    this._buildEnvironment(theme, night);
  }

  _buildEnvironment(theme, night) {
    if (this.envRT) { this.envRT.dispose(); this.envRT = null; }
    if (this.skyTex) { this.skyTex.dispose(); this.skyTex = null; }

    this.skyTex = makeSkyEquirect(theme, this.azimuth, night);
    this.envRT = this.pmrem.fromEquirectangular(this.skyTex);
    this.scene.environment = this.envRT.texture;
    /* Reflections only — the sky dome draws the actual background, so
       the environment must not also become it. */
    this.scene.environmentIntensity = night ? 0.55 : 1.0;
  }

  /** Shadows are the first thing to go when frames get tight. */
  applyQuality(settings) {
    this.sun.castShadow = settings.shadows;
    if (this.sun.shadow.map && this.sun.shadow.mapSize.width !== settings.shadowMap) {
      this.sun.shadow.mapSize.set(settings.shadowMap, settings.shadowMap);
      this.sun.shadow.map.dispose();
      this.sun.shadow.map = null;
    }
  }

  dispose() {
    if (this.envRT) this.envRT.dispose();
    if (this.skyTex) this.skyTex.dispose();
    this.pmrem.dispose();
  }
}

/* ------------------------------------------------------------------
   Speed effects. Not lighting, but the same job: making the picture
   say how fast the car is going.
   ------------------------------------------------------------------ */
/**
 * Radial streaks, drawn once into a canvas and stretched over the
 * whole view. Blur at the edges of vision is what the eye reads as
 * speed when the road ahead is empty — on a long straight the geometry
 * itself barely changes, so without this a flat-out lap and a slow one
 * look nearly identical. Cheap: one transparent quad on the camera.
 */
const makeStreakTexture = () => {
  const s = 256;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, s, s);
  ctx.translate(s / 2, s / 2);
  ctx.lineCap = 'round';
  for (let i = 0; i < 220; i++) {
    const a = Math.random() * Math.PI * 2;
    /* Nothing near the middle: streaks over the road you are aiming
       at would read as dirt on the lens rather than motion. */
    const r0 = 46 + Math.random() * 44;
    const len = 16 + Math.random() * 62;
    const alpha = 0.05 + Math.random() * 0.16;
    ctx.strokeStyle = 'rgba(255,255,255,' + alpha.toFixed(3) + ')';
    ctx.lineWidth = 0.7 + Math.random() * 1.8;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
    ctx.lineTo(Math.cos(a) * (r0 + len), Math.sin(a) * (r0 + len));
    ctx.stroke();
  }
  return new THREE.CanvasTexture(c);
};

export class SpeedEffects {
  constructor(camera) {
    this.fovBoost = 0;
    this.shakeX = 0;
    this.shakeY = 0;
    this.roll = 0;
    this._t = 0;

    /* Parented to the camera and sitting just past the near plane, so
       it always fills the view and never intersects the world. */
    this.streakMat = new THREE.MeshBasicMaterial({
      map: makeStreakTexture(),
      transparent: true,
      opacity: 0,
      depthTest: false,
      depthWrite: false,
      fog: false,
      blending: THREE.AdditiveBlending
    });
    this.streaks = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.streakMat);
    this.streaks.position.set(0, 0, -0.2);
    this.streaks.renderOrder = 999;
    this.streaks.frustumCulled = false;
    this.streaks.visible = false;
    if (camera) camera.add(this.streaks);
    this.camera = camera;
  }

  /** Keep the overlay covering the frame whatever the lens is doing. */
  fitStreaks(camera) {
    const d = 0.2;
    const h = 2 * Math.tan((camera.fov * Math.PI / 180) / 2) * d;
    this.streaks.scale.set((h * camera.aspect) / 2, h / 2, 1);
  }

  /**
   * @param speed01   fraction of top speed
   * @param baseFov   the orientation's field of view
   * @param rough     0..1 — kerbs and grass, from the game's own tests
   * @param steer     -1..1, for the lean into a corner
   * @param dt        seconds
   */
  update(speed01, baseFov, rough, steer, dt) {
    this._t += dt;

    /* Widening the lens with speed is the oldest trick there is and
       still the most effective: the edges stretch, the road rushes,
       and nothing about the simulation had to change.

       The curve is deliberately steep at the top end. A linear boost
       spends most of its range at speeds you spend little time at, and
       the flat-out straights — where the complaint always is that
       nothing is happening — barely move at all. */
    const target = Math.pow(speed01, 1.6) * 26;
    this.fovBoost += (target - this.fovBoost) * Math.min(1, dt * 2.5);

    /* Vibration scales with speed, and jumps on a kerb. Kept small —
       a camera that shakes hard is unreadable rather than fast. */
    const amp = (0.0042 + rough * 0.014) * (0.25 + speed01 * 1.4);
    this.shakeX = Math.sin(this._t * 41.3) * amp;
    this.shakeY = Math.sin(this._t * 57.7 + 1.3) * amp * 0.8
                + Math.sin(this._t * 23.1) * amp * 0.5;

    /* A touch of roll into the corner, from the steering the driver
       is actually applying. */
    const rollTarget = -steer * 0.020 * (0.4 + speed01);
    this.roll += (rollTarget - this.roll) * Math.min(1, dt * 5);

    /* Streaks only once genuinely quick, and rolling with the wheel
       so the blur turns with the car rather than sitting on the glass. */
    /* Half the previous strength: at full opacity the streaks covered
       the upper half of the screen and hid the barriers and skyline —
       reading as fog on the lens rather than as speed. */
    const streak = Math.max(0, speed01 - 0.55) * 1.4;
    this.streakMat.opacity = streak * 0.26;
    this.streaks.visible = streak > 0.02;
    this.streaks.rotation.z += dt * speed01 * 0.35;

    return baseFov + this.fovBoost;
  }
}
