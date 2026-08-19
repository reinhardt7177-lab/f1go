/**
 * Driver aids.
 *
 * These sit *between* the input source and the vehicle: they read
 * telemetry and shape the controls, but never touch the physics. That
 * keeps the vehicle model honest and lets the same code serve the
 * player, the test bench and — later — the AI driver, which needs
 * exactly this to get off the line.
 *
 * Worth being clear about why one is needed at all. First gear puts
 * roughly 26 kN of thrust through rear tyres that can carry about 7.5 kN
 * at a standstill. Full throttle from rest therefore spins the wheels,
 * and spinning wheels have almost no lateral grip left, so the car turns
 * around. That is not a bug — it is what the model should do, and it is
 * why a real driver feeds the throttle in rather than mashing it.
 */
import { clamp, quatRotateInverse } from '../core/math';
import { FL, FR, RL, RR } from './types';
import type { ControlState, VehicleState } from './types';

export interface AssistState {
  /** Current throttle ceiling, 0..1. */
  throttleLimit: number;
  /** Current ceiling on |steer|, 0..1. */
  steerLimit: number;
}

export const initialAssistState = (): AssistState => ({
  throttleLimit: 1,
  steerLimit: 1
});

export interface TractionControlParams {
  /** Slip ratio the controller aims to hold on the driven wheels. */
  targetSlip: number;
  /** How fast the ceiling drops once slip is exceeded (per second). */
  cutRate: number;
  /** How fast it is handed back (per second). */
  restoreRate: number;
  /** Never cut below this, or the car cannot move at all. */
  floor: number;
}

export const defaultTractionControl = (): TractionControlParams => ({
  targetSlip: 0.14,
  cutRate: 6,
  restoreRate: 1.5,
  floor: 0.08
});

/**
 * Limit throttle to keep the driven wheels near their peak-grip slip.
 *
 * @param desired    throttle the driver asked for, 0..1
 * @param drivenSlip largest absolute slip ratio across the driven wheels
 * @returns the throttle to actually apply
 */
export const tractionControl = (
  desired: number,
  drivenSlip: number,
  state: AssistState,
  dt: number,
  p: TractionControlParams = defaultTractionControl()
): number => {
  if (drivenSlip > p.targetSlip) {
    state.throttleLimit -= dt * p.cutRate * clamp(drivenSlip / p.targetSlip - 1, 0, 3);
  } else {
    state.throttleLimit += dt * p.restoreRate;
  }
  state.throttleLimit = clamp(state.throttleLimit, p.floor, 1);
  return Math.min(desired, state.throttleLimit);
};

/* ------------------------------------------------------------------ *
 * Easy mode
 *
 * Traction control above answers one question — how much throttle the
 * rear tyres can take. The three below answer the rest of why this car
 * is hard to drive, and they exist because the audience is ten years
 * old, not because the model is wrong.
 *
 * All of them are the same shape as `tractionControl`: numbers in,
 * numbers out, one mutable state bag. Nothing here imports the vehicle
 * and nothing in `sim/` imports this file, so the simulator underneath
 * is reachable at any moment by not calling them.
 * ------------------------------------------------------------------ */

export interface SteerLimiterParams {
  /** Front slip angle the limiter holds, in radians. */
  targetSlip: number;
  /** How fast the steering ceiling drops past target (per second). */
  cutRate: number;
  /** How fast it is handed back (per second). */
  restoreRate: number;
  /** Never cut below this, or slow corners become impossible. */
  floor: number;
}

export const defaultSteerLimiter = (): SteerLimiterParams => ({
  /* `SLIP_ANGLE_AT_PEAK` is 0.125 rad, and the top of the curve is
     flat — at 0.14 the tyre still makes 99.8 per cent of peak. Holding
     just past the peak rather than exactly on it lets the driver feel
     the limit for two tenths of a per cent of grip. */
  targetSlip: 0.14,
  /* At twice target slip the ceiling falls in about a quarter of a
     second: fast enough to catch a corner-entry overshoot, slow enough
     that it does not snatch the wheel out of your hands. */
  cutRate: 4,
  /* Faster than traction control's 1.5, so the steering is not dead on
     the way out of a corner. */
  restoreRate: 2,
  /* A safety net, not a working limit. The worst case in normal driving
     is 300 km/h, where the grip-limited radius needs 1.4 degrees of
     lock against 7.9 available — a ratio of 0.18. Below that the
     limiter can never bind on a straight. */
  floor: 0.1
});

/**
 * Stop the driver asking the front axle for more slip than it can use.
 *
 * This is the single biggest reason the car is hard. At 100 km/h the
 * grip-limited corner radius is 39 m, which needs 5.3 degrees of steer;
 * the lock available at that speed is 14. At 200 km/h it is 2.1 against
 * 11.2. Full travel on the arrow key is therefore always a request the
 * front axle cannot fill — and past the peak the lateral curve slopes
 * *downwards*, so pushing harder gives less grip, the car stops
 * answering the wheel, and when the rear joins in the yaw runs away.
 *
 * The loop settles with the front axle at peak slip, which is to say at
 * maximum lateral force. The car does not turn less. It turns as hard
 * as it physically can, and stops being asked for more.
 *
 * @param desired    steer the driver asked for, -1..1
 * @param frontSlip  mean slip angle across the front axle (rad, signed)
 */
export const steerLimiter = (
  desired: number,
  frontSlip: number,
  state: AssistState,
  dt: number,
  p: SteerLimiterParams = defaultSteerLimiter(),
  sliding = false
): number => {
  /* The sign test is what makes this safe, and it is not obvious.
   *
   * Steering right makes the contact patch travel to the left of where
   * the wheel points, so understeer shows up as a front slip angle
   * opposite in sign to the steer command. Catching a slide is the
   * other way round: the car is already yawing, the body is travelling
   * across its own nose, and the countersteer applied has the same sign
   * as the slip.
   *
   * So cutting only on opposite signs separates "you asked for more
   * lock than the front can use" from "you are saving it", and the
   * limiter can never take away a correction. Delete this test and the
   * assist fights the driver at exactly the moment they need the wheel
   * most. */
  /* And the limiter stands down entirely once the car is sideways.
   *
   * A yawing car carries a large front slip angle whatever the steering
   * is doing, so without this the loop reads a save as understeer and
   * keeps cutting — it walked the ceiling down to its floor mid-slide
   * and left the driver with a tenth of the lock at the moment the yaw
   * assist was trying to use all of it. The two aids own different
   * problems: this one owns "more lock than the front can use in a
   * corner", the yaw assist owns "the car is already going sideways",
   * and they must not both act. */
  const understeering =
    !sliding &&
    desired !== 0 &&
    Math.abs(frontSlip) > p.targetSlip &&
    Math.sign(frontSlip) !== Math.sign(desired);

  if (understeering) {
    state.steerLimit -=
      dt * p.cutRate * clamp(Math.abs(frontSlip) / p.targetSlip - 1, 0, 3);
  } else {
    state.steerLimit += dt * p.restoreRate;
  }
  state.steerLimit = clamp(state.steerLimit, p.floor, 1);

  return clamp(desired, -state.steerLimit, state.steerLimit);
};

export interface YawAssistParams {
  /** Sideslip below which the assist does nothing at all (rad). */
  deadband: number;
  /** Sideslip at which it has its full authority (rad). */
  fullBand: number;
  /** Lock commanded per radian of slide. */
  counterGain: number;
  /** Lock removed per radian per second of yaw rate. */
  rateGain: number;
  /** The most of the command the assist may ever take, 0..1. */
  maxAuthority: number;
  /** Fraction of throttle removed at full authority. */
  throttleTrim: number;
  /** Below this road speed sideslip means nothing (m/s). */
  minSpeed: number;
}

export const defaultYawAssist = (): YawAssistParams => ({
  /* Seven degrees, and this number is what keeps the simulator intact.
     A car cornering at the limit runs three to six degrees of body
     sideslip, so below the deadband this assist contributes exactly
     zero — bit for bit, not approximately. Lower than it first was,
     because a slide caught at eight degrees was already unrecoverable:
     the yaw rate had doubled by the time the assist was allowed to
     look at it. */
  deadband: 0.12,
  /* Twenty degrees is a slide, not a cornering attitude. */
  fullBand: 0.35,
  /* 1 / (20 degrees) — one degree of slide asks for one degree of lock,
     which is literally what a driver does. Expressed this way rather
     than by importing `maxSteerAngle`, so this file still knows nothing
     about the chassis. */
  counterGain: 3.2,
  /* The lead term, and deliberately small: a legitimate 50 km/h corner
     runs about 1.2 rad/s of yaw, which this turns into 0.14 of lock — a
     nudge, not a fight. It commands countersteer as the slide starts
     and takes it away again as the slide is caught, which is what stops
     the correction becoming a tank-slapper. Reverse its sign and the
     assist oscillates. */
  rateGain: 0.12,
  /* Blend, never override — but only just. At twenty degrees of slide
     the lock the driver is holding is actively wrong, and leaving even
     a third of it in was enough to stop the save: with the player at
     full opposite lock the assist could only reach two thirds of the
     countersteer it wanted. A tenth of the wheel is enough to keep the
     car from feeling like it is driving itself. */
  maxAuthority: 0.9,
  /* Cut to 40 per cent at a full slide rather than to nothing: power-on
     oversteer feeds itself and a ten-year-old will not lift, but a car
     with no throttle at all cannot drive out of a spin either. */
  throttleTrim: 0.6,
  minSpeed: 6
});

export interface YawAssistResult {
  steer: number;
  throttle: number;
  /** How much authority the assist took this tick, 0..1. */
  authority: number;
}

/**
 * Catch the slide before it becomes a spin.
 *
 * The signal is body sideslip — the angle between where the car points
 * and where it is actually going. It needs no reference model and no
 * invented understeer gradient, and its target is exactly zero, which
 * is the whole reason to prefer it to a yaw-rate error.
 *
 * @param sideslip  radians, positive when the car travels to the right
 *                  of its own nose
 * @param yawRate   radians per second about the vertical axis
 * @param speed     road speed, m/s
 */
export const yawAssist = (
  desiredSteer: number,
  desiredThrottle: number,
  sideslip: number,
  yawRate: number,
  speed: number,
  p: YawAssistParams = defaultYawAssist()
): YawAssistResult => {
  const idle = { steer: desiredSteer, throttle: desiredThrottle, authority: 0 };
  if (Math.abs(speed) < p.minSpeed) return idle;

  const over = Math.abs(sideslip) - p.deadband;
  if (over <= 0) return idle;

  const authority = clamp(over / (p.fullBand - p.deadband), 0, 1) * p.maxAuthority;

  /* A tail out to the left means the car is yawing right and travelling
     to the left of its nose, so both terms come out negative and the
     assist steers left — into the slide, as it should. */
  const counter = clamp(p.counterGain * sideslip - p.rateGain * yawRate, -1, 1);

  return {
    steer: desiredSteer + authority * (counter - desiredSteer),
    throttle: desiredThrottle * (1 - p.throttleTrim * authority),
    authority
  };
};

/**
 * The moment a real stability program makes with the brakes.
 *
 * Steering and throttle turned out not to be enough on their own, and
 * the reason is worth writing down: countersteer can only produce as
 * much yaw moment as the front tyres have grip left, and a car already
 * sideways at seventy degrees has very little. Held at full opposite
 * lock with the throttle cut, the simulated car still rotated all the
 * way round — correctly, because that is what the physics says.
 *
 * A real car answers this by braking individual wheels, which makes a
 * yaw moment out of longitudinal force and needs no cornering grip at
 * all. There is no per-wheel brake channel here, so this asks for the
 * moment directly. It is a gameplay force and it says so — but it is
 * the same force an electronic stability program would make, for the
 * same reason, and it is gated on the same authority as everything
 * else, so it is exactly zero until the car is genuinely sliding.
 *
 * @returns newton-metres about the vertical axis, signed
 */
export const stabilityTorque = (
  sideslip: number,
  yawRate: number,
  speed: number,
  p: YawAssistParams = defaultYawAssist(),
  peak = 5200
): number => {
  if (Math.abs(speed) < p.minSpeed) return 0;
  const over = Math.abs(sideslip) - p.deadband;
  if (over <= 0) return 0;

  const authority = clamp(over / (p.fullBand - p.deadband), 0, 1);
  /* Opposing the yaw rate rather than the slide angle: it is angular
     momentum that has to go, and a damper is what removes it without
     ever pushing the car the other way. */
  return -clamp(yawRate / 2.5, -1, 1) * authority * peak;
};

/**
 * Reverse without knowing there is a gearbox.
 *
 * The car has a reverse gear and it works, but reaching it means
 * holding the downshift paddle through neutral at walking pace — a
 * thing a ten-year-old will never find and would not think to look for.
 * What they do is hold the back key and wait to go backwards, because
 * that is what every game they have played does.
 *
 * So the brake becomes both. Held while rolling forwards it is a brake;
 * held once the car has stopped it selects reverse and feeds in
 * throttle. Pressing forward again brakes the reversing car and then
 * puts it back into first. Nothing about the gearbox changes — this
 * presses the same paddles a driver would, just without being asked.
 *
 * @param gear    the gear currently engaged; 0 is reverse
 * @param speed   forward speed, negative when travelling backwards
 */
export const arcadeReverse = (
  desired: ControlState,
  gear: number,
  speed: number,
  p: ReverseParams = defaultReverse()
): ControlState => {
  const reversing = gear === 0;
  const stopped = Math.abs(speed) < p.selectBelow;

  if (reversing) {
    /* Backwards, and the back key is now the accelerator. The forward
       key is the brake, and once it has stopped the car it shifts up
       out of reverse — one press to stop, and the same press to set off
       again. */
    if (desired.throttle > 0) {
      return stopped
        ? { ...desired, throttle: 0, brake: 0, shiftUp: true }
        : { ...desired, throttle: 0, brake: desired.throttle };
    }
    return { ...desired, throttle: desired.brake, brake: 0 };
  }

  /* Forwards. The brake is a brake until the car is stopped and the key
     is still held, at which point it asks for reverse. */
  if (desired.brake > 0 && stopped && desired.throttle === 0) {
    return { ...desired, brake: 0, throttle: 0, shiftDown: true };
  }
  return desired;
};

export interface ReverseParams {
  /** Road speed below which the car counts as stopped (m/s). */
  selectBelow: number;
}

/* Two metres a second, matching the gearbox's own rule for when reverse
   may be selected at all — asking for it above that would be a request
   the drivetrain refuses, and the car would simply sit there. */
export const defaultReverse = (): ReverseParams => ({ selectBelow: 1.8 });

export interface EasyModeParams {
  traction: TractionControlParams;
  steering: SteerLimiterParams;
  yaw: YawAssistParams;
  reverse: ReverseParams;
  /** Below this road speed every loop is bypassed and reset (m/s). */
  bypassSpeed: number;
}

export const defaultEasyMode = (): EasyModeParams => ({
  traction: defaultTractionControl(),
  steering: defaultSteerLimiter(),
  yaw: defaultYawAssist(),
  reverse: defaultReverse(),
  bypassSpeed: 3
});

/**
 * The angle between where the car points and where it is going.
 *
 * Positive when the car is travelling to the right of its own nose.
 * Forward is -Z, hence the sign on the z term.
 */
export const sideslipOf = (state: VehicleState): number => {
  const local = quatRotateInverse(state.rotation, state.velocity);
  return Math.atan2(local.x, -local.z);
};

/**
 * Every easy-mode aid, in the order they have to run.
 *
 * Traction control first, because a spinning rear tyre is what creates
 * the slide the other two then have to deal with; the steering limiter
 * next, on the raw command; the yaw assist last, so it has the final
 * say on both steer and throttle when the car is genuinely sideways.
 *
 * The low-speed bypass at the top is not a nicety — it is a bug fix.
 * `ai/driver.ts` has carried one for a while with a comment explaining
 * the deadlock it prevents: on a low-grip surface the throttle ceiling
 * decays faster than it restores until the car can never pull away
 * again. The player's path never had it, so a car stopped on the grass
 * with traction control on was stuck there for good. Putting the
 * bypass here means there is one copy of it rather than two.
 */
export const driverAids = (
  desired: ControlState,
  state: VehicleState,
  assist: AssistState,
  dt: number,
  p: EasyModeParams = defaultEasyMode()
): ControlState => {
  /* Reverse first, because it rewrites what the pedals mean and
     everything below reads them. */
  const pedals = arcadeReverse(desired, state.gear, state.speed, p.reverse);

  if (Math.abs(state.speed) < p.bypassSpeed) {
    assist.throttleLimit = 1;
    assist.steerLimit = 1;
    return pedals;
  }

  const drivenSlip = Math.max(
    Math.abs(state.wheels[RL].slipRatio),
    Math.abs(state.wheels[RR].slipRatio)
  );
  let throttle = tractionControl(pedals.throttle, drivenSlip, assist, dt, p.traction);

  /* The mean of the two front wheels rather than the larger. They share
     a steer angle and sit 1.6 m apart, so they track each other closely
     — and the mean needs no decision about whose sign to believe. */
  const frontSlip = (state.wheels[FL].slipAngle + state.wheels[FR].slipAngle) / 2;
  const grounded = state.wheels[FL].grounded || state.wheels[FR].grounded;
  const sideslip = sideslipOf(state);
  const sliding = Math.abs(sideslip) > p.yaw.deadband;
  const steer = grounded
    ? steerLimiter(pedals.steer, frontSlip, assist, dt, p.steering, sliding)
    : clamp(pedals.steer, -assist.steerLimit, assist.steerLimit);

  const caught = yawAssist(steer, throttle, sideslip, state.angularVelocity.y, state.speed, p.yaw);
  throttle = caught.throttle;

  return { ...pedals, throttle, steer: caught.steer };
};
