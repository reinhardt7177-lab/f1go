/**
 * Load the car model, and take it apart so it can be used.
 *
 * A GLB arrives as a scene graph the exporter happened to produce: an
 * arbitrary transform, an arbitrary scale, an arbitrary idea of which
 * way is forward. Dropping that into a simulation that has opinions
 * about all three gives a car that is the wrong size, facing the wrong
 * way, and floating.
 *
 * So the file is normalised on load — centred on its wheelbase, sat on
 * the ground, scaled to a real Formula 1 car and turned to face -Z —
 * and only then handed over. Nothing downstream needs to know what the
 * exporter did.
 *
 * Everything here is optional. The blocked-out car is a complete
 * fallback, so a missing or broken model costs a console line rather
 * than a session.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/** Wheelbase-to-nose length of a current car, metres. */
const TARGET_LENGTH = 5.6;

export interface LoadedCar {
  /** Ready to add to a group that is positioned by the simulation. */
  readonly object: THREE.Object3D;
  readonly triangles: number;
  readonly size: THREE.Vector3;
}

/**
 * Which end is the nose?
 *
 * Nothing in the file says, and getting it wrong is not subtle but is
 * easy to misread — driving along looking at your own rear wing reads
 * convincingly as sitting inside the car. A racing car's tallest
 * structure is its airbox and rear wing, so the mean height of the top
 * of the model points at the back of it.
 */
const rearIsTowardPositiveZ = (root: THREE.Object3D): boolean => {
  const v = new THREE.Vector3();
  const ys: number[] = [];
  const zs: number[] = [];
  let maxY = -Infinity;
  let minY = Infinity;

  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry?.attributes.position) return;
    const pos = mesh.geometry.attributes.position;
    for (let i = 0; i < pos.count; i += 7) {
      v.fromBufferAttribute(pos as THREE.BufferAttribute, i).applyMatrix4(mesh.matrixWorld);
      ys.push(v.y);
      zs.push(v.z);
      maxY = Math.max(maxY, v.y);
      minY = Math.min(minY, v.y);
    }
  });
  if (!ys.length) return true;

  const threshold = minY + (maxY - minY) * 0.8;
  let sum = 0;
  let n = 0;
  for (let i = 0; i < ys.length; i++) {
    if (ys[i]! >= threshold) { sum += zs[i]!; n++; }
  }
  return n === 0 || sum / n >= 0;
};

export const loadCarModel = async (url: string): Promise<LoadedCar> => {
  const gltf = await new GLTFLoader().loadAsync(url);
  const root = gltf.scene;
  root.updateMatrixWorld(true);

  const box = new THREE.Box3().setFromObject(root);
  const size = new THREE.Vector3();
  const centre = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(centre);

  /* The longest horizontal axis is the length; if that is X the model
     lies across the direction of travel and has to be turned. */
  let yaw = size.x > size.z ? Math.PI / 2 : 0;
  const length = Math.max(size.x, size.z);
  const scale = TARGET_LENGTH / (length || 1);

  const holder = new THREE.Group();
  holder.add(root);
  /* Order matters and reads backwards: the last transform set is the
     first applied, so the model is centred, then scaled, then turned. */
  root.position.set(-centre.x, -box.min.y, -centre.z);
  holder.scale.setScalar(scale);

  const turned = new THREE.Group();
  turned.add(holder);
  if (!rearIsTowardPositiveZ(root)) yaw += Math.PI;
  turned.rotation.y = yaw;

  let triangles = 0;
  turned.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    mesh.castShadow = true;
    mesh.receiveShadow = false;
    /* Generated models often arrive fully rough or fully metal, which
       makes bodywork read as either chalk or chrome. A car is neither:
       clear-coated paint is smooth and barely metallic, and what sells
       it is what it reflects. */
    const mat = mesh.material as THREE.MeshStandardMaterial | THREE.MeshStandardMaterial[];
    for (const m of Array.isArray(mat) ? mat : [mat]) {
      if (!m || !('roughness' in m)) continue;
      m.roughness = Math.min(m.roughness ?? 1, 0.45);
      m.metalness = 0.1;
      m.envMapIntensity = 1.1;
      if (m.map) m.map.colorSpace = THREE.SRGBColorSpace;
    }
    const g = mesh.geometry;
    triangles += g.index ? g.index.count / 3 : (g.attributes.position?.count ?? 0) / 3;
  });

  const finalBox = new THREE.Box3().setFromObject(turned);
  const finalSize = new THREE.Vector3();
  finalBox.getSize(finalSize);

  return { object: turned, triangles, size: finalSize };
};
