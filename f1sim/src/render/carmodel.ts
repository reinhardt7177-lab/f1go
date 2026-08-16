/**
 * Load the car model, and take it apart so it can be used.
 *
 * A GLB arrives as a scene graph the exporter happened to produce: an
 * arbitrary transform, an arbitrary scale, an arbitrary idea of which
 * way is forward. Dropping that into a simulation that has opinions
 * about all three gives a car that is the wrong size, facing the wrong
 * way, and floating.
 *
 * It also arrives with its wheels welded on, which is the harder
 * problem. The simulation already draws four wheels, at the positions
 * its suspension puts them, spinning at the speed its tyre model says
 * they spin. Keeping the model's wheels too means two sets of tyres at
 * each corner, the moulded pair sitting still while the real pair turns
 * inside them. So the moulded ones are cut out of the mesh on load and
 * the simulation's wheels are left to do their job.
 *
 * Everything here is measured off the model rather than configured.
 * A generated mesh is not a spec — the next one will have a different
 * scale and a different idea of forward — so the file is interrogated
 * for its wheelbase, its axle line and its tyre radius, and fitted to
 * the car the simulation is actually driving.
 *
 * All of it is optional. The blocked-out car is a complete fallback, so
 * a missing or broken model costs a console line rather than a session.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/** Where the simulation's car is, in the space the model has to join. */
export interface CarFit {
  /** Distance between axle centres (m). */
  wheelbase: number;
  /** Midpoint of the two axles, along Z, relative to the body origin. */
  axleMidZ: number;
  /** Height of the wheel centres relative to the body origin. */
  wheelCentreY: number;
  /** Rolling radius of the tyres (m), which sets where the road is. */
  wheelRadius: number;
}

export interface LoadedCar {
  /** Ready to add to a group that is positioned by the simulation. */
  readonly object: THREE.Object3D;
  readonly triangles: number;
  /** Triangles cut away with the moulded wheels. */
  readonly wheelTriangles: number;
  readonly size: THREE.Vector3;
}

interface Measurement {
  /** 'x' or 'z' — whichever the car is longest along. */
  long: 'x' | 'z';
  /** True when the rear of the car faces the positive end of `long`. */
  rearIsPositive: boolean;
  /** Axle centres along `long`, in model units, front then rear. */
  frontAxle: number;
  rearAxle: number;
  /** Wheel centre height and tyre radius, in model units. */
  wheelCentreY: number;
  wheelRadius: number;
  /** Centre of the model across its width. */
  lateralCentre: number;
}

/** Every vertex of the model, in the model's own space. */
const vertices = (root: THREE.Object3D): THREE.Vector3[] => {
  const out: THREE.Vector3[] = [];
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry?.attributes.position) return;
    const pos = mesh.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      out.push(new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld));
    }
  });
  return out;
};

/**
 * Work out how the model is laid out.
 *
 * The wheels are the key to all of it. They are the widest thing on a
 * single-seater and they come in two clusters, so the outermost
 * vertices — the tyre sidewalls — fall into a group at each axle with a
 * long empty gap between them. That gives the wheelbase, the axle line,
 * the tyre radius and the ride height in one pass, without trusting the
 * bounding box, which the wings would otherwise dominate.
 *
 * Which end is the back is a separate question, and one that is easy to
 * get wrong in a way that is not obvious: a car facing backwards still
 * looks like a car. A single-seater's tallest structures are its airbox
 * and rear wing, so the mean position of the top of the model points at
 * the back of it — measured along the length, which is the part an
 * earlier version of this got wrong by always measuring along Z.
 */
const measure = (root: THREE.Object3D): Measurement | null => {
  const pts = vertices(root);
  if (pts.length < 64) return null;

  const box = new THREE.Box3().setFromPoints(pts);
  const size = new THREE.Vector3();
  box.getSize(size);
  const long: 'x' | 'z' = size.x >= size.z ? 'x' : 'z';
  const lat: 'x' | 'z' = long === 'x' ? 'z' : 'x';

  const lengthOf = (p: THREE.Vector3) => (long === 'x' ? p.x : p.z);
  const lateralOf = (p: THREE.Vector3) => (lat === 'x' ? p.x : p.z);

  const lateralCentre = (box.min[lat] + box.max[lat]) / 2;
  const halfWidth = Math.max(
    ...pts.map((p) => Math.abs(lateralOf(p) - lateralCentre))
  );

  /* The sidewalls only. A lower threshold picks up the front wing
     endplates, which are nearly as wide as the tyres and would drag the
     front axle forward onto the nose. */
  const outboard = pts.filter(
    (p) => Math.abs(lateralOf(p) - lateralCentre) > halfWidth * 0.78
  );
  if (outboard.length < 32) return null;

  /* Split the sidewall vertices into two clusters either side of their
     own midpoint. The gap between the axles is most of the car, so any
     split inside it separates them cleanly. */
  const ls = outboard.map(lengthOf);
  const mid = (Math.min(...ls) + Math.max(...ls)) / 2;
  const lower = outboard.filter((p) => lengthOf(p) < mid);
  const upper = outboard.filter((p) => lengthOf(p) >= mid);
  if (!lower.length || !upper.length) return null;

  const mean = (g: THREE.Vector3[]) => g.reduce((s, p) => s + lengthOf(p), 0) / g.length;
  const lowerAxle = mean(lower);
  const upperAxle = mean(upper);

  const ys = outboard.map((p) => p.y);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  /* Tall structures live at the back. */
  const topThreshold = box.min.y + size.y * 0.8;
  const tall = pts.filter((p) => p.y >= topThreshold);
  const tallMean = tall.length ? tall.reduce((s, p) => s + lengthOf(p), 0) / tall.length : 0;
  const modelCentre = (box.min[long] + box.max[long]) / 2;
  const rearIsPositive = tallMean >= modelCentre;

  return {
    long,
    rearIsPositive,
    frontAxle: rearIsPositive ? lowerAxle : upperAxle,
    rearAxle: rearIsPositive ? upperAxle : lowerAxle,
    wheelCentreY: (minY + maxY) / 2,
    wheelRadius: (maxY - minY) / 2,
    lateralCentre
  };
};

/**
 * Cut the moulded wheels out of the mesh.
 *
 * A triangle belongs to a wheel if its centroid is inside the tyre —
 * within a radius of the axle centre in the plane the wheel turns in —
 * and outboard enough to be the wheel rather than the chassis beside
 * it. Keeping the inboard limit generous leaves the suspension arms
 * and brake ducts attached, which is what makes the gap read as a
 * wheel arch rather than a hole.
 *
 * Nothing is deleted: the vertices stay and the index is rebuilt
 * without the wheel triangles. Rebuilding the index is enough to stop
 * them being drawn, and it avoids rewriting every other attribute.
 */
const stripWheels = (root: THREE.Object3D, m: Measurement): number => {
  /* Cut a little wide of the tyre so the sidewall bulge goes with it,
     but not so wide that the floor and diffuser follow. */
  const cut = m.wheelRadius * 1.12;
  const inboard = Math.max(...vertices(root).map((p) =>
    Math.abs((m.long === 'x' ? p.z : p.x) - m.lateralCentre)
  )) * 0.58;

  let removed = 0;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();

  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry?.attributes.position) return;
    const g = mesh.geometry;
    const pos = g.attributes.position as THREE.BufferAttribute;
    const index = g.index;
    const count = index ? index.count : pos.count;
    const keep: number[] = [];

    for (let t = 0; t + 2 < count; t += 3) {
      const i0 = index ? index.getX(t) : t;
      const i1 = index ? index.getX(t + 1) : t + 1;
      const i2 = index ? index.getX(t + 2) : t + 2;

      a.fromBufferAttribute(pos, i0).applyMatrix4(mesh.matrixWorld);
      b.fromBufferAttribute(pos, i1).applyMatrix4(mesh.matrixWorld);
      c.fromBufferAttribute(pos, i2).applyMatrix4(mesh.matrixWorld);

      const cl = ((m.long === 'x' ? a.x + b.x + c.x : a.z + b.z + c.z)) / 3;
      const cy = (a.y + b.y + c.y) / 3;
      const clat = ((m.long === 'x' ? a.z + b.z + c.z : a.x + b.x + c.x)) / 3;

      const outboard = Math.abs(clat - m.lateralCentre) > inboard;
      const dy = cy - m.wheelCentreY;
      const nearFront = Math.hypot(cl - m.frontAxle, dy) < cut;
      const nearRear = Math.hypot(cl - m.rearAxle, dy) < cut;

      if (outboard && (nearFront || nearRear)) {
        removed++;
        continue;
      }
      keep.push(i0, i1, i2);
    }

    g.setIndex(keep);
    g.computeBoundingSphere();
  });

  return removed;
};

export const loadCarModel = async (url: string, fit: CarFit): Promise<LoadedCar> => {
  const gltf = await new GLTFLoader().loadAsync(url);
  const root = gltf.scene;
  root.updateMatrixWorld(true);

  const m = measure(root);
  if (!m) throw new Error('car model has no usable geometry');

  const wheelTriangles = stripWheels(root, m);

  const modelWheelbase = m.rearAxle - m.frontAxle;
  if (Math.abs(modelWheelbase) < 1e-4) throw new Error('car model has no wheelbase');
  const scale = fit.wheelbase / Math.abs(modelWheelbase);
  const axleMid = (m.frontAxle + m.rearAxle) / 2;

  /* Move the model so the point the simulation cares about — the middle
     of the axle line, at wheel-centre height — is at the origin. Then
     everything after this is about that point rather than about
     whatever the exporter chose. */
  const holder = new THREE.Group();
  holder.add(root);
  if (m.long === 'x') root.position.set(-axleMid, -m.wheelCentreY, -m.lateralCentre);
  else root.position.set(-m.lateralCentre, -m.wheelCentreY, -axleMid);
  holder.scale.setScalar(scale);

  /* Turn it to face -Z, which is forward here, by putting the rear at
     +Z. A yaw of -90° sends the model's +X to +Z; +90° sends -X there. */
  const turned = new THREE.Group();
  turned.add(holder);
  if (m.long === 'x') turned.rotation.y = m.rearIsPositive ? -Math.PI / 2 : Math.PI / 2;
  else turned.rotation.y = m.rearIsPositive ? 0 : Math.PI;

  /* And finally onto the car: the axle line where the suspension puts
     it, at the height the wheels actually turn at. Getting this wrong
     is what buries the car in the road or floats it above it. */
  const fitted = new THREE.Group();
  fitted.add(turned);
  fitted.position.set(0, fit.wheelCentreY, fit.axleMidZ);

  /* Then lift it clear of the road if it needs it.
   *
   * Fitting to the axle line is right, but it trusts the model to be a
   * car that sits on its own tyres. A generated mesh is under no such
   * obligation, and this one hangs part of its floor below its contact
   * patch — which, once the wheels are aligned, is bodywork buried in
   * the tarmac. Raising the whole car by the overlap costs a couple of
   * centimetres of wheel alignment against wheels 720mm tall, and buys
   * a car that sits on the road instead of in it. */
  const ground = fit.wheelCentreY - fit.wheelRadius;
  const clearance = 0.01;
  fitted.updateMatrixWorld(true);
  const lowest = new THREE.Box3().setFromObject(fitted).min.y;
  if (lowest < ground + clearance) fitted.position.y += ground + clearance - lowest;

  let triangles = 0;
  fitted.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    mesh.castShadow = true;
    mesh.receiveShadow = false;
    /* Generated models often arrive fully rough or fully metal, which
       makes bodywork read as either chalk or chrome. A car is neither:
       clear-coated paint is smooth and barely metallic, and what sells
       it is what it reflects. */
    const mat = mesh.material as THREE.MeshStandardMaterial | THREE.MeshStandardMaterial[];
    for (const mm of Array.isArray(mat) ? mat : [mat]) {
      if (!mm || !('roughness' in mm)) continue;
      mm.roughness = Math.min(mm.roughness ?? 1, 0.45);
      mm.metalness = 0.1;
      mm.envMapIntensity = 1.1;
      if (mm.map) mm.map.colorSpace = THREE.SRGBColorSpace;
    }
    const g = mesh.geometry;
    triangles += g.index ? g.index.count / 3 : (g.attributes.position?.count ?? 0) / 3;
  });

  const finalSize = new THREE.Vector3();
  new THREE.Box3().setFromObject(fitted).getSize(finalSize);

  return { object: fitted, triangles, wheelTriangles, size: finalSize };
};
