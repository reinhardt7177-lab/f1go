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
  /**
   * Yaw moment the aids want this tick (N m).
   *
   * Written by `driverAids` and read by the composition root, so the
   * sideslip, the yaw excess and the torque are all computed once from
   * one snapshot. Computing it separately at the call site meant the
   * aids and the torque could be handed different states.
   */
  stabilityTorque: number;
}

export const initialAssistState = (): AssistState => ({
  throttleLimit: 1,
  steerLimit: 1,
  stabilityTorque: 0
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
  p: TractionControlParams = defaultTractionControl(),
  sliding = false
): number => {
  /* A sliding car reads as a wheelspinning one, and it is not.
   *
   * Slip ratio is measured against the contact patch's *longitudinal*
   * velocity. When the car goes sideways that collapses while the wheel
   * speed does not, so the ratio climbs even though the rear tyres are
   * turning at exactly the speed they should. The controller then walks
   * its ceiling down to the floor, and a car with no drive cannot pull
   * itself straight — measured at 0.07 of throttle through an entire
   * seventy-degree slide. So it holds its ground and lets the yaw
   * assist's throttle trim be the only thing shaping throttle while the
   * car is out of shape. */
  if (sliding) {
    return Math.min(desired, state.throttleLimit);
  }

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
  /* The chassis, mirrored as plain numbers so this file still imports
     nothing from the vehicle — the same discipline `counterGain` keeps. */
  latAccel: number;
  latAccelPerV2: number;
  wheelbase: number;
  maxSteerAngle: number;
  steerSpeedFactor: number;
  /** How much more lock than the limit corner needs to allow. */
  speedHeadroom: number;
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
  floor: 0.1,
  latAccel: 16.0,
  latAccelPerV2: 0.00345,
  wheelbase: 3.6,
  maxSteerAngle: 0.349,
  steerSpeedFactor: 0.45,
  /* Sixty per cent more lock than a grip-limited corner can use. Enough
     that the car can still be provoked and corrected and never feels
     numb; little enough that full travel stops being a request the
     front axle answers with drag. */
  speedHeadroom: 1.6
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
/**
 * The most lock worth having at this speed.
 *
 * The integrator below is a closed loop, so it can only cut *after* the
 * front axle has gone past its peak and the half-metre of relaxation
 * lag has already put the transient into the car. This stops the
 * request being made at all.
 *
 * At 130 km/h the front axle can use 3.2 degrees and full travel asks
 * for 15.2 — nearly five times over — and past the peak the lateral
 * curve slopes down, so the extra lock buys drag and nothing else. That
 * is what turned a corner into a 130-to-25 km/h scrub.
 *
 * Below about 63 km/h this returns exactly 1 and the driver keeps every
 * degree. That is not a special case: under that speed the car is
 * limited by the steering rack rather than by grip — at 50 km/h it
 * needs 17.3 of the 18.2 degrees it has — so the ceiling falls out of
 * the arithmetic above 1 and clamps. Slow corners are untouched.
 */
export const speedLockCeiling = (
  speed: number,
  p: SteerLimiterParams = defaultSteerLimiter()
): number => {
  const v = Math.abs(speed);
  if (v < 1) return 1;

  const needed = Math.atan(
    ((p.latAccel + p.latAccelPerV2 * v * v) * p.wheelbase) / (v * v)
  );
  const available =
    p.maxSteerAngle * (1 - (1 - p.steerSpeedFactor) * clamp((v * 3.6) / 300, 0, 1));

  return clamp((p.speedHeadroom * needed) / available, p.floor, 1);
};

export const steerLimiter = (
  desired: number,
  frontSlip: number,
  state: AssistState,
  dt: number,
  p: SteerLimiterParams = defaultSteerLimiter(),
  sliding = false,
  speed = 0
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
  const beyondPeak =
    desired !== 0 &&
    Math.abs(frontSlip) > p.targetSlip &&
    Math.sign(frontSlip) !== Math.sign(desired);

  if (sliding) {
    /* Stand down — but stand down *frozen*.
     *
     * A yawing car carries a large front slip angle whatever the
     * steering is doing, so the loop cannot read it. What it must not
     * do is conclude from that silence that the lock is safe to hand
     * back. This branch used to fall through to the restore below, and
     * the ceiling climbed from 0.93 to 1.00 during a twenty-seven
     * degree slide — giving the player's full wrong-way lock back at
     * the one moment it was actively wrong. Hold whatever the corner
     * had earned and let the yaw assist do its work. */
  } else if (beyondPeak) {
    state.steerLimit -=
      dt * p.cutRate * clamp(Math.abs(frontSlip) / p.targetSlip - 1, 0, 3);
  } else {
    state.steerLimit += dt * p.restoreRate;
  }
  state.steerLimit = clamp(state.steerLimit, p.floor, 1);

  /* Whichever is tighter: what the corner has earned, or what the speed
     can use. The ceiling is applied to the command and never written
     back into the state, so the integrator keeps its own memory. */
  const ceiling = Math.min(state.steerLimit, speedLockCeiling(speed, p));
  return clamp(desired, -ceiling, ceiling);
};

export interface YawLimiterParams {
  /** Mechanical grip, as lateral acceleration at rest (m/s^2). */
  latAccel: number;
  /** Downforce's share, which grows with the square of speed. */
  latAccelPerV2: number;
  /** Distance between axles (m). */
  wheelbase: number;
  /** Yaw rate allowed past the target before anything acts (rad/s). */
  band: number;
  /** Below this road speed yaw means nothing (m/s). */
  minSpeed: number;
  /** Excess at which the correcting torque saturates (rad/s). */
  span: number;
  /** Strongest moment the assist will ask for (N m). */
  peak: number;
}

export const defaultYawLimiter = (): YawLimiterParams => ({
  /* A two-term fit of what this car can actually pull: mechanical grip
     plus downforce. It reproduces the numbers quoted elsewhere in this
     file — 18.7 m/s^2 at 100 km/h, which is the 39 m grip-limited
     radius the steering limiter's note cites, and 40 at 300 km/h. */
  latAccel: 16.0,
  latAccelPerV2: 0.00345,
  wheelbase: 3.6,
  /* Additive rather than a multiplier, and that matters: a
     multiplicative margin gives zero tolerance in a straight line,
     where the target is zero, and welds the car to the road. A quarter
     of a radian per second is fourteen degrees a second of free
     rotation at any speed — enough for turn-in overshoot and for the
     half-metre of relaxation lag in the tyre model. A spin is three to
     five times over, not one point three. */
  band: 0.25,
  minSpeed: 8,
  span: 1.0,
  /* 1100 kg m^2 of yaw inertia times ten radians per second squared.
     That removes the one and a half rad/s of excess measured in a real
     slide in 0.15 s, against the 0.53 s the previous 5200 needed — and
     0.5 s is longer than the whole event. For scale the rear axle at
     the limit makes about 13,250 N m of yaw moment on its own, so this
     is below the authority the tyres themselves routinely use. */
  peak: 11_000
});

/**
 * How much faster the car is rotating than anything could justify.
 *
 * This is the change that stops the spin, and the reason is timing.
 * Sideslip is a lagging indicator: in a measured slide it was still
 * only eleven degrees — barely past the yaw assist's deadband — while
 * the car was already rotating at 1.46 rad/s against the 0.56 the grip
 * at that speed could hold. **Two and a half times over, half a second
 * before the angle said anything was wrong.**
 *
 * The target is the smaller of what the steering is asking for and what
 * the tyres can deliver, so it is zero on a straight, exactly the
 * corner's own rate through a corner, and never more than grip allows.
 * Everything beyond it plus a band is excess, and only the excess is
 * ever acted on — which is why this cannot resist a turn the driver
 * genuinely asked for.
 *
 * @param steerAngle signed road-wheel angle (rad)
 * @returns signed excess yaw rate (rad/s), zero when the car is honest
 */
export const yawExcessOf = (
  yawRate: number,
  steerAngle: number,
  speed: number,
  p: YawLimiterParams = defaultYawLimiter()
): number => {
  if (Math.abs(speed) < p.minSpeed) return 0;

  /* What the steering is asking for. A positive steer is a right turn,
     and a right turn is a *negative* yaw rate about +Y — rotating the
     car's -Z nose by a positive yaw swings it towards -X, which is to
     the left. Hence the minus, and getting it wrong would make the
     assist add to every corner instead of nothing. */
  const asked = (-speed * Math.tan(steerAngle)) / p.wheelbase;
  const grip = (p.latAccel + p.latAccelPerV2 * speed * speed) / Math.abs(speed);

  const target = clamp(asked, -grip, grip);
  const error = yawRate - target;
  return error - clamp(error, -p.band, p.band);
};

/**
 * The moment a real stability program makes with the brakes.
 *
 * Steering and throttle are not enough on their own, and the reason is
 * worth writing down: countersteer can only produce as much yaw moment
 * as the front tyres have grip left, and a car already sideways has
 * very little. Held at full opposite lock with the throttle cut, the
 * simulated car still rotated all the way round — correctly, because
 * that is what the physics says.
 *
 * A real car answers this by braking individual wheels, which makes a
 * yaw moment out of longitudinal force and needs no cornering grip at
 * all. There is no per-wheel brake channel here, so this asks for the
 * moment directly. It is a gameplay force and it says so — but it is
 * the same force an electronic stability program would make, for the
 * same reason, and it is driven by the yaw *excess*, so it is exactly
 * zero whenever the car is doing what its steering asked.
 */
export const stabilityTorque = (
  yawExcess: number,
  p: YawLimiterParams = defaultYawLimiter()
): number => {
  // Guarded so an honest car reports exactly +0 rather than -0, which
  // is a different number to `Object.is` and therefore to a test.
  if (yawExcess === 0) return 0;
  return -clamp(yawExcess / p.span, -1, 1) * p.peak;
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
  /* Eleven and a half degrees, down from twenty.
     Sideslip grew from nothing to twenty-seven degrees in one second in
     the slide this was tuned against, so the old ramp needed half a
     second to reach full authority and the car was gone by then. This
     one takes 0.17 s. It also catches the car while the rear axle still
     has 97 per cent of its peak force to straighten up with, against 90
     per cent at twenty degrees. */
  fullBand: 0.2,
  /* Saturating at 10.4 degrees of slide, just inside the point where
     the assist is allowed its full authority — so it is asking for
     everything it has by the time it may use everything it has.
     One degree of slide per degree of lock, which is what the old value
     was aiming at, turns out to be too little: at 130 km/h the rack
     only offers 15.2 degrees, so matching the slide angle merely points
     the front wheels *along* the direction of travel, and wheels
     pointing where the car is already going make no restoring moment at
     all. This asks for about 1.45 times the slide, which does. */
  counterGain: 5.5,
  /* The lead term — and its sign was wrong, which is worth stating
     plainly because the comment that used to sit here described the
     right physics and the code did the opposite.
     Forward is -Z and right is +X, so a right turn is a *negative* yaw
     rate; and when the rear steps out in that turn the velocity vector
     sits to the left of the nose, making sideslip negative too. Slide
     and yaw rate therefore share a sign while a slide is opening and
     oppose once it is being caught. Subtracting the rate term, as this
     did, took countersteer away exactly while the slide grew and added
     it while the car came back — a positive feedback term wearing a
     damper's clothes, and the reason the measured trace oscillated
     between thirteen and twenty degrees instead of settling.
     Driven off the yaw *excess* rather than the raw rate, so a car
     going round a corner at the rate that corner implies contributes
     nothing. Read the size as a release time: the command nulls once
     the car is unwinding fast enough to close the remaining slide in
     about three tenths of a second. */
  rateGain: 1.6,
  /* Blend, never override — but only just. With the driver holding
     full wrong-way lock this is the difference between reaching -0.80
     of countersteer and -0.90, and the measured slide needed the
     latter. What keeps the car from feeling like it drives itself is
     the deadband, not this number: below seven degrees of sideslip the
     assist is bit-exact zero. */
  maxAuthority: 0.95,
  /* Now the only thing shaping throttle while the car is sideways —
     traction control stands down there, because slip ratio misreads a
     yaw event as wheelspin. A third of throttle in fourth at 130 km/h
     cannot light the rears, and it is the difference between a car that
     drives out of a slide and the 0.07 that was measured, which is a
     car being dragged to a halt. */
  throttleTrim: 0.7,
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
 * @param sideslip   radians, positive when the car travels to the right
 *                   of its own nose
 * @param yawExcess  yaw rate beyond what the steering and grip imply,
 *                   from `yawExcessOf` — not the raw rate, which cannot
 *                   tell a corner from a spin
 * @param speed      road speed, m/s
 */
export const yawAssist = (
  desiredSteer: number,
  desiredThrottle: number,
  sideslip: number,
  yawExcess: number,
  speed: number,
  p: YawAssistParams = defaultYawAssist()
): YawAssistResult => {
  const idle = { steer: desiredSteer, throttle: desiredThrottle, authority: 0 };
  if (Math.abs(speed) < p.minSpeed) return idle;

  const over = Math.abs(sideslip) - p.deadband;
  if (over <= 0) return idle;

  const authority = clamp(over / (p.fullBand - p.deadband), 0, 1) * p.maxAuthority;

  /* A tail out to the right means the car is yawing right and
     travelling to the left of its nose: sideslip negative, yaw rate
     negative, both terms negative, and the assist steers left — into
     the slide, as it should. The two share a sign while the slide opens
     and oppose while it is caught, which is why they *add*. */
  const counter = clamp(p.counterGain * sideslip + p.rateGain * yawExcess, -1, 1);

  return {
    steer: desiredSteer + authority * (counter - desiredSteer),
    throttle: desiredThrottle * (1 - p.throttleTrim * authority),
    authority
  };
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
  limiter: YawLimiterParams;
  reverse: ReverseParams;
  /** Below this road speed every loop is bypassed and reset (m/s). */
  bypassSpeed: number;
}

export const defaultEasyMode = (): EasyModeParams => ({
  traction: defaultTractionControl(),
  steering: defaultSteerLimiter(),
  yaw: defaultYawAssist(),
  limiter: defaultYawLimiter(),
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
    assist.stabilityTorque = 0;
    return pedals;
  }

  const drivenSlip = Math.max(
    Math.abs(state.wheels[RL].slipRatio),
    Math.abs(state.wheels[RR].slipRatio)
  );
  let throttle = tractionControl(
    pedals.throttle,
    drivenSlip,
    assist,
    dt,
    p.traction,
    Math.abs(sideslipOf(state)) > p.yaw.deadband
  );

  /* The mean of the two front wheels rather than the larger. They share
     a steer angle and sit 1.6 m apart, so they track each other closely
     — and the mean needs no decision about whose sign to believe. */
  const frontSlip = (state.wheels[FL].slipAngle + state.wheels[FR].slipAngle) / 2;
  const grounded = state.wheels[FL].grounded || state.wheels[FR].grounded;
  const sideslip = sideslipOf(state);
  const sliding = Math.abs(sideslip) > p.yaw.deadband;

  /* How much faster the car is turning than anything could justify.
     Computed once here and used by both the steering correction and the
     torque, so the two can never be looking at different states. */
  const excess = yawExcessOf(
    state.angularVelocity.y,
    state.steerAngles[FL],
    state.speed,
    p.limiter
  );
  assist.stabilityTorque = stabilityTorque(excess, p.limiter);

  const steer = grounded
    ? steerLimiter(pedals.steer, frontSlip, assist, dt, p.steering, sliding, state.speed)
    : clamp(pedals.steer, -assist.steerLimit, assist.steerLimit);

  const caught = yawAssist(steer, throttle, sideslip, excess, state.speed, p.yaw);
  throttle = caught.throttle;

  return { ...pedals, throttle, steer: caught.steer };
};
