using System;

namespace MumuF1
{
    /// <summary>
    /// Engine, gearbox, differential and energy recovery.
    /// </summary>
    /// <remarks>
    /// The clutch is not modelled: above idle the drivetrain is treated
    /// as locked, so engine speed follows the driven wheels through the
    /// gear ratios. That is fair for a seamless-shift F1 gearbox and it
    /// keeps the model deterministic and cheap.
    /// </remarks>
    public sealed class DrivetrainParams
    {
        public double IdleRpm = 4_000.0;
        public double RedlineRpm = 15_000.0;

        /// <summary>Peak torque (Nm) and the rpm it occurs at.</summary>
        public double PeakTorque = 610.0;
        public double PeakTorqueRpm = 10_500.0;

        /// <summary>Torque still available at the redline, as a fraction of peak.</summary>
        public double RedlineTorqueFraction = 0.82;

        /* Eighth is geared to run out just above the drag-limited top
           speed in straight mode: at the 15,000 rpm limiter this is
           373 km/h. Taller and the car never reaches the limiter, so the
           gear is wasted; shorter and it sits on the limiter with speed
           still available. A first pass geared for 438 and the car simply
           could not pull it. */
        public double[] GearRatios = { 3.4, 2.6, 2.1, 1.78, 1.54, 1.36, 1.2, 1.02 };

        /* Reverse, geared shorter than first and deliberately limited.
           The regulations require a car to be able to reverse under its
           own power; nobody pretends it is for going anywhere. Capping it
           means a spin ends with a slow shuffle back onto the circuit
           rather than a second attempt at the barrier, backwards. */
        public double ReverseRatio = -3.9;
        public double ReverseRpmLimit = 6_500.0;

        public double FinalDrive = 5.35;
        public double Efficiency = 0.95;

        /// <summary>Engine braking at closed throttle, scaled by rpm (Nm).</summary>
        public double EngineBrakingTorque = 90.0;

        /// <summary>Limited-slip locking, 0 is open and 1 is a spool.</summary>
        public double DiffLock = 0.6;

        /* Overtake Mode, 2026 — the aid that replaced DRS. Within a
           second of the car ahead the driver may release a fixed slug of
           electrical energy. It is a power boost rather than a drag
           reduction, so unlike DRS it works in the corners too, and it
           runs out rather than lasting the whole straight. */

        public double OvertakePower = 50_000.0;
        public double OvertakeEnergyPerUse = 500_000.0;
        public double ErsCapacity = 4_000_000.0;
        public double ErsRecoveryEfficiency = 0.4;

        public double BrakeTorqueTotal = 22_000.0;
        public double BrakeBias = 0.58;

        /// <summary>Seconds a shift takes; torque is cut for this long.</summary>
        public double ShiftTime = 0.05;
    }

    /// <summary>Torque delivered to the two driven wheels (Nm at the wheel).</summary>
    public readonly struct DriveTorques
    {
        public readonly double Left;
        public readonly double Right;

        public DriveTorques(double left, double right)
        {
            Left = left;
            Right = right;
        }
    }

    /// <summary>
    /// The drivetrain, with its state. A class rather than a struct
    /// because it is stepped in place, exactly as the TypeScript's
    /// mutable state object was.
    /// </summary>
    public sealed class Drivetrain
    {
        /// <summary>Gear 0 is reverse; 1 upwards are the forward ratios.</summary>
        public const int Reverse = 0;

        /// <summary>
        /// Selecting reverse at speed would be a gearbox rebuild, so the
        /// shift into and out of it only happens at walking pace. This
        /// also stops a downshift chain running off the bottom of the box
        /// into reverse at the end of a straight. Measured on the driven
        /// wheels in rad/s: 5.6 is about 2 m/s on a 360 mm tyre.
        /// </summary>
        private const double SelectReverseBelow = 5.6;

        public readonly DrivetrainParams Params;

        public int Gear;
        public double Rpm;
        public double ShiftTimer;
        public double ErsStore;
        public bool OvertakeDeploying;

        /// <summary>Energy left in the activation currently running (J).</summary>
        public double OvertakeRemaining;

        /// <summary>True until the button is released, so one press is one slug.</summary>
        public bool OvertakeLatched;

        public Drivetrain(DrivetrainParams p = null)
        {
            Params = p ?? new DrivetrainParams();
            Reset();
        }

        public void Reset()
        {
            Gear = 1;
            Rpm = Params.IdleRpm;
            ShiftTimer = 0;
            ErsStore = Params.ErsCapacity;
            OvertakeDeploying = false;
            OvertakeRemaining = 0;
            OvertakeLatched = false;
        }

        /// <summary>What the driver sees. Nobody displays reverse as "0".</summary>
        public string GearLabel => Gear == Reverse ? "R" : Gear.ToString();

        /// <summary>
        /// Torque curve: rises to peak, then falls away towards the
        /// redline. Two quadratics stitched at the peak — smooth enough
        /// to drive against, cheap enough to evaluate every tick.
        /// </summary>
        public static double EngineTorque(DrivetrainParams p, double rpm)
        {
            double r = MathUtil.Clamp(rpm, 0, p.RedlineRpm);
            if (r < p.PeakTorqueRpm)
            {
                // Rise from ~55% of peak at idle to 100% at the peak.
                double t = MathUtil.Clamp(
                    (r - p.IdleRpm) / Math.Max(1.0, p.PeakTorqueRpm - p.IdleRpm), 0, 1);
                return p.PeakTorque * (0.55 + 0.45 * (2 * t - t * t));
            }

            double u = MathUtil.Clamp(
                (r - p.PeakTorqueRpm) / Math.Max(1.0, p.RedlineRpm - p.PeakTorqueRpm), 0, 1);
            return p.PeakTorque * (1.0 - (1.0 - p.RedlineTorqueFraction) * u * u);
        }

        /// <summary>Peak power in watts and the rpm it arrives at — a tuning readout.</summary>
        public static void PeakPower(DrivetrainParams p, out double watts, out double atRpm)
        {
            watts = 0;
            atRpm = p.PeakTorqueRpm;
            for (double rpm = p.IdleRpm; rpm <= p.RedlineRpm; rpm += 100)
            {
                double w = EngineTorque(p, rpm) * rpm * 2 * Math.PI / 60.0;
                if (w > watts) { watts = w; atRpm = rpm; }
            }
        }

        public static double GearRatio(DrivetrainParams p, int gear)
        {
            if (gear == Reverse) return p.ReverseRatio * p.FinalDrive;
            int index = (int)MathUtil.Clamp(gear, 1, p.GearRatios.Length) - 1;
            return p.GearRatios[index] * p.FinalDrive;
        }

        /// <summary>
        /// Advance one tick and report the torque for each driven wheel.
        /// </summary>
        /// <param name="drivenOmegaLeft">Angular velocity of the left driven wheel (rad/s).</param>
        /// <param name="drivenOmegaRight">And the right.</param>
        public DriveTorques Step(
            double throttle,
            bool shiftUp,
            bool shiftDown,
            bool overtakeRequested,
            double drivenOmegaLeft,
            double drivenOmegaRight,
            double dt)
        {
            DrivetrainParams p = Params;
            double avgOmega = (drivenOmegaLeft + drivenOmegaRight) / 2.0;
            bool crawling = Math.Abs(avgOmega) < SelectReverseBelow;

            // --- gear selection ---------------------------------------
            if (ShiftTimer > 0)
            {
                ShiftTimer = Math.Max(0, ShiftTimer - dt);
            }
            else if (shiftUp && (Gear == Reverse ? crawling : Gear < p.GearRatios.Length))
            {
                Gear++;
                ShiftTimer = p.ShiftTime;
            }
            else if (shiftDown && Gear > Reverse && (Gear > 1 || crawling))
            {
                Gear--;
                ShiftTimer = p.ShiftTime;
            }

            double ratio = GearRatio(p, Gear);
            bool reversing = Gear == Reverse;

            /* Engine speed follows the driven wheels through the
               magnitude of the ratio: reverse turns the wheels the other
               way, but the engine has no idea and still spins one way. */
            double rawRpm = Math.Abs(avgOmega) * Math.Abs(ratio) * 60.0 / (2 * Math.PI);
            double limit = reversing ? p.ReverseRpmLimit : p.RedlineRpm;
            Rpm = MathUtil.Clamp(rawRpm, p.IdleRpm, limit);

            bool shifting = ShiftTimer > 0;
            double effectiveThrottle = shifting ? 0 : MathUtil.Clamp(throttle, 0, 1);

            double crankTorque = EngineTorque(p, Rpm) * effectiveThrottle;

            /* One press releases one slug; holding the button does not
               extend it, and it has to be released before another can be
               armed. */
            if (overtakeRequested && !OvertakeLatched && OvertakeRemaining <= 0 && ErsStore > 0)
            {
                OvertakeRemaining = Math.Min(p.OvertakeEnergyPerUse, ErsStore);
                OvertakeLatched = true;
            }
            if (!overtakeRequested) OvertakeLatched = false;

            OvertakeDeploying = false;
            if (OvertakeRemaining > 0 && effectiveThrottle > 0.2)
            {
                double omega = Rpm * 2 * Math.PI / 60.0;
                if (omega > 1)
                {
                    crankTorque += p.OvertakePower / omega;
                    double used = p.OvertakePower * dt;
                    OvertakeRemaining = Math.Max(0, OvertakeRemaining - used);
                    ErsStore = Math.Max(0, ErsStore - used);
                    OvertakeDeploying = true;
                }
            }

            /* Engine braking off throttle, scaled by how hard it is
               spinning — but only once the wheels are actually driving
               the engine. Below idle a real clutch is slipping or open,
               and applying it there would drive the car backwards from a
               standstill. */
            if (effectiveThrottle < 0.05 && !shifting && rawRpm > p.IdleRpm)
            {
                crankTorque -= p.EngineBrakingTorque * (Rpm / p.RedlineRpm);
            }

            // The limiter stops it pulling any harder. In reverse the
            // limiter is much lower, which keeps reverse a manoeuvre.
            if (rawRpm >= limit) crankTorque = Math.Min(crankTorque, 0);

            double wheelTorque = crankTorque * ratio * p.Efficiency;

            /* An open diff splits torque evenly. Locking biases it
               towards the slower wheel, which is what stops a rear-drive
               car lighting up the inside tyre on corner exit. */
            double half = wheelTorque / 2.0;
            double diff = drivenOmegaLeft - drivenOmegaRight;
            double bias = MathUtil.Clamp(diff * 0.02, -1, 1) * p.DiffLock * Math.Abs(half);

            return new DriveTorques(half - bias, half + bias);
        }

        /// <summary>Recover energy under braking, once per tick.</summary>
        public void RecoverEnergy(double brakingPowerWatts, double dt)
        {
            if (brakingPowerWatts <= 0) return;
            ErsStore = Math.Min(
                Params.ErsCapacity,
                ErsStore + brakingPowerWatts * Params.ErsRecoveryEfficiency * dt);
        }

        /// <summary>Brake torque per wheel at a given pedal position (Nm).</summary>
        public void BrakeTorques(double brake, out double front, out double rear)
        {
            double total = Params.BrakeTorqueTotal * MathUtil.Clamp(brake, 0, 1);
            front = total * Params.BrakeBias / 2.0;
            rear = total * (1.0 - Params.BrakeBias) / 2.0;
        }
    }
}
