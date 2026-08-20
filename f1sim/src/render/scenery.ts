/**
 * What stands beside the road.
 *
 * A circuit with nothing around it does not read as slow because it is
 * slow — it reads as slow because there is nothing to pass. The whole
 * sensation of speed at ground level comes from near objects sweeping
 * through the frame, and an empty green plane offers none: at three
 * hundred kilometres an hour the only thing moving is the road surface,
 * and tarmac has no texture to move.
 *
 * So: trees, marker boards, marshal posts and grandstands, placed along
 * the circuit and drawn the same way everything else is — flat colour,
 * black line, no detail that would not survive being seen for a fifth
 * of a second.
 *
 * All of it is instanced. One tree mesh drawn eight hundred times costs
 * one draw call and one matrix upload; eight hundred tree objects would
 * cost eight hundred of each, and a forest is exactly the case where
 * that difference decides whether the frame fits in sixteen
 * milliseconds. The outline hulls are instanced beside them, so the ink
 * scales the same way.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

import type { Circuit } from '../track/circuit';
import { outlineMaterial, outlineMesh, toonMaterial } from './toon';

/** Metres along the circuit between attempts to place something. */
const SPACING = 26;

/** How far past the run-off the treeline starts (m). */
const SETBACK = 6;

/** Depth of the band trees are scattered through (m). */
const DEPTH = 46;

/**
 * A deterministic scatter.
 *
 * `Math.random` would give a different forest every reload, which makes
 * a circuit unlearnable in exactly the way a circuit must not be: the
 * tree you brake at would move. This is the standard integer hash — the
 * same input always gives the same tree in the same place, and the
 * output is uncorrelated enough that a row of them does not look like a
 * row.
 */
const hash = (n: number): number => {
  let x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
};

/** A conifer: stacked cones on a trunk. */
const buildConifer = (): THREE.BufferGeometry[] => {
  const trunk = new THREE.CylinderGeometry(0.28, 0.36, 2.2, 6);
  trunk.translate(0, 1.1, 0);

  const parts: THREE.BufferGeometry[] = [];
  const tiers: [number, number, number][] = [
    [2.9, 3.4, 2.0],
    [2.2, 3.2, 4.3],
    [1.4, 2.8, 6.4]
  ];
  for (const [radius, height, y] of tiers) {
    const cone = new THREE.ConeGeometry(radius, height, 7);
    cone.translate(0, y + height / 2 - 1, 0);
    parts.push(cone);
  }

  const canopy = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  if (!canopy) throw new Error('conifer canopy failed to merge');
  return [trunk, canopy];
};

/** A broadleaf: a fat low-poly sphere on a short trunk. */
const buildBroadleaf = (): THREE.BufferGeometry[] => {
  const trunk = new THREE.CylinderGeometry(0.3, 0.42, 2.6, 6);
  trunk.translate(0, 1.3, 0);

  /* Two overlapping spheres rather than one. A single ball reads as a
     lollipop; two of different sizes, offset, reads as foliage — which
     is all the shape has to do at the distance it is seen from. */
  const big = new THREE.SphereGeometry(2.5, 7, 5);
  big.translate(0, 4.6, 0);
  const small = new THREE.SphereGeometry(1.8, 6, 4);
  small.translate(1.1, 3.6, 0.5);

  const canopy = mergeGeometries([big, small], false);
  big.dispose();
  small.dispose();
  if (!canopy) throw new Error('broadleaf canopy failed to merge');
  return [trunk, canopy];
};

/**
 * A grandstand: a raked bank of seating under a roof.
 *
 * Deliberately empty of people. A crowd drawn at this budget is a smear
 * of dots that reads as noise, and an empty stand at least reads as a
 * structure — which is what it is there to do.
 */
const buildGrandstand = (): THREE.BufferGeometry => {
  const parts: THREE.BufferGeometry[] = [];

  const box = (w: number, h: number, d: number, x: number, y: number, z: number) => {
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(x, y, z);
    parts.push(g);
  };

  // The rake, as five steps.
  for (let i = 0; i < 5; i++) {
    box(26, 1.4 + i * 0.2, 2.2, 0, (1.4 + i * 0.2) / 2, -i * 2.2);
  }
  // Roof and its two columns.
  box(27, 0.5, 12, 0, 9.4, -4.4);
  box(0.7, 9, 0.7, -12, 4.7, 1.2);
  box(0.7, 9, 0.7, 12, 4.7, 1.2);

  const merged = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  if (!merged) throw new Error('grandstand failed to merge');
  return merged;
};

/** A marshal post: a striped panel on a pole. */
const buildMarshalPost = (): THREE.BufferGeometry => {
  const pole = new THREE.CylinderGeometry(0.09, 0.09, 2.6, 5);
  pole.translate(0, 1.3, 0);
  const panel = new THREE.BoxGeometry(1.5, 1.0, 0.12);
  panel.translate(0, 2.9, 0);

  const merged = mergeGeometries([pole, panel], false);
  pole.dispose();
  panel.dispose();
  if (!merged) throw new Error('marshal post failed to merge');
  return merged;
};

interface Placement {
  position: THREE.Vector3;
  yaw: number;
  scale: number;
}

/** One instanced mesh, plus its ink, from a list of placements. */
const instance = (
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  outline: THREE.ShaderMaterial,
  placements: Placement[],
  group: THREE.Group
): void => {
  if (placements.length === 0) return;

  const mesh = new THREE.InstancedMesh(geometry, material, placements.length);
  mesh.castShadow = true;
  mesh.receiveShadow = false;

  /* The hull is its own instanced mesh over the same transforms. An
     outline added as a child would be drawn once for the whole
     instanced mesh rather than once per instance, which puts a single
     black tree somewhere near the origin. */
  const hullSource = outlineMesh(geometry, outline);
  const hull = new THREE.InstancedMesh(
    hullSource.geometry,
    outline,
    placements.length
  );
  hull.castShadow = false;

  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const axis = new THREE.Vector3(0, 1, 0);

  for (let i = 0; i < placements.length; i++) {
    const p = placements[i]!;
    quaternion.setFromAxisAngle(axis, p.yaw);
    scale.setScalar(p.scale);
    matrix.compose(p.position, quaternion, scale);
    mesh.setMatrixAt(i, matrix);
    hull.setMatrixAt(i, matrix);
  }

  mesh.instanceMatrix.needsUpdate = true;
  hull.instanceMatrix.needsUpdate = true;
  group.add(hull);
  group.add(mesh);
};

/**
 * Scatter scenery along a circuit.
 *
 * Everything is placed from the spline, so it follows the road round
 * rather than being dropped on a grid the circuit happens to cross —
 * and everything is set back past the run-off, so nothing a car can
 * reach at racing speed has a tree in it.
 */
export const buildScenery = (circuit: Circuit, density = 1): THREE.Group => {
  const group = new THREE.Group();
  /* Thinned rather than shrunk, and thinned *deterministically*.
     `hash(seed)` already decides whether a station gets a tree; raising
     the threshold it is compared against removes trees from a phone
     without moving any of the ones that remain. A player who learns to
     brake at a tree on a laptop finds the same tree in the same place
     on a phone — there are simply fewer of its neighbours. Scaling them
     smaller instead, or dropping every other one, would both break
     that. */
  const keep = Math.min(1, Math.max(0, density));
  const outline = outlineMaterial(2.0);

  const [coniferTrunk, coniferCanopy] = buildConifer() as [
    THREE.BufferGeometry,
    THREE.BufferGeometry
  ];
  const [broadTrunk, broadCanopy] = buildBroadleaf() as [
    THREE.BufferGeometry,
    THREE.BufferGeometry
  ];

  const trunks: Placement[] = [];
  const conifers: Placement[] = [];
  const broadleaves: Placement[] = [];
  const posts: Placement[] = [];
  const stands: Placement[] = [];

  const steps = Math.floor(circuit.length / SPACING);

  for (let i = 0; i < steps; i++) {
    const s = i * SPACING;
    const sample = circuit.spline.sampleAt(s);
    const edge =
      circuit.halfWidthAt(s) + circuit.kerbWidth + circuit.runoffAt(s) + SETBACK;

    for (const side of [-1, 1] as const) {
      const seed = i * 2 + (side > 0 ? 1 : 0);
      const roll = hash(seed);

      /* A gap in the trees every so often, because an unbroken hedge
         both sides is a corridor — and it is the gaps that let you see
         the corner after the one you are in. */
      if (roll > 0.72 * keep) continue;

      const out = edge + hash(seed * 7 + 1) * DEPTH;
      const along = (hash(seed * 13 + 2) - 0.5) * SPACING;
      const base = circuit.spline.sampleAt((s + along + circuit.length) % circuit.length);

      const position = new THREE.Vector3(
        base.position.x + sample.left.x * out * side,
        base.position.y - 0.4,
        base.position.z + sample.left.z * out * side
      );
      const yaw = hash(seed * 31 + 3) * Math.PI * 2;
      const scale = 0.8 + hash(seed * 17 + 4) * 0.9;

      trunks.push({ position, yaw, scale });
      if (hash(seed * 23 + 5) > 0.45) {
        conifers.push({ position, yaw, scale });
      } else {
        broadleaves.push({ position, yaw, scale });
      }
    }

    /* A marker post every fifth station, alternating sides — close to
       the road, where the eye actually uses it to judge distance. */
    if (i % (keep < 0.6 ? 10 : 5) === 0) {
      const side = i % 10 === 0 ? -1 : 1;
      const out = circuit.halfWidthAt(s) + circuit.kerbWidth + 1.6;
      posts.push({
        position: new THREE.Vector3(
          sample.position.x + sample.left.x * out * side,
          sample.position.y,
          sample.position.z + sample.left.z * out * side
        ),
        yaw: Math.atan2(sample.left.x * side, sample.left.z * side),
        scale: 1
      });
    }

    // A stand every eight hundred metres or so, set well back.
    if (i % Math.max(1, Math.round(800 / SPACING)) === 0) {
      const side = hash(i * 97) > 0.5 ? 1 : -1;
      const out = circuit.halfWidthAt(s) + circuit.kerbWidth + circuit.runoffAt(s) + 12;
      stands.push({
        position: new THREE.Vector3(
          sample.position.x + sample.left.x * out * side,
          sample.position.y,
          sample.position.z + sample.left.z * out * side
        ),
        yaw: Math.atan2(sample.left.x * side, sample.left.z * side) + Math.PI,
        scale: 1
      });
    }
  }

  const bark = toonMaterial(0x6b4a2f);
  instance(coniferTrunk, bark, outline, conifers, group);
  instance(broadTrunk, bark, outline, broadleaves, group);
  instance(coniferCanopy, toonMaterial(0x2f6b3a), outline, conifers, group);
  instance(broadCanopy, toonMaterial(0x4e9440), outline, broadleaves, group);
  instance(buildMarshalPost(), toonMaterial(0xd8dde3), outline, posts, group);
  instance(buildGrandstand(), toonMaterial(0xbcc4cc), outline, stands, group);

  return group;
};
