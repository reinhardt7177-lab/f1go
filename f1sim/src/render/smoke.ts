/**
 * Tyre smoke.
 *
 * The simulation already knows when a tyre has stopped rolling and
 * started sliding — every wheel carries a slip ratio, and a locked
 * front or a spinning rear is a number well outside the range the tyre
 * makes grip in. That number used to be readable only on an instrument
 * panel, which is no use to someone whose eyes are on the corner — and
 * the instrument panel has since been deleted, so this is now the whole
 * of how a driver learns a tyre has let go: you felt the car stop
 * responding without seeing why.
 *
 * A puff of smoke off the wheel that is sliding is the whole
 * explanation, delivered where the mistake happened. It is the cheapest
 * teaching device in the game.
 *
 * One `THREE.Points` draw call for the lot, from a fixed pool. Particles
 * are recycled oldest-first, so heavy lockups shorten the plume rather
 * than allocating, and the cost of the effect cannot run away.
 */
import * as THREE from 'three';

import type { Vec3 } from '../core/math';

/**
 * Puffs alive at once. Two locked wheels use about forty.
 *
 * A ceiling rather than a fixed size since the quality tiers arrived: a
 * phone gets a smaller pool, which shortens the plume under a long
 * lockup rather than dropping it, because slots are recycled
 * oldest-first. The particles themselves are one draw call either way —
 * what a smaller pool actually saves is overdraw, and a large
 * transparent sprite covering a quarter of a phone screen is the most
 * expensive thing in this file.
 */
const POOL = 160;

/** Seconds a puff lasts. Long enough to be left behind at speed. */
const LIFE = 0.95;

/** Puffs a second from one fully sliding tyre. */
const RATE = 46;

/**
 * A cartoon puff: overlapping discs with a drawn edge, rather than the
 * soft radial blob a photographic renderer would use. The dark rim is
 * the same convention as the outline on the cars — it is what keeps the
 * smoke reading as an object against a pale sky.
 */
const puffTexture = (): THREE.CanvasTexture => {
  const size = 96;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  const lobes: [number, number, number][] = [
    [0.5, 0.54, 0.3],
    [0.32, 0.44, 0.2],
    [0.68, 0.45, 0.22],
    [0.44, 0.3, 0.17],
    [0.6, 0.68, 0.18]
  ];

  ctx.lineWidth = size * 0.05;
  ctx.strokeStyle = 'rgba(60, 66, 74, 0.85)';
  ctx.fillStyle = '#ffffff';

  // Outline first, then fill over the interior joins, so the rim is
  // only ever on the silhouette and not between the lobes.
  for (const [x, y, r] of lobes) {
    ctx.beginPath();
    ctx.arc(x * size, y * size, r * size, 0, Math.PI * 2);
    ctx.stroke();
  }
  for (const [x, y, r] of lobes) {
    ctx.beginPath();
    ctx.arc(x * size, y * size, r * size, 0, Math.PI * 2);
    ctx.fill();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
};

export class TyreSmoke {
  private readonly pool: number;
  private readonly positions: Float32Array;
  private readonly velocities: Float32Array;
  /** Seconds left on each puff. Zero means the slot is free. */
  private readonly life: Float32Array;
  private readonly seed: Float32Array;
  private readonly alpha: Float32Array;
  private readonly scale: Float32Array;

  private readonly geometry = new THREE.BufferGeometry();
  private readonly points: THREE.Points;
  private cursor = 0;

  /** Fractional puffs owed, so a low slip still emits at the right rate. */
  private readonly owed: number[] = [];

  constructor(scene: THREE.Scene, pool = POOL) {
    this.pool = Math.max(8, Math.min(POOL, Math.round(pool)));
    this.positions = new Float32Array(this.pool * 3);
    this.velocities = new Float32Array(this.pool * 3);
    this.life = new Float32Array(this.pool);
    this.seed = new Float32Array(this.pool);
    this.alpha = new Float32Array(this.pool);
    this.scale = new Float32Array(this.pool);

    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1));
    this.geometry.setAttribute('aScale', new THREE.BufferAttribute(this.scale, 1));

    const material = new THREE.ShaderMaterial({
      uniforms: {
        map: { value: puffTexture() },
        /* Points are sized in pixels, so the projection has to be fed
           the viewport to keep a puff the same size in metres. */
        viewportHeight: { value: 1080 },
        focal: { value: 1.0 }
      },
      vertexShader: /* glsl */ `
        attribute float aAlpha;
        attribute float aScale;
        uniform float viewportHeight;
        uniform float focal;
        varying float vAlpha;
        void main() {
          vAlpha = aAlpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aScale * focal * viewportHeight / max(1.0, -mv.z);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D map;
        varying float vAlpha;
        void main() {
          vec4 texel = texture2D(map, gl_PointCoord);
          if (texel.a * vAlpha < 0.02) discard;
          gl_FragColor = vec4(texel.rgb, texel.a * vAlpha);
        }
      `,
      transparent: true,
      // Smoke does not occlude smoke: writing depth would let the
      // nearest puff punch a hole in the plume behind it.
      depthWrite: false
    });

    this.points = new THREE.Points(this.geometry, material);
    // The plume is emitted in world space and left behind, so it must
    // never be culled against the bounding sphere of where it started.
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  /**
   * Ask for smoke at a contact patch.
   *
   * @param at         where the tyre meets the road
   * @param intensity  0 for a rolling tyre, 1 for one fully sliding
   * @param drift      the car's own velocity, which the puff inherits
   * @param wheel      which corner, so each keeps its own emission debt
   */
  emit(wheel: number, at: Vec3, intensity: number, drift: Vec3, dt: number): void {
    if (intensity <= 0) {
      this.owed[wheel] = 0;
      return;
    }

    const owed = (this.owed[wheel] ?? 0) + RATE * intensity * dt;
    let due = Math.floor(owed);
    this.owed[wheel] = owed - due;

    while (due-- > 0) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % this.pool;
      const p = i * 3;

      this.positions[p] = at.x + (Math.random() - 0.5) * 0.3;
      this.positions[p + 1] = at.y + 0.06;
      this.positions[p + 2] = at.z + (Math.random() - 0.5) * 0.3;

      /* A tenth of the car's velocity, so the plume trails the way it
         does behind a real car rather than hanging in the air where it
         was made. */
      this.velocities[p] = drift.x * 0.12 + (Math.random() - 0.5) * 1.4;
      this.velocities[p + 1] = 0.9 + Math.random() * 0.9;
      this.velocities[p + 2] = drift.z * 0.12 + (Math.random() - 0.5) * 1.4;

      this.life[i] = LIFE;
      this.seed[i] = 0.7 + Math.random() * 0.6;
    }
  }

  update(dt: number): void {
    let alive = 0;

    for (let i = 0; i < this.pool; i++) {
      const remaining = this.life[i]!;
      if (remaining <= 0) {
        this.alpha[i] = 0;
        continue;
      }

      const left = remaining - dt;
      this.life[i] = left > 0 ? left : 0;
      if (left <= 0) {
        this.alpha[i] = 0;
        continue;
      }

      const p = i * 3;
      const vx = this.velocities[p]!;
      const vy = this.velocities[p + 1]!;
      const vz = this.velocities[p + 2]!;

      this.positions[p] = this.positions[p]! + vx * dt;
      this.positions[p + 1] = this.positions[p + 1]! + vy * dt;
      this.positions[p + 2] = this.positions[p + 2]! + vz * dt;

      // Air drags the sideways motion out of it; the rise does not slow,
      // which is what makes the plume stand up as it is left behind.
      const drag = 1 - Math.min(1, dt * 1.8);
      this.velocities[p] = vx * drag;
      this.velocities[p + 2] = vz * drag;

      /* Grows the whole way and fades late: a puff that starts fading
         immediately never reads as smoke, because the eye sees the
         brightest part of a plume nearest the tyre. */
      const age = 1 - left / LIFE;
      this.scale[i] = this.seed[i]! * (0.35 + age * 1.5);
      this.alpha[i] = Math.min(1, age * 5) * (1 - age) * 0.85;
      alive++;
    }

    if (alive > 0 || this.points.visible) {
      this.geometry.attributes.position!.needsUpdate = true;
      this.geometry.attributes.aAlpha!.needsUpdate = true;
      this.geometry.attributes.aScale!.needsUpdate = true;
    }
    this.points.visible = alive > 0;
  }

  /**
   * Point sizes are in pixels, so the projection has to be handed the
   * viewport and the lens every time either changes.
   */
  setProjection(viewportHeight: number, fovDegrees: number): void {
    const material = this.points.material as THREE.ShaderMaterial;
    material.uniforms.viewportHeight!.value = viewportHeight;
    // Half-height of the frustum at unit depth, which is what converts
    // a size in metres to a fraction of the screen.
    material.uniforms.focal!.value = 1 / (2 * Math.tan((fovDegrees * Math.PI) / 360));
  }
}
