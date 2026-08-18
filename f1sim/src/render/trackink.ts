/**
 * The lines that make a circuit a drawing.
 *
 * Toon shading did almost nothing to the road, and it was never going
 * to: the circuit is a near-flat plane facing the sky, so it is lit by
 * one band of the ramp everywhere and comes out the same colour it went
 * in. The cars gained an outline and the track they were driving on did
 * not, which is exactly the mismatch that reads as *the cars have been
 * pasted onto a photograph*.
 *
 * What a comic would draw is not shading but boundaries — where the
 * tarmac ends, where the kerb ends, where the run-off gives way to
 * grass. Those are the lines that tell you the shape of a corner three
 * hundred metres before you reach it, and under flat light they are the
 * only thing that does.
 *
 * So they are drawn literally: a thin ribbon of black laid along each
 * boundary, swept the same way the road was and from the same vertices,
 * which is what keeps a line on the edge it belongs to rather than
 * hovering beside it through a corner.
 */
import * as THREE from 'three';

import type { TrackGeometry } from '../track/mesh';

/**
 * Height above the road (m).
 *
 * Enough to clear the depth buffer at the far end of a straight, and
 * small enough that a wheel never visibly rides over it. Depth-testing
 * a coplanar surface is the alternative, and it flickers.
 */
const LIFT = 0.025;

/**
 * Build one geometry holding every line on the circuit.
 *
 * Each ring contributes one quad per inked station, whose width comes
 * from the cross-section. The lateral direction is taken from the
 * neighbouring stations rather than from the spline, because a station
 * clamped by curvature has moved and the line has to move with it.
 */
export const buildTrackInk = (track: TrackGeometry): THREE.BufferGeometry => {
  const { rings, across, inkStations, positions, normals } = track;

  const quads = rings * inkStations.length;
  const vertices = new Float32Array(quads * 4 * 3);
  const indices = new Uint32Array(quads * 6);

  let vi = 0;
  let ii = 0;

  const at = (ring: number, station: number, out: THREE.Vector3): THREE.Vector3 => {
    const i = (ring * across + station) * 3;
    return out.set(positions[i]!, positions[i + 1]!, positions[i + 2]!);
  };

  const here = new THREE.Vector3();
  const inner = new THREE.Vector3();
  const outer = new THREE.Vector3();
  const up = new THREE.Vector3();
  const side = new THREE.Vector3();

  for (const { station, width } of inkStations) {
    // Neighbours across the road, clamped at the edges of the section.
    const before = Math.max(0, station - 1);
    const after = Math.min(across - 1, station + 1);
    const half = width / 2;

    for (let ring = 0; ring < rings; ring++) {
      at(ring, station, here);
      at(ring, before, inner);
      at(ring, after, outer);

      const n = (ring * across + station) * 3;
      up.set(normals[n]!, normals[n + 1]!, normals[n + 2]!);

      side.subVectors(outer, inner);
      if (side.lengthSq() < 1e-12) side.set(1, 0, 0);
      side.normalize().multiplyScalar(half);

      here.addScaledVector(up, LIFT);

      // Two vertices across, this ring; the next ring supplies the
      // other two, so consecutive rings share nothing and each quad is
      // independent — simpler than a strip, and the same triangle count.
      const nextRing = (ring + 1) % rings;
      const push = (p: THREE.Vector3): void => {
        vertices[vi++] = p.x;
        vertices[vi++] = p.y;
        vertices[vi++] = p.z;
      };

      const base = vi / 3;
      push(here.clone().sub(side));
      push(here.clone().add(side));

      at(nextRing, station, here);
      at(nextRing, before, inner);
      at(nextRing, after, outer);
      const m = (nextRing * across + station) * 3;
      up.set(normals[m]!, normals[m + 1]!, normals[m + 2]!);
      side.subVectors(outer, inner);
      if (side.lengthSq() < 1e-12) side.set(1, 0, 0);
      side.normalize().multiplyScalar(half);
      here.addScaledVector(up, LIFT);

      push(here.clone().sub(side));
      push(here.clone().add(side));

      indices[ii++] = base;
      indices[ii++] = base + 2;
      indices[ii++] = base + 1;
      indices[ii++] = base + 1;
      indices[ii++] = base + 2;
      indices[ii++] = base + 3;
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeBoundingSphere();
  return geometry;
};

/**
 * Ink, as a material.
 *
 * Unlit — a line drawn on a picture is not a surface in it, and shading
 * it would have the near lines and the far ones read as different
 * colours. Fog is left on, because a line that stayed pure black into
 * the haze would be the one thing in the scene that did.
 */
export const inkMaterial = (): THREE.MeshBasicMaterial =>
  new THREE.MeshBasicMaterial({
    color: 0x101418,
    // Not double-sided: seen from underneath the circuit — which is
    // where a car that has left it ends up — the lines should not show
    // through the road.
    side: THREE.FrontSide
  });
