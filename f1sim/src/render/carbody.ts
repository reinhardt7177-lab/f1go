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

  /* --- floor ----------------------------------------------------------
   *
   * Wide, and that is the single biggest fix to how the car reads. The
   * floor was 1.15 m against a 1.6 m track width, so the wheels stood
   * clear of a narrow spine and the whole thing looked like a tube on
   * outriggers. A real single-seater is a plank very nearly as wide as
   * its axles with a body sitting in the middle of it, and drawing it
   * that way is what turns the silhouette from a go-kart into an F1
   * car. */
  livery.box(1.52, 0.06, 4.4, 0, floorY, -0.05);
  // Floor edge, darker, so the plank reads as a separate surface from
  // the bodywork standing on it rather than as the bottom of a slab.
  for (const side of [-1, 1]) {
    dark.box(0.09, 0.09, 4.2, side * 0.74, floorY + 0.01, -0.05);
  }

  // --- tub and cockpit -------------------------------------------------
  // The survival cell, tapering forward into the nose rather than
  // stopping at a wall — one continuous piece is what stops the car
  // looking like parts stacked on a plank.
  livery.taper(0.6, 0.84, 0.42, 2.15, 0, floorY + 0.27, 0.15);
  // Cockpit opening, and a helmet in it. A single-seater with nobody in
  // it reads as a model of a car; a helmet is four hundred triangles
  // and it reads as a car with a driver.
  dark.box(0.5, 0.1, 0.86, 0, floorY + 0.46, -0.35);
  const helmet = new THREE.SphereGeometry(0.16, 8, 6);
  helmet.scale(1, 1.05, 1.15);
  helmet.translate(0, floorY + 0.5, -0.2);
  accent.add(helmet);

  // --- nose ------------------------------------------------------------
  livery.taper(0.24, 0.58, 0.22, 1.55, 0, floorY + 0.24, -1.6);
  livery.taper(0.17, 0.25, 0.17, 0.75, 0, floorY + 0.2, -2.52);
  accent.box(0.1, 0.03, 1.95, 0, floorY + 0.36, -1.7);

  /* --- sidepods --------------------------------------------------------
   *
   * Big slabs either side, now sitting on the floor's edge rather than
   * floating beside the tub. On a real car these are sculpted and full
   * of inlets; drawn, they are the shape that says *modern
   * single-seater*, and nothing smaller than a slab survives being seen
   * at two hundred metres. */
  for (const side of [-1, 1]) {
    livery.taper(0.5, 0.26, 0.42, 1.85, side * 0.5, floorY + 0.25, 0.5);
    // Inlet mouth, set into the front face.
    dark.box(0.34, 0.24, 0.12, side * 0.5, floorY + 0.27, -0.4);
    /* Bargeboard ahead of it. A vertical fin in the gap between front
       wheel and sidepod — the part of a modern car that fills what
       would otherwise be a hole in the side view. */
    accent.box(0.05, 0.26, 0.7, side * 0.62, floorY + 0.2, -1.15);
  }

  // --- engine cover, airbox and fin ------------------------------------
  livery.taper(0.44, 0.14, 0.42, 1.8, 0, floorY + 0.42, 1.3);
  dark.box(0.3, 0.3, 0.5, 0, floorY + 0.68, 0.5);
  /* The shark fin. Nothing else on the car gives the long flat surface
     a livery needs, and from behind — which is where the player spends
     the race looking at nine of these — it is most of the silhouette. */
  accent.taper(0.05, 0.05, 0.34, 1.5, 0, floorY + 0.72, 1.5);

  // --- halo ------------------------------------------------------------
  const halo = new THREE.TorusGeometry(0.42, 0.05, 6, 18, Math.PI);
  halo.rotateX(-Math.PI / 2);
  halo.translate(0, floorY + 0.6, -0.35);
  dark.add(halo);
  dark.rod(0.028, 0.36, 0, floorY + 0.44, -0.77);

  /* --- front wing ------------------------------------------------------
   *
   * Three elements rather than two, and endplates that turn outward.
   * The wing is the first thing you see of a car you are catching, and
   * a single flat plate reads as a shelf. */
  accent.box(1.78, 0.06, 0.5, 0, floorY - 0.03, -2.9);
  accent.box(1.62, 0.05, 0.34, 0, floorY + 0.05, -3.02);
  accent.box(1.3, 0.05, 0.26, 0, floorY + 0.13, -3.08);
  for (const side of [-1, 1]) {
    accent.box(0.06, 0.34, 0.66, side * 0.88, floorY + 0.06, -2.94);
    // Turned out at the bottom, which is the shape of a modern endplate.
    livery.box(0.16, 0.05, 0.5, side * 0.94, floorY - 0.06, -2.86);
  }

  // --- rear wing -------------------------------------------------------
  accent.box(1.08, 0.08, 0.46, 0, floorY + 0.95, 2.28);
  accent.box(1.0, 0.05, 0.26, 0, floorY + 0.79, 2.38);
  for (const side of [-1, 1]) {
    accent.box(0.05, 0.46, 0.6, side * 0.52, floorY + 0.8, 2.28);
  }
  livery.box(0.1, 0.5, 0.3, 0, floorY + 0.6, 2.2);

  /* --- diffuser --------------------------------------------------------
   *
   * Rising away under the back of the floor, with strakes. It is the
   * one part of the car a following driver sees more of the closer they
   * get, which makes it worth more than its triangle count. */
  dark.taper(1.1, 1.32, 0.3, 0.66, 0, floorY + 0.13, 2.05);
  for (const side of [-1, 1]) {
    dark.box(0.04, 0.22, 0.6, side * 0.3, floorY + 0.14, 2.05);
  }

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
