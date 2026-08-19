/**
 * Cartoon shading.
 *
 * Two pieces make a drawing rather than a photograph: light that lands
 * in a few flat bands instead of a smooth falloff, and a black line
 * around the silhouette. Both are here, and nothing else in the
 * renderer needs to know how either works.
 *
 * The line is the important half. A racing game asks one question of
 * its graphics twenty times a lap — *which car is that, and how far
 * ahead is it* — and a photographic renderer answers it badly: at two
 * hundred metres, through fog, a red car and an orange one are the same
 * grey smear. Flat colour inside a black outline is still legible when
 * it is forty pixels wide, which is what a rival looks like at the far
 * end of a straight.
 *
 * The outline is an inverted hull: the same mesh drawn back-face-only,
 * pushed out along its normals, in black. Everything the hull covers is
 * then overdrawn by the model itself, and what survives is a rim of
 * exactly the thickness it was pushed by.
 *
 * Two details make it hold up. The push is scaled by view depth, so a
 * distant car keeps a line of the same weight on screen rather than
 * fading to nothing. And the hull is welded before it is pushed —
 * a box has three normals at every corner, so pushing the unwelded mesh
 * sends its faces off in three directions and opens a gap at every
 * edge.
 */
import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Bands of light. Four reads as drawn; more starts to look smooth. */
const BANDS = 4;

/** Line weight, roughly in pixels at a 1080-tall viewport. */
export const OUTLINE_WEIGHT = 2.4;

let gradient: THREE.DataTexture | null = null;

/**
 * The ramp `MeshToonMaterial` quantises light through: a 1-D texture
 * sampled with nearest-neighbour, so the bands have hard edges.
 *
 * The darkest band is not black. Shadowed bodywork outdoors is lit by
 * the sky, and a car whose far side falls to nothing reads as a hole
 * cut in the picture rather than as a car.
 */
const toonGradient = (): THREE.DataTexture => {
  if (gradient) return gradient;

  const data = new Uint8Array(BANDS * 4);
  for (let i = 0; i < BANDS; i++) {
    const t = i / (BANDS - 1);
    const v = Math.round(255 * (0.42 + 0.58 * t));
    data[i * 4] = v;
    data[i * 4 + 1] = v;
    data[i * 4 + 2] = v;
    data[i * 4 + 3] = 255;
  }

  const texture = new THREE.DataTexture(data, BANDS, 1, THREE.RGBAFormat);
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  gradient = texture;
  return texture;
};

export interface ToonOptions {
  /** Rim light along the silhouette, 0..1. Sells a curved surface. */
  emissive?: number;
}

/** A flat-shaded material in the given colour. */
export const toonMaterial = (
  colour: THREE.ColorRepresentation,
  options: ToonOptions = {}
): THREE.MeshToonMaterial => {
  const material = new THREE.MeshToonMaterial({
    color: colour,
    gradientMap: toonGradient()
  });
  if (options.emissive !== undefined) {
    material.emissive = new THREE.Color(colour).multiplyScalar(options.emissive);
  }
  return material;
};

/**
 * The ink line.
 *
 * `thickness` is in pixels at a 1080-tall viewport rather than in
 * metres, because the line is a drawing convention and not part of the
 * car. Scaling the push by `-mvPosition.z` is what converts it: at
 * twice the distance a metre covers half the pixels, so doubling the
 * push holds the line still.
 *
 * `screenHeight` has to be fed back in on resize — a fixed constant
 * would give a phone a line four times too heavy.
 */
export const outlineMaterial = (thickness = OUTLINE_WEIGHT): THREE.ShaderMaterial =>
  new THREE.ShaderMaterial({
    uniforms: {
      thickness: { value: thickness },
      screenHeight: { value: 1080 }
    },
    vertexShader: /* glsl */ `
      uniform float thickness;
      uniform float screenHeight;
      void main() {
        vec3 pos = position;
        vec3 nrm = normal;

        /* Instanced draws have to apply their own transform.
         *
         * Three.js injects instanceMatrix and this define for an
         * InstancedMesh whatever the material is, but it only *uses*
         * them in shaders it builds itself. A hand-written one that
         * ignores them draws every instance at the object's origin —
         * which, with several hundred outline hulls and an origin that
         * happens to be the start line, is a solid black shell around
         * the camera and a screen that renders nothing but the car.
         *
         * The normal needs the same treatment. normalMatrix knows
         * about the mesh but not about the instance, so an unrotated
         * normal would push the hull out along the wrong axis. */
        #ifdef USE_INSTANCING
          pos = (instanceMatrix * vec4(pos, 1.0)).xyz;
          nrm = mat3(instanceMatrix) * nrm;
        #endif

        vec4 mv = modelViewMatrix * vec4(pos, 1.0);
        vec3 n = normalize(normalMatrix * nrm);
        /* Perspective divide takes a metre to (focal / -z) pixels, so
           the push has to carry -z to come out constant on screen. The
           2.0 is the clip cube's height in NDC. */
        float perPixel = (2.0 * -mv.z) / (projectionMatrix[1][1] * screenHeight);
        mv.xyz += n * thickness * perPixel;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      void main() { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); }
    `,
    side: THREE.BackSide,
    fog: false
  });

/**
 * A hull for `geometry`, ready to add beside the mesh it outlines.
 *
 * Welding is what makes the line continuous: `mergeVertices` collapses
 * the duplicated corner vertices a box or a cylinder ships with, and
 * recomputing normals afterwards averages the faces that meet there
 * into one direction to push along.
 */
export const outlineMesh = (
  geometry: THREE.BufferGeometry,
  material: THREE.ShaderMaterial
): THREE.Mesh => {
  const welded = mergeVertices(geometry.clone(), 1e-4);
  welded.computeVertexNormals();
  const mesh = new THREE.Mesh(welded, material);
  // The hull is a drawing, not an object: it must never cast a shadow
  // of its own, and it must never be picked up as geometry by anything
  // measuring the car.
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.userData.outline = true;
  return mesh;
};

/**
 * Convert a loaded model's materials in place.
 *
 * A GLB arrives with whatever the exporter wrote — usually physically
 * based, often with a texture. The colour and the map are worth
 * keeping; the roughness and metalness describe a lighting model that
 * is no longer running.
 */
export const toonifyMaterials = (root: THREE.Object3D): void => {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || !mesh.material) return;

    const convert = (source: THREE.Material): THREE.Material => {
      const standard = source as THREE.MeshStandardMaterial;
      if (!('color' in standard)) return source;
      const material = new THREE.MeshToonMaterial({
        color: standard.color,
        gradientMap: toonGradient()
      });
      if (standard.map) material.map = standard.map;
      material.side = standard.side;
      return material;
    };

    mesh.material = Array.isArray(mesh.material)
      ? mesh.material.map(convert)
      : convert(mesh.material);
  });
};
