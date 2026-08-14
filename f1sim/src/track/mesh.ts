/**
 * Track mesh generation.
 *
 * Emits plain typed arrays rather than any engine's geometry type, so
 * the same output feeds the physics trimesh collider and the renderer.
 * That is the whole reason this lives in `track/` and not `render/`.
 *
 * The road is swept along the centreline: at each station the spline
 * gives a position and a left vector, banking rotates that vector about
 * the tangent, and vertices are laid out across it — tarmac, kerb,
 * run-off, then grass.
 */
import { v3add, v3cross, v3normalize, v3scale, vec3 } from '../core/math';
import type { Vec3 } from '../core/math';
import type { Circuit, SurfaceKind } from './circuit';

export interface TrackGeometry {
  positions: Float32Array;
  indices: Uint32Array;
  normals: Float32Array;
  /** Per-vertex colour, so one draw call shows every surface. */
  colors: Float32Array;
  /** Surface kind per vertex, for debugging and for the minimap. */
  surfaces: SurfaceKind[];
  vertexCount: number;
  triangleCount: number;
}

const SURFACE_COLOR: Record<SurfaceKind, [number, number, number]> = {
  tarmac: [0.19, 0.2, 0.22],
  kerb: [0.78, 0.16, 0.16],
  runoff: [0.32, 0.31, 0.33],
  gravel: [0.55, 0.48, 0.36],
  grass: [0.2, 0.34, 0.2]
};

interface Station {
  t: number;
  surface: SurfaceKind;
  drop: number;
}

/**
 * Clamp the cross-section so it cannot fold through itself.
 *
 * Sweeping a fixed-width ribbon along a curve is only valid while the
 * ribbon is narrower than the radius of curvature. At Spa's hairpins the
 * radius is 24 m while the run-off and grass reach 33 m from the
 * centreline, so the inner edge wraps past the centre of the corner and
 * comes back out over the road — a sheet of grass lying on top of the
 * racing line. A car driving into it is thrown off the circuit, and a
 * downward raycast finds grass where the tarmac should be.
 *
 * Stations on the inside of the corner are therefore pulled in to a
 * fraction of the radius, and kept strictly ordered so the quads
 * degenerate rather than invert.
 */
const clampToCurvature = (stations: Station[], curvature: number): Station[] => {
  const kappa = Math.abs(curvature);
  if (kappa < 1e-6) return stations;

  const limit = 0.75 / kappa;
  // Positive curvature turns left, and the inside of a left-hander is
  // the +t side.
  const insideIsPositive = curvature > 0;

  const clamped = stations.map((st) => {
    const inside = insideIsPositive ? st.t > 0 : st.t < 0;
    if (!inside || Math.abs(st.t) <= limit) return st;
    return { ...st, t: Math.sign(st.t) * limit };
  });

  // Keep the sequence strictly increasing so no quad turns inside out.
  for (let i = 1; i < clamped.length; i++) {
    const prev = clamped[i - 1]!;
    const cur = clamped[i]!;
    if (cur.t <= prev.t) cur.t = prev.t + 0.01;
  }
  return clamped;
};

/** Lateral stations across the road, as offsets from the centreline. */
const lateralStations = (circuit: Circuit, s: number, curvature = 0): Station[] => {
  const w = circuit.halfWidthAt(s);
  const k = circuit.kerbWidth;
  const r = circuit.runoffAt(s);

  // `drop` lowers the outer surfaces slightly so the road edge reads as
  // an edge rather than a colour change.
  const stations: Station[] = [
    { t: -(w + k + r + 14), surface: 'grass', drop: 0.35 },
    { t: -(w + k + r), surface: 'grass', drop: 0.12 },
    { t: -(w + k + r) + 0.01, surface: 'runoff', drop: 0.1 },
    { t: -(w + k), surface: 'runoff', drop: 0.04 },
    { t: -(w + k) + 0.01, surface: 'kerb', drop: 0.03 },
    { t: -w, surface: 'kerb', drop: 0 },
    { t: -w + 0.01, surface: 'tarmac', drop: 0 },
    { t: 0, surface: 'tarmac', drop: 0 },
    { t: w - 0.01, surface: 'tarmac', drop: 0 },
    { t: w, surface: 'kerb', drop: 0 },
    { t: w + k - 0.01, surface: 'kerb', drop: 0.03 },
    { t: w + k, surface: 'runoff', drop: 0.04 },
    { t: w + k + r - 0.01, surface: 'runoff', drop: 0.1 },
    { t: w + k + r, surface: 'grass', drop: 0.12 },
    { t: w + k + r + 14, surface: 'grass', drop: 0.35 }
  ];

  return clampToCurvature(stations, curvature);
};

/**
 * @param stationSpacing distance between cross-sections (m). Four metres
 *        keeps Eau Rouge smooth without producing a million triangles.
 */
export const buildTrackGeometry = (circuit: Circuit, stationSpacing = 4): TrackGeometry => {
  const rings = Math.max(8, Math.round(circuit.length / stationSpacing));
  const across = lateralStations(circuit, 0, 0).length;

  const positions = new Float32Array(rings * across * 3);
  const normals = new Float32Array(rings * across * 3);
  const colors = new Float32Array(rings * across * 3);
  const surfaces: SurfaceKind[] = new Array(rings * across);
  const indices = new Uint32Array(rings * (across - 1) * 6);

  let vi = 0;
  let ii = 0;

  for (let ring = 0; ring < rings; ring++) {
    const s = (ring / rings) * circuit.length;
    const sample = circuit.spline.sampleAt(s);
    const banking = circuit.bankingAt(s);
    const stations = lateralStations(circuit, s, sample.curvature);

    // Banking rotates the lateral axis about the tangent.
    const left = rotateAboutAxis(sample.left, sample.tangent, banking);
    const up = v3normalize(v3cross(sample.tangent, left));

    for (const station of stations) {
      const lateral = v3scale(left, station.t);
      const vertical = v3scale(up, -station.drop);
      const p = v3add(v3add(sample.position, lateral), vertical);

      positions[vi * 3] = p.x;
      positions[vi * 3 + 1] = p.y;
      positions[vi * 3 + 2] = p.z;

      normals[vi * 3] = up.x;
      normals[vi * 3 + 1] = up.y;
      normals[vi * 3 + 2] = up.z;

      const c = SURFACE_COLOR[station.surface];
      colors[vi * 3] = c[0];
      colors[vi * 3 + 1] = c[1];
      colors[vi * 3 + 2] = c[2];

      surfaces[vi] = station.surface;
      vi++;
    }
  }

  // Stitch consecutive rings, wrapping the last back to the first so the
  // lap is closed and a car crossing the line does not fall through.
  for (let ring = 0; ring < rings; ring++) {
    const a = ring * across;
    const b = ((ring + 1) % rings) * across;

    for (let k = 0; k < across - 1; k++) {
      indices[ii++] = a + k;
      indices[ii++] = b + k;
      indices[ii++] = a + k + 1;

      indices[ii++] = a + k + 1;
      indices[ii++] = b + k;
      indices[ii++] = b + k + 1;
    }
  }

  return {
    positions,
    indices,
    normals,
    colors,
    surfaces,
    vertexCount: vi,
    triangleCount: ii / 3
  };
};

/** Rodrigues rotation of `v` about a unit `axis`. */
const rotateAboutAxis = (v: Vec3, axis: Vec3, angle: number): Vec3 => {
  if (angle === 0) return v;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const cross = v3cross(axis, v);
  const dot = axis.x * v.x + axis.y * v.y + axis.z * v.z;
  return vec3(
    v.x * c + cross.x * s + axis.x * dot * (1 - c),
    v.y * c + cross.y * s + axis.y * dot * (1 - c),
    v.z * c + cross.z * s + axis.z * dot * (1 - c)
  );
};
