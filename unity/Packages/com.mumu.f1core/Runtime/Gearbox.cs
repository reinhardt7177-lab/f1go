using System;

namespace MumuF1
{
    /// <summary>
    /// When an automatic gearbox shifts, for whoever is driving.
    /// </summary>
    /// <remarks>
    /// This was written twice and the two copies did not agree: the touch
    /// controls shifted both ways and the keyboard only shifted up, so a
    /// desktop lap that braked for a hairpin finished the corner in whatever
    /// gear the straight had left it in. Nobody chose that. It is what
    /// happens to a rule that lives in two files — one gets the second half
    /// and the other does not.
    ///
    /// Road speed decides it, not engine speed. During wheelspin the engine
    /// sits on the limiter while the car is barely moving, and an rpm trigger
    /// would run through all eight gears in the first half second of a start.
    ///
    /// No latch, and that is a change from what both copies did. They each
    /// held a flag that armed only while the car was *below* its current
    /// gear's threshold, which works for as long as every shift is one gear:
    /// going up raises the threshold above the car, so the flag rearms the
    /// next frame. It stops working the moment the car needs more than one.
    /// Land from a jump, or take a reset back onto the circuit at speed, and
    /// the car is several gears adrift with the flag stuck down — first gear
    /// at ninety km/h, permanently, because the condition that would rearm it
    /// is the condition that was already false. Dropping it is safe because
    /// the two things the latch was standing in for are both real and both
    /// elsewhere: <c>Drivetrain.ShiftTimer</c> ignores every request during a
    /// shift, so asking sixty times a second still shifts once per fifty
    /// milliseconds, and the margin below is what stops it hunting.
    /// </remarks>
    public static class Gearbox
    {
        /// <summary>Upshift above this many km/h per gear already held.</summary>
        public const double ShiftUpPerGear = 42.0;

        /// <summary>
        /// Downshift below the gear beneath's own threshold, times this.
        /// </summary>
        /// <remarks>
        /// The whole reason it is not 1.0, and the only thing preventing a
        /// hunt now the latch is gone. At 1.0 the two thresholds meet, and a
        /// car sitting on the boundary shifts up, finds itself below the
        /// downshift line, shifts down, and does that for as long as the
        /// throttle stays where it is. Fifteen per cent of a gear is a band
        /// six km/h wide in second and twenty-two in eighth — wider than
        /// anything a steady throttle wanders across.
        /// </remarks>
        public const double DownshiftMargin = 0.85;

        /// <summary>
        /// What the gearbox wants, given the gear it is in and how fast the
        /// car is going.
        /// </summary>
        /// <param name="gear">The gear now, one-based.</param>
        /// <param name="speedMs">
        /// Road speed (m/s). The sign is ignored — a car rolling backwards at
        /// thirty km/h is not in sixth.
        /// </param>
        /// <param name="up">True to ask for the next gear up.</param>
        /// <param name="down">
        /// True to ask for the next one down. Never true in first, and that
        /// is not tidiness: <see cref="Drivetrain"/> reads a downshift out of
        /// first as a request for <i>reverse</i> whenever the wheels are slow
        /// enough, which is exactly when a car is slow enough for this to
        /// fire.
        /// </param>
        public static void Choose(int gear, double speedMs,
            out bool up, out bool down)
        {
            double kmh = Math.Abs(speedMs) * MathUtil.Kmh;

            up = kmh > gear * ShiftUpPerGear;
            down = gear > 1
                && kmh < (gear - 1) * ShiftUpPerGear * DownshiftMargin;
        }
    }
}
