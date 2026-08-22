using System;

namespace MumuF1
{
    /// <summary>How the booster is earned and spent.</summary>
    public sealed class BoosterParams
    {
        /// <summary>Seconds of clean driving that fill it.</summary>
        /// <remarks>
        /// Short enough to happen on a first lap. A reward a child never sees
        /// is not a reward, it is a rumour.
        /// </remarks>
        public double ChargeSeconds { get; set; } = 7.0;

        /// <summary>How long a deployment lasts.</summary>
        public double DeploySeconds { get; set; } = 4.0;

        /// <summary>Sideslip past which the car is sliding rather than driving (rad).</summary>
        /// <remarks>
        /// Seven degrees. Below it the car is cornering; above it the back is
        /// coming round, and the whole point of the reward is that it is paid
        /// for tidiness rather than for bravery.
        /// </remarks>
        public double CleanSideslip { get; set; } = 0.12;

        /// <summary>Below this there is no driving to reward (m/s).</summary>
        /// <remarks>
        /// Otherwise a car parked on the grid earns a boost for standing
        /// still, which is the single most obvious way to break this.
        /// </remarks>
        public double CleanSpeed { get; set; } = 15.0;

        /// <summary>Throttle that counts as asking for it.</summary>
        public double DeployThrottle { get; set; } = 0.9;

        /// <summary>How much faster a slide drains it than clean driving fills it.</summary>
        public double SlideDrain { get; set; } = 2.0;
    }

    /// <summary>
    /// A boost you are given for driving well, rather than one you are issued.
    /// </summary>
    /// <remarks>
    /// The car already has an overtake mode with an energy store behind it,
    /// and this does not replace any of that. It decides <em>when the button
    /// is pressed</em>, and nothing else — the power, the energy and the
    /// limits stay where they were.
    ///
    /// Which matters on a phone, because there is no button. The controls are
    /// a thumb each side, steering and pedals, and the moment a third thing
    /// needs pressing the whole layout stops working. So it arms itself when
    /// the driving deserves it and fires itself when the throttle is pinned,
    /// and the player's side of the bargain is legible without a word of
    /// explanation: stay on the road, keep it straight, and the car goes
    /// faster.
    ///
    /// Off the road resets it outright and a slide only drains it. That
    /// asymmetry is deliberate. Leaving the circuit is a thing you can see
    /// yourself do, so losing everything reads as fair; a small slide is
    /// often the car rather than the driver, and wiping seven seconds of work
    /// for one would teach timidity instead of tidiness.
    /// </remarks>
    public sealed class Booster
    {
        /// <summary>How full it is, zero to one.</summary>
        public double Charge { get; private set; }

        /// <summary>Whether it is being spent right now.</summary>
        public bool Deploying { get; private set; }

        /// <summary>Seconds of deployment left.</summary>
        public double Remaining { get; private set; }

        /// <summary>Full, and waiting for the throttle.</summary>
        public bool Armed => !Deploying && Charge >= 1.0;

        /// <summary>How long the deployment now running was given (s).</summary>
        private double _deployFor;

        /// <summary>
        /// What a meter should show, zero to one: filling, then emptying.
        /// </summary>
        /// <remarks>
        /// Here rather than in the read-out, so the display cannot drift from
        /// the rule. A bar dividing by its own idea of how long a deployment
        /// lasts is right until somebody changes the deployment and does not
        /// know the bar exists.
        /// </remarks>
        public double Meter => Deploying
            ? Math.Max(0.0, Remaining / Math.Max(1e-6, _deployFor))
            : Charge;

        /// <summary>Forget everything; for a reset or a new session.</summary>
        public void Reset()
        {
            Charge = 0;
            Deploying = false;
            Remaining = 0;
            _deployFor = 0;
        }

        /// <summary>
        /// Advance by <paramref name="dt"/>, and say whether to press the button.
        /// </summary>
        /// <param name="onTrack">whether the car is inside the white lines.</param>
        /// <param name="sideslip">angle between where it points and where it goes (rad).</param>
        /// <param name="speed">forward speed (m/s); the sign does not matter.</param>
        /// <param name="throttle">what the driver is asking for, zero to one.</param>
        public bool Update(double dt, bool onTrack, double sideslip, double speed,
            double throttle, BoosterParams p = null)
        {
            p = p ?? new BoosterParams();

            if (Deploying)
            {
                Remaining -= dt;
                if (Remaining > 0) return true;

                Deploying = false;
                Remaining = 0;
                return false;
            }

            var moving = Math.Abs(speed) >= p.CleanSpeed;
            var tidy = Math.Abs(sideslip) <= p.CleanSideslip;

            if (!onTrack)
            {
                Charge = 0;
            }
            else if (!moving)
            {
                /* Neither earned nor punished. Crawling out of a spin is not
                   clean driving, and it is not a mistake being made now
                   either. */
            }
            else if (tidy)
            {
                Charge = Math.Min(1.0, Charge + dt / Math.Max(1e-6, p.ChargeSeconds));
            }
            else
            {
                Charge = Math.Max(0.0,
                    Charge - dt / Math.Max(1e-6, p.ChargeSeconds) * p.SlideDrain);
            }

            if (Charge < 1.0 || throttle < p.DeployThrottle || !onTrack) return false;

            Deploying = true;
            Remaining = p.DeploySeconds;
            _deployFor = p.DeploySeconds;
            Charge = 0;
            return true;
        }
    }
}
