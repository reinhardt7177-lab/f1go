/**
 * The car, drawn.
 *
 * This replaces a generated GLB of eleven thousand triangles, and the
 * reason is not the file size. A photographic model is the wrong input
 * to a drawn renderer: an ink line traced around a silhouette that
 * detailed follows every duct and winglet, and what comes out reads as
 * a 3D model someone has outlined rather than as a drawing. A comic
 * gets its clarity from having few shapes and making them large.
 *
 * So the car is written instead of loaded. Everything below is a box, a
 * cylinder or a half-torus, sized off the chassis the simulation is
 * actually driving — the wheelbase, the track and the axle line come
 * from `ChassisParams`, so the drawing cannot disagree with the physics
 * about how big the car is or where its wheels are.
 *
 * Three geometries come out rather than one, and they are the three
 * things a livery is made of: the body colour, an accent that carries
 * the wings, and the parts that stay black on every car. Merging each
 * into a single buffer means a car is three draw calls and three ink
 * hulls no matter how many boxes went into it.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

import type { ChassisParams } from '../sim/vehicle';

export interface CarGeometry {
  /** The body colour — tub, nose, sidepods, engine cover. */
  livery: THREE.BufferGeometry;
  /** Wings and the stripe over the nose. */
  accent: THREE.BufferGeometry;
  /** Halo, airbox intake, suspension. Black on every car. */
  dark: THREE.BufferGeometry;
}

/** Collects boxes and cylinders into one buffer. */
class Parts {
  private readonly parts: THREE.BufferGeometry[] = [];

  box(w: number, h: number, d: number, x: number, y: number, z: number): this {
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(x, y, z);
    this.parts.push(g);
    return this;
  }

  /** A box tapered along its length, for a nose or an engine cover. */
  taper(
    frontW: number,
    rearW: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number
  ): this {
    /* A four-sided cylinder is a tapered box: turned 45 degrees its
       faces face outward, and the two radii give the two widths without
       having to move vertices by hand. */
    const g = new THREE.CylinderGeometry(rearW / 2, frontW / 2, d, 4, 1);
    g.rotateY(Math.PI / 4);
    g.rotateX(-Math.PI / 2);
    g.scale(1, h / Math.max(frontW, rearW), 1);
    g.translate(x, y, z);
    this.parts.push(g);
    return this;
  }

  rod(radius: number, length: number, x: number, y: number, z: number, tiltZ = 0, tiltX = 0): this {
    const g = new THREE.CylinderGeometry(radius, radius, length, 6);
    if (tiltZ) g.rotateZ(tiltZ);
    if (tiltX) g.rotateX(tiltX);
    g.translate(x, y, z);
    this.parts.push(g);
    return this;
  }

  add(geometry: THREE.BufferGeometry): this {
    this.parts.push(geometry);
    return this;
  }

  merge(what: string): THREE.BufferGeometry {
    const merged = mergeGeometries(this.parts, false);
    for (const part of this.parts) part.dispose();
    if (!merged) throw new Error(`${what} failed to merge`);
    return merged;
  }
}

/**
 * @param wheelCentreY  height of the wheel centres in the body's frame,
 *                      which is where the road is minus a tyre radius
 */
export const buildCarGeometry = (
  chassis: ChassisParams,
  wheelCentreY: number
): CarGeometry => {
  const frontZ = -chassis.wheelbase * (1 - chassis.frontWeightBias);
  const rearZ = chassis.wheelbase * chassis.frontWeightBias;
  const halfTrack = chassis.trackFront / 2;

  /* The floor, and everything measured from it. A single-seater is a
     plank with a body on it, and getting the plank right is most of
     what makes the proportions read. */
  const floorY = wheelCentreY - chassis.wheelRadius + 0.08;

  const livery = new Parts();
  const accent = new Parts();
  const dark = new Parts();

  // --- floor and tub ---------------------------------------------------
  livery.box(1.15, 0.07, 4.3, 0, floorY, -0.1);
  // The survival cell, tapering forward into the nose rather than
  // stopping at a wall — one continuous piece is what stops the car
  // looking like parts stacked on a plank.
  livery.taper(0.62, 0.86, 0.44, 2.1, 0, floorY + 0.28, 0.2);

  // --- nose ------------------------------------------------------------
  livery.taper(0.26, 0.6, 0.24, 1.5, 0, floorY + 0.24, -1.6);
  livery.taper(0.2, 0.27, 0.2, 0.7, 0, floorY + 0.2, -2.5);
  accent.box(0.1, 0.03, 1.9, 0, floorY + 0.37, -1.7);

  // --- sidepods --------------------------------------------------------
  /* Big slabs either side. On a real car these are sculpted and full of
     inlets; drawn, they are the shape that says *this is a modern
     single-seater* and nothing smaller than a slab survives being seen
     at two hundred metres. */
  for (const side of [-1, 1]) {
    livery.taper(0.46, 0.3, 0.4, 1.7, side * 0.52, floorY + 0.24, 0.55);
    // Inlet mouth, set into the front face.
    dark.box(0.3, 0.22, 0.1, side * 0.52, floorY + 0.26, -0.29);
  }

  // --- engine cover and airbox -----------------------------------------
  livery.taper(0.42, 0.16, 0.4, 1.7, 0, floorY + 0.42, 1.35);
  dark.box(0.32, 0.3, 0.55, 0, floorY + 0.68, 0.55);

  // --- halo ------------------------------------------------------------
  const halo = new THREE.TorusGeometry(0.42, 0.05, 6, 18, Math.PI);
  halo.rotateX(-Math.PI / 2);
  halo.translate(0, floorY + 0.6, -0.35);
  dark.add(halo);
  dark.rod(0.028, 0.36, 0, floorY + 0.44, -0.77);

  // --- front wing ------------------------------------------------------
  accent.box(1.75, 0.07, 0.62, 0, floorY - 0.02, -2.95);
  accent.box(1.2, 0.05, 0.4, 0, floorY + 0.09, -3.05);
  for (const side of [-1, 1]) {
    accent.box(0.06, 0.3, 0.66, side * 0.86, floorY + 0.08, -2.95);
  }

  // --- rear wing -------------------------------------------------------
  accent.box(1.05, 0.09, 0.5, 0, floorY + 0.92, 2.25);
  accent.box(0.95, 0.05, 0.28, 0, floorY + 0.76, 2.35);
  for (const side of [-1, 1]) {
    accent.box(0.05, 0.42, 0.56, side * 0.5, floorY + 0.78, 2.25);
  }
  livery.box(0.1, 0.5, 0.3, 0, floorY + 0.6, 2.2);

  // --- diffuser --------------------------------------------------------
  dark.taper(0.9, 1.1, 0.26, 0.6, 0, floorY + 0.11, 2.02);

  // --- suspension ------------------------------------------------------
  /* Wishbones out to each wheel. Four rods do more for reading the car
     as a racing car than any amount of detail on the bodywork, because
     they are the only parts with air all the way round them. */
  for (const side of [-1, 1]) {
    for (const [z, reach] of [[frontZ, 0.16], [rearZ, -0.16]] as const) {
      dark.rod(0.032, halfTrack * 0.86, side * halfTrack * 0.5, floorY + 0.2, z + reach, Math.PI / 2);
      dark.rod(0.028, halfTrack * 0.8, side * halfTrack * 0.5, floorY + 0.36, z - reach * 0.4, Math.PI / 2);
    }
  }

  return {
    livery: livery.merge('car livery'),
    accent: accent.merge('car wings'),
    dark: dark.merge('car furniture')
  };
};

/** A tyre, sized off the chassis and lying on its axle. */
export const buildWheelGeometry = (chassis: ChassisParams): THREE.BufferGeometry => {
  const tyre = new THREE.CylinderGeometry(
    chassis.wheelRadius,
    chassis.wheelRadius,
    0.38,
    16
  );
  tyre.rotateZ(Math.PI / 2);
  return tyre;
};

/** Where each wheel bolts on, in the body's frame. */
export const wheelMounts = (
  chassis: ChassisParams,
  wheelCentreY: number
): [number, number, number][] => {
  const frontZ = -chassis.wheelbase * (1 - chassis.frontWeightBias);
  const rearZ = chassis.wheelbase * chassis.frontWeightBias;
  return [
    [-chassis.trackFront / 2, wheelCentreY, frontZ],
    [chassis.trackFront / 2, wheelCentreY, frontZ],
    [-chassis.trackRear / 2, wheelCentreY, rearZ],
    [chassis.trackRear / 2, wheelCentreY, rearZ]
  ];
};
