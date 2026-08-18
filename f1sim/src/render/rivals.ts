/**
 * The rest of the grid, drawn.
 *
 * `race/field.ts` has run nine rivals along the racing line since the
 * field existed, and computed a position, a heading and a livery colour
 * for each of them every tick — but nothing ever read them. The race
 * was scored, the gap to the car ahead was displayed, and the track was
 * empty. This is the missing half: it turns those numbers into cars.
 *
 * They are drawn, not simulated. A rival has no suspension to follow
 * and no attitude to solve for, so its wheels are fixed to the body and
 * its body sits on the racing line — which is why nine of them cost
 * about as much as the one car that is simulated properly.
 *
 * Geometry is built once and shared. Only the material differs between
 * cars, because the whole point of the colour is that you can tell them
 * apart at the far end of a straight: flat paint, black line round it,
 * no highlights to confuse it with the car beside it.
 */
import * as THREE from 'three';

import type { Rival } from '../race/field';
import type { VehicleParams } from '../sim/vehicle';
import { buildCarGeometry, buildWheelGeometry, wheelMounts } from './carbody';
import { outlineMaterial, outlineMesh, toonMaterial } from './toon';

interface RivalCar {
  readonly group: THREE.Group;
  readonly wheels: THREE.Object3D[];
  /** Accumulated wheel rotation, so the tyres turn at speed. */
  spin: number;
}

export class RivalRenderer {
  private readonly cars: RivalCar[] = [];
  private readonly outline = outlineMaterial();

  /** Height of the body origin above the road, from the suspension. */
  private readonly rideHeight: number;

  constructor(scene: THREE.Scene, rivals: readonly Rival[], params: VehicleParams) {
    const { chassis, suspension } = params;
    const wheelCentreY = chassis.hardpointY - suspension.restLength;
    this.rideHeight = chassis.wheelRadius - wheelCentreY;

    /* The same drawn car the player gets. A grid where the rivals are
       a cruder model than the one you are driving reads as two games in
       one picture, and it is the rivals you spend the race looking at. */
    const car = buildCarGeometry(chassis, wheelCentreY);
    const wheelGeo = buildWheelGeometry(chassis);
    const mounts = wheelMounts(chassis, wheelCentreY);

    const darkMat = toonMaterial(0x16191d);
    /* Light enough that its own black outline shows — see the note on
       the player's tyres in `scene.ts`. */
    const wheelMat = toonMaterial(0x33393f);

    for (const rival of rivals) {
      const group = new THREE.Group();

      const liveryMat = toonMaterial(rival.colour, { emissive: 0.16 });
      /* Wings a shade off the body rather than a second colour: it is
         the one livery every car can be given without inventing nine
         palettes, and it keeps a car identifiable when only its wing is
         showing round a corner. */
      const accentMat = toonMaterial(
        new THREE.Color(rival.colour).multiplyScalar(0.62),
        { emissive: 0.1 }
      );

      for (const [geometry, material] of [
        [car.livery, liveryMat],
        [car.accent, accentMat],
        [car.dark, darkMat]
      ] as const) {
        const mesh = new THREE.Mesh(geometry, material);
        mesh.castShadow = true;
        mesh.add(outlineMesh(geometry, this.outline));
        group.add(mesh);
      }

      const wheels: THREE.Object3D[] = [];
      for (const [x, y, z] of mounts) {
        const wheel = new THREE.Mesh(wheelGeo, wheelMat);
        wheel.position.set(x, y, z);
        wheel.castShadow = true;
        wheel.add(outlineMesh(wheelGeo, this.outline));
        group.add(wheel);
        wheels.push(wheel);
      }

      // Off the map until the first update, so a car never appears at
      // the world origin for one frame on the way to the grid.
      group.visible = false;
      scene.add(group);
      this.cars.push({ group, wheels, spin: 0 });
    }
  }

  /**
   * Put the cars where the field says they are.
   *
   * The rival's position is the point on the racing line, which is on
   * the road — so the body has to be lifted onto its own tyres. Its
   * heading is a yaw: banking is ignored, because a rival that is not
   * solving for grip has no business leaning into a corner.
   */
  update(rivals: readonly Rival[], dt: number, wheelRadius: number): void {
    for (let i = 0; i < this.cars.length; i++) {
      const car = this.cars[i];
      const rival = rivals[i];
      if (!car || !rival) continue;

      car.group.visible = true;
      car.group.position.set(
        rival.position.x,
        rival.position.y + this.rideHeight,
        rival.position.z
      );

      /* Negated, and it has to be.
       *
       * The field reports a bearing: the angle whose direction of
       * travel is `(sin h, 0, -cos h)`, which is the natural reading of
       * `atan2(dx, -dz)`. A yaw of `h` about +Y sends the model's
       * forward — which is -Z — to `(-sin h, 0, -cos h)` instead. The
       * two agree on the z component and disagree on x, so the car is
       * mirrored across the axis of the circuit rather than turned:
       * dead right on a straight running due north, ninety degrees out
       * at forty-five, and reversed on a straight running east. Which
       * is exactly what it looked like — a grid driving sideways. */
      car.group.rotation.y = -rival.heading;

      /* Wheels that do not turn make a car look like it is being
         dragged. The rate is the rolling one — a rival never locks a
         brake, so there is nothing else for them to be doing. */
      car.spin += (rival.speed / wheelRadius) * dt;
      for (const wheel of car.wheels) wheel.rotation.x = car.spin;
    }
  }

  /** Line weight is in pixels, so it has to be told about the viewport. */
  setScreenHeight(height: number): void {
    this.outline.uniforms.screenHeight!.value = height;
  }
}
