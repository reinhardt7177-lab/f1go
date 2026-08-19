/**
 * The wall at the edge of the circuit.
 *
 * Drawn only. It is deliberately not part of the collider, and that is
 * the whole design: a thin wall in a trimesh is something a car at 250
 * km/h goes through or climbs, and a car that hits one squarely stops
 * dead or flips. Neither is what a ten-year-old should get for running
 * wide. `sim/world.ts` keeps the car inside with a restoring force
 * instead, and this is what that force looks like.
 *
 * So the two have to agree about where the edge is, and they do —
 * both read it from the same place. `track/mesh.ts` marks the stations
 * a barrier stands on, the same way it marks the ones that carry an ink
 * line, so the cross-section stays the only thing that knows the shape
 * of the road.
 *
 * Built like `trackink.ts`: swept from the vertices the road was swept
 * from, so the wall follows every corner exactly rather than being
 * fitted alongside it.
 */
import * as THREE from 'three';

import type { TrackGeometry } from '../track/mesh';
import { outlineMaterial, outlineMesh, toonMaterial } from './toon';

/** Height of the wall (m). */
const HEIGHT = 1.05;

/** Depth of the red cap along the top (m). */
const CAP = 0.2;

/** Set into the verge slightly, so its foot is never left hanging. */
const FOOT = -0.12;

interface Ribbon {
  positions: number[];
  indices: number[];
}

const emptyRibbon = (): Ribbon => ({ positions: [], indices: [] });

const push = (r: Ribbon, p: THREE.Vector3): number => {
  const index = r.positions.length / 3;
  r.positions.push(p.x, p.y, p.z);
  return index;
};

const geometryOf = (r: Ribbon): THREE.BufferGeometry => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(r.positions, 3));
  geometry.setIndex(r.indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
};

/**
 * A wall along every barrier station on the circuit.
 *
 * Two ribbons come back in one group: the white face and the red cap
 * along its top. Splitting them is what lets the cap be a different
 * colour without a texture or a second material on one mesh — and the
 * cap is worth having, because a plain white wall at a distance reads
 * as a gap in the scenery rather than as a barrier.
 */
export const buildBarriers = (track: TrackGeometry): THREE.Group => {
  const { rings, across, barrierStations, positions, normals } = track;
  const group = new THREE.Group();
  if (barrierStations.length === 0) return group;

  const face = emptyRibbon();
  const cap = emptyRibbon();

  const foot = new THREE.Vector3();
  const up = new THREE.Vector3();

  const at = (ring: number, station: number, out: THREE.Vector3): THREE.Vector3 => {
    const i = (ring * across + station) * 3;
    return out.set(positions[i]!, positions[i + 1]!, positions[i + 2]!);
  };

  for (const station of barrierStations) {
    for (let ring = 0; ring < rings; ring++) {
      const next = (ring + 1) % rings;

      /* Four corners, this ring and the next. The wall is a single
         plane rather than a box: seen from the circuit only one side of
         it is ever visible, and a box would double the triangles for a
         face nobody can reach. */
      const corners: THREE.Vector3[] = [];
      for (const r of [ring, next]) {
        at(r, station, foot);
        const n = (r * across + station) * 3;
        up.set(normals[n]!, normals[n + 1]!, normals[n + 2]!);
        corners.push(
          foot.clone().addScaledVector(up, FOOT),
          foot.clone().addScaledVector(up, HEIGHT - CAP),
          foot.clone().addScaledVector(up, HEIGHT)
        );
      }

      const [aLow, aMid, aTop, bLow, bMid, bTop] = corners as [
        THREE.Vector3, THREE.Vector3, THREE.Vector3,
        THREE.Vector3, THREE.Vector3, THREE.Vector3
      ];

      const quad = (r: Ribbon, p0: THREE.Vector3, p1: THREE.Vector3, q0: THREE.Vector3, q1: THREE.Vector3): void => {
        const i0 = push(r, p0);
        const i1 = push(r, p1);
        const i2 = push(r, q0);
        const i3 = push(r, q1);
        r.indices.push(i0, i2, i1, i1, i2, i3);
      };

      quad(face, aLow, aMid, bLow, bMid);
      quad(cap, aMid, aTop, bMid, bTop);
    }
  }

  const outline = outlineMaterial(2.0);
  for (const [ribbon, colour] of [
    [face, 0xeef1f4],
    [cap, 0xd8232a]
  ] as const) {
    const geometry = geometryOf(ribbon);
    const mesh = new THREE.Mesh(geometry, toonMaterial(colour));
    // A wall casts a long shadow across the run-off at a low sun, and
    // it is scenery — the road under it is what matters.
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    /* Both faces: the wall is a single plane, and from the far side of
       a corner you are looking at its back. */
    (mesh.material as THREE.MeshToonMaterial).side = THREE.DoubleSide;
    mesh.add(outlineMesh(geometry, outline));
    group.add(mesh);
  }

  return group;
};
