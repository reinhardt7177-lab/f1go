/**
 * Small maths helpers shared by the simulation.
 *
 * Nothing in `core/` or `sim/` may import a rendering library — see
 * ARCHITECTURE.md. These are hand-rolled rather than pulled from three.js
 * for exactly that reason.
 */

export const clamp = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v;

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export const sign = (v: number): number => (v > 0 ? 1 : v < 0 ? -1 : 0);

/** Move `current` towards `target` at no more than `maxDelta` per call. */
export const approach = (current: number, target: number, maxDelta: number): number => {
  const d = target - current;
  if (Math.abs(d) <= maxDelta) return target;
  return current + Math.sign(d) * maxDelta;
};

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export const vec3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });

export const v3add = (a: Vec3, b: Vec3): Vec3 => vec3(a.x + b.x, a.y + b.y, a.z + b.z);
export const v3sub = (a: Vec3, b: Vec3): Vec3 => vec3(a.x - b.x, a.y - b.y, a.z - b.z);
export const v3scale = (a: Vec3, s: number): Vec3 => vec3(a.x * s, a.y * s, a.z * s);
export const v3dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const v3lenSq = (a: Vec3): number => v3dot(a, a);
export const v3len = (a: Vec3): number => Math.sqrt(v3dot(a, a));

export const v3cross = (a: Vec3, b: Vec3): Vec3 =>
  vec3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);

export const v3normalize = (a: Vec3): Vec3 => {
  const l = v3len(a);
  return l > 1e-9 ? v3scale(a, 1 / l) : vec3();
};

export const v3lerp = (a: Vec3, b: Vec3, t: number): Vec3 =>
  vec3(lerp(a.x, b.x, t), lerp(a.y, b.y, t), lerp(a.z, b.z, t));

export interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

export const quatIdentity = (): Quat => ({ x: 0, y: 0, z: 0, w: 1 });

/** Rotate a vector by a unit quaternion. */
export const quatRotate = (q: Quat, v: Vec3): Vec3 => {
  const { x, y, z, w } = q;
  const tx = 2 * (y * v.z - z * v.y);
  const ty = 2 * (z * v.x - x * v.z);
  const tz = 2 * (x * v.y - y * v.x);
  return vec3(
    v.x + w * tx + (y * tz - z * ty),
    v.y + w * ty + (z * tx - x * tz),
    v.z + w * tz + (x * ty - y * tx)
  );
};

/** Rotate a vector by the inverse of a unit quaternion (world -> local). */
export const quatRotateInverse = (q: Quat, v: Vec3): Vec3 =>
  quatRotate({ x: -q.x, y: -q.y, z: -q.z, w: q.w }, v);

/** Shortest-arc interpolation, used only to smooth the camera. */
export const quatSlerp = (a: Quat, b: Quat, t: number): Quat => {
  let cos = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
  let bx = b.x, by = b.y, bz = b.z, bw = b.w;
  if (cos < 0) {
    cos = -cos;
    bx = -bx; by = -by; bz = -bz; bw = -bw;
  }
  if (cos > 0.9995) {
    const q = { x: lerp(a.x, bx, t), y: lerp(a.y, by, t), z: lerp(a.z, bz, t), w: lerp(a.w, bw, t) };
    const l = Math.hypot(q.x, q.y, q.z, q.w) || 1;
    return { x: q.x / l, y: q.y / l, z: q.z / l, w: q.w / l };
  }
  const theta = Math.acos(cos);
  const s = Math.sin(theta);
  const wa = Math.sin((1 - t) * theta) / s;
  const wb = Math.sin(t * theta) / s;
  return { x: a.x * wa + bx * wb, y: a.y * wa + by * wb, z: a.z * wa + bz * wb, w: a.w * wa + bw * wb };
};

export const RAD = Math.PI / 180;
export const DEG = 180 / Math.PI;
export const KMH = 3.6;
export const GRAVITY = 9.81;
