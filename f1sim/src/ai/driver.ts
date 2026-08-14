/**
 * The AI driver.
 *
 * Reads where the car is, looks up where the racing line says it should
 * be and how fast the profile says it should be going, and produces a
 * `ControlState` — the same struct the keyboard produces. Nothing
 * downstream can tell the difference, which is the point of having kept
 * that boundary narrow since stage one.
 *
 * Steering is pure pursuit: aim at a point on the racing line some
 * distance ahead and turn towards it. The lookahead grows with speed,
 * because at 300 km/h a fixed one would have the car reacting to
 * something it is already on top of, and shrinking it in slow corners
 * is what lets the car actually turn in.
 */
import { DEG, clamp, quatRotateInverse, v3sub, vec3 } from '../core/math';
import type { Vec3 } from '../core/math';
import { initialAssistState, tractionControl } from '../sim/assists';
import type { AssistState } from '../sim/assists';
import { RL, RR, neutralControls } from '../sim/types';
import type { ControlState, VehicleState } from '../sim/types';
import type { VehicleParams } from '../sim/vehicle';
import type { Quat } from '../core/math';
import type { RacingLine } from './racingline';
import type { SpeedProfile } from './speedprofile';

export interface DriverOptions {
  /** Lookahead at a standstill, and how much it grows per m/s. */
  lookaheadBase: number;
  lookaheadPerSpeed: number;
  lookaheadMax: number;
  /** Trim on the geometric steering angle; 1 is pure pursuit exactly. */
  steerGain: number;
  /** How hard the car is pulled back onto the line, per metre of error. */
  lineCorrection: number;
  /** Seconds for the steering to reach a new position. */
  steerRate: number;
  /**
   * Fraction of the profile speed actually attempted.
   *
   * Below one because the profile is what the car can do with a perfect
   * driver, and this one is not perfect: every metre of line error and
   * every degree of steering lag spends grip the profile assumed was
   * available for cornering.
   */
  pace: number;
  /** Seconds stuck off the road before asking to be recovered. */
  recoveryDelay: number;
  /** Upshift when road speed exceeds this, times the gear. */
  shiftSpeedPerGear: number;
}

export const defaultDriverOptions = (): DriverOptions => ({
  lookaheadBase: 6,
  lookaheadPerSpeed: 0.3,
  lookaheadMax: 30,
  steerGain: 1,
  lineCorrection: 0.5,
  steerRate: 0.06,
  pace: 0.75,
  recoveryDelay: 2.5,
  shiftSpeedPerGear: 42
});

export interface DriverDebug {
  /** Where on the circuit the driver thinks it is. */
  distance: number;
  /** Lateral error from the racing line (m). */
  lineError: number;
  /** Speed the profile is asking for (m/s). */
  targetSpeed: number;
  /** Angle to the aim point (deg). */
  aimAngle: number;
  lookahead: number;
}

export class Driver {
  readonly controls: ControlState = neutralControls();
  readonly options: DriverOptions;

  private assist: AssistState = initialAssistState();
  private shiftArmed = true;
  private steer = 0;
  private stuckFor = 0;

  /**
   * Raised when the car has been stationary off the road long enough
   * that it is not coming back. The caller decides what to do — the
   * driver has no business moving the car itself.
   */
  needsRecovery = false;

  debug: DriverDebug = {
    distance: 0,
    lineError: 0,
    targetSpeed: 0,
    aimAngle: 0,
    lookahead: 0
  };

  constructor(
    private readonly line: RacingLine,
    private readonly profile: SpeedProfile,
    private readonly params: VehicleParams,
    options: Partial<DriverOptions> = {}
  ) {
    this.options = { ...defaultDriverOptions(), ...options };
  }

  /** Forget accumulated state, as after a respawn. */
  reset(): void {
    this.assist = initialAssistState();
    this.steer = 0;
    this.shiftArmed = true;
    this.stuckFor = 0;
    this.needsRecovery = false;
  }

  /**
   * @param distance where the car is along the circuit (m)
   * @param lateral  its offset from the centreline (m)
   */
  drive(
    state: VehicleState,
    position: Vec3,
    rotation: Quat,
    distance: number,
    lateral: number,
    gear: number,
    dt: number,
    onTrack = true
  ): ControlState {
    const o = this.options;
    const speed = Math.abs(state.speed);

    // Ask to be recovered whenever the car has been stationary for a
    // while, on the road or off it. Off the road it has usually fallen
    // past the end of the track mesh and has no route back; on the road
    // it has spun and is sitting the wrong way round, which the
    // controller cannot resolve either since it only ever steers towards
    // a point ahead. Both look identical from here — the car is not
    // moving and nothing it does is changing that.
    if (speed < 2) this.stuckFor += dt;
    else this.stuckFor = 0;
    // Off the road there is nothing to wait for; on it, give the car a
    // moment in case it is simply coming out of a slow corner.
    this.needsRecovery = this.stuckFor > (onTrack ? o.recoveryDelay : o.recoveryDelay * 0.6);

    // --- where to aim ------------------------------------------------
    const lookahead = Math.min(
      o.lookaheadMax,
      o.lookaheadBase + speed * o.lookaheadPerSpeed
    );
    const aim = this.line.pointAt(distance + lookahead);
    const local = quatRotateInverse(rotation, v3sub(aim, position));
    const aimAngle = Math.atan2(local.x, -local.z);

    // Pure pursuit proper: the steering angle that puts the car on a
    // circular arc through the aim point,
    //
    //     delta = atan(2 L sin(alpha) / Ld)
    //
    // rather than a flat gain on the angle. The lookahead is in the
    // denominator, so the same geometric error asks for less lock the
    // faster the car is going. A flat gain has no such term and
    // oscillates down the straights — which is exactly what a first
    // pass here did at 300 km/h.
    const chassis = this.params.chassis;
    const geometric = Math.atan2(
      2 * chassis.wheelbase * Math.sin(aimAngle),
      Math.max(1, lookahead)
    );

    // The steering rack loses lock with speed, so the same input means a
    // smaller angle the faster you go; undo that to command an angle.
    const lockScale =
      1 - (1 - chassis.steerSpeedFactor) * clamp((speed * 3.6) / 300, 0, 1);
    const authority = Math.max(1e-3, chassis.maxSteerAngle * lockScale);

    // Aiming ahead converges on the line but can settle parallel to it,
    // so the remaining offset is trimmed out directly.
    const lineError = lateral - this.line.offsetAt(distance);
    const correction = clamp((-lineError * o.lineCorrection) / authority, -0.3, 0.3);

    // Feedforward from the curvature of the line itself. Pure pursuit is
    // a feedback term — it only acts once the car is already off the arc,
    // so alone it enters every corner late and runs wide. The steady
    // steering angle a curvature k needs is atan(L k); supplying that up
    // front leaves the pursuit term to correct the difference rather than
    // to discover the corner.
    const feedforward =
      Math.atan(chassis.wheelbase * this.line.curvatureAt(distance + lookahead * 0.5)) /
      authority;

    const wanted = clamp(
      feedforward + (geometric * o.steerGain) / authority + correction,
      -1,
      1
    );
    this.steer += (wanted - this.steer) * clamp(dt / o.steerRate, 0, 1);

    // --- how fast ----------------------------------------------------
    // Braking has to start before the corner, so the target is the
    // slowest point within stopping distance rather than the one here.
    const stoppingDistance = 12 + (speed * speed) / (2 * 22);
    const target = this.profile.lookahead(distance, stoppingDistance) * o.pace;

    let throttle = 0;
    let brake = 0;
    if (speed < target * 0.98) {
      throttle = clamp((target - speed) * 0.4, 0.15, 1);
    } else if (speed > target * 1.02) {
      brake = clamp((speed - target) * 0.25, 0.15, 1);
    } else {
      throttle = 0.35;
    }

    // --- gears -------------------------------------------------------
    // Shift on road speed, not engine speed: during wheelspin the engine
    // sits on the limiter while the car is barely moving, and an
    // rpm-triggered shift would run through the whole gearbox at once.
    const wantShift = speed * 3.6 > gear * o.shiftSpeedPerGear;
    const shiftUp = wantShift && this.shiftArmed;
    this.shiftArmed = !wantShift;

    const drivenSlip = Math.max(
      Math.abs(state.wheels[RL]!.slipRatio),
      Math.abs(state.wheels[RR]!.slipRatio)
    );

    // Traction control is what stops the car spinning its wheels off the
    // line, but its throttle ceiling decays on a low-grip surface — so a
    // car that has stopped in the grass can never restart, because every
    // attempt spins the wheels and cuts the throttle further. Below
    // walking pace it is bypassed and the ceiling reset.
    const c = this.controls;
    if (speed < 3) {
      this.assist.throttleLimit = 1;
      c.throttle = throttle;
    } else {
      c.throttle = tractionControl(throttle, drivenSlip, this.assist, dt);
    }
    c.brake = brake;
    c.steer = this.steer;
    c.shiftUp = shiftUp;
    c.shiftDown = false;

    // Active aero is a judgement about the road ahead, not a reward for
    // being close behind: recline the wings when there is no corner
    // inside the distance it would take to react to one.
    let straightAhead = true;
    for (let d = 0; d < 30 + speed * 2.5; d += 10) {
      if (Math.abs(this.line.curvatureAt(distance + d)) > 1 / 400) {
        straightAhead = false;
        break;
      }
    }
    c.straightMode = straightAhead && speed > 30;
    c.overtake = false;

    this.debug = {
      distance,
      lineError,
      targetSpeed: target,
      aimAngle: aimAngle * DEG,
      lookahead
    };

    return c;
  }
}

/** Convenience for callers that only have a `SimWorld`. */
export const driveWorld = (
  driver: Driver,
  world: {
    car: { getState: () => VehicleState; body: { translation: () => Vec3; rotation: () => Quat } };
    distance: number;
    lateral: number;
    onTrack: boolean;
  },
  dt: number
): ControlState => {
  const state = world.car.getState();
  const p = world.car.body.translation();
  return driver.drive(
    state,
    vec3(p.x, p.y, p.z),
    world.car.body.rotation(),
    world.distance,
    world.lateral,
    state.gear,
    dt,
    world.onTrack
  );
};
