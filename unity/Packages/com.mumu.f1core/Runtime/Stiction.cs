using System;

namespace MumuF1
{
    /// <summary>
    /// What holds a stationary car still.
    /// </summary>
    /// <remarks>
    /// The slip model in <see cref="Tire"/> is undefined at a standstill and
    /// it does not pretend otherwise: a slip ratio is a difference divided by
    /// a speed, a slip angle is an arctangent of two velocities, and at rest
    /// both are zero over zero. Worse than undefined, the relaxation length
    /// makes the answer *exactly zero* — the carcass builds its cornering
    /// force over half a metre of rolling, so a car that is not rolling never
    /// builds any. A car parked on a cambered road therefore had no friction
    /// at all and slid down the crossfall, turning as it went, with the
    /// instrumentation reporting <c>f 0 N</c> the whole way. It was measured
    /// at 1.96 m of drift and 2.8 degrees of rotation over 9.2 seconds on
    /// the grid, with nothing pressed.
    ///
    /// This is the missing regime. Below a crawl a tyre is not sliding, it is
    /// *stuck*: the rubber grips the road and the carcass deflects, so the
    /// force comes from how far the contact patch has been dragged from where
    /// it took hold rather than from a slip. That is a spring, not a curve —
    /// which is exactly why a damper alone will not do. A damper has a
    /// terminal creep velocity under a constant side force and would let the
    /// car walk down the camber, slowly instead of quickly. A spring has a
    /// terminal *displacement*, so the car stops and stays stopped.
    ///
    /// The anchor is where the patch took hold. It stretches with whatever
    /// the patch is actually sliding, pulls back, and when the pull exceeds
    /// what friction can supply it lets go and is dragged along — which is
    /// how a stuck tyre becomes a sliding one, and the reason this is bounded
    /// by the same friction circle everything else is. One tyre model, two
    /// regimes, blended over the crawl so neither is ever switched on or off
    /// mid-corner.
    ///
    /// Deliberately keyed to the *patch* slip and not the car's velocity.
    /// A driven wheel spins up before the car moves, so its patch slides
    /// backwards against the road and the force this returns points forwards:
    /// it launches the car rather than fighting it. Keying it to the chassis
    /// would have made static friction into a handbrake.
    /// </remarks>
    public sealed class StictionParams
    {
        /// <summary>
        /// Patch speed above which the slip model is trusted alone (m/s).
        /// </summary>
        /// <remarks>
        /// Low on purpose. Two and a half km/h is out of this regime and into
        /// one the magic formula can answer, and a launch is through it in
        /// about a twentieth of a second.
        /// </remarks>
        public double CrawlSpeed { get; set; } = 0.7;

        /// <summary>
        /// Carcass stiffness: newtons per metre of stretch, per newton of
        /// vertical load.
        /// </summary>
        /// <remarks>
        /// Ninety puts the four patches together at about seven hundred
        /// kilonewtons per metre under a car at rest, which is a 4.7 Hz mode
        /// on eight hundred kilogrammes. At a fiftieth of a second that is
        /// 0.59 radians of phase a step — comfortably inside the two the
        /// explicit integrator allows, with the yaw mode (the tighter of the
        /// two, because the patches sit on long levers) at 0.91.
        /// </remarks>
        public double Stiffness { get; set; } = 90.0;

        /// <summary>
        /// Newtons per metre per second, per newton of load.
        /// </summary>
        /// <remarks>
        /// Set by the yaw mode rather than the lateral one. Four patches at
        /// roughly 1.8 m of lever damp yaw thirteen times harder than they
        /// damp sideways travel, against an inertia only 1.4 times larger, so
        /// yaw is what runs out of stability margin first: this is the value
        /// that keeps it at 0.7 of a step.
        /// </remarks>
        public double Damping { get; set; } = 1.5;

        /// <summary>
        /// Fraction of <see cref="Tire.PeakForce"/> the patch can hold before
        /// it lets go.
        /// </summary>
        /// <remarks>
        /// Static friction is a little above sliding friction — that
        /// difference is why a locked wheel stops a car less well than one on
        /// the edge, and why a car that has broken away is harder to hold
        /// than one that has not. A tenth is the usual figure.
        /// </remarks>
        public double Hold { get; set; } = 1.1;
    }

    /// <summary>Where one contact patch took hold, and how far it has stretched.</summary>
    public struct StictionState
    {
        /// <summary>Stretch along the wheel's heading (m).</summary>
        public double StretchLong;

        /// <summary>And across it (m).</summary>
        public double StretchLat;

        /// <summary>True while the patch is holding rather than sliding.</summary>
        public bool Stuck;
    }

    public static class Stiction
    {
        /// <summary>
        /// The force a patch that is nearly stopped is putting into the road.
        /// </summary>
        /// <param name="state">
        /// The anchor, carried between ticks and advanced by this call.
        /// </param>
        /// <param name="slideLong">
        /// How fast the patch is sliding backwards along the wheel (m/s):
        /// the car's speed at the patch minus what the wheel is laying down,
        /// <c>vLong - omega * radius</c>. Positive means the road is running
        /// out from under a wheel that is turning too slowly, so the force
        /// comes back negative and slows the car down. Negative means the
        /// wheel is laying down more than the car is using — a launch — and
        /// the force comes back positive and pushes it along.
        /// </param>
        /// <param name="slideLat">
        /// How fast it is sliding sideways (m/s), positive to the wheel's
        /// right.
        /// </param>
        /// <param name="load">Vertical load on the patch (N).</param>
        /// <param name="peakForce">
        /// What the same patch would carry at the peak of its slip curve —
        /// <see cref="Tire.PeakForce"/> at this load. Passed in rather than
        /// worked out here so both regimes are ceilinged by one number from
        /// one set of tyre parameters, and a tyre change cannot move one
        /// without moving the other.
        /// </param>
        /// <param name="dt">The step, in seconds. Zero releases the anchor.</param>
        /// <param name="gripScale">
        /// Surface, temperature and wear, exactly as <see cref="Tire.Solve"/>
        /// takes it.
        /// </param>
        /// <returns>
        /// Force on the car in the wheel's frame, under a ceiling that closes
        /// as the patch speeds up: at <see cref="StictionParams.CrawlSpeed"/>
        /// and above it is exactly zero and the slip model has the patch to
        /// itself. <see cref="TireForces.GripUsage"/> is against that ceiling,
        /// so it reads 1 at the moment the patch lets go.
        /// </returns>
        public static TireForces Solve(
            StictionParams p,
            ref StictionState state,
            double slideLong,
            double slideLat,
            double load,
            double peakForce,
            double dt,
            double gripScale = 1.0)
        {
            if (load <= 1.0 || dt <= 0.0)
            {
                state.StretchLong = 0;
                state.StretchLat = 0;
                state.Stuck = false;
                return new TireForces(0, 0, 0);
            }

            /* Stretched by what actually slid, before the force is read off
               it. Taking the new stretch rather than the old is not a detail:
               it is the semi-implicit step, and it is what makes a spring
               this stiff safe to integrate forwards at all. */
            state.StretchLong += slideLong * dt;
            state.StretchLat += slideLat * dt;

            double k = p.Stiffness * load;
            double c = p.Damping * load;

            double fLong = -(k * state.StretchLong + c * slideLong);
            double fLat = -(k * state.StretchLat + c * slideLat);

            /* Nothing here may exceed what the road can hold — the same
               ceiling the magic formula works under, raised by the margin
               static friction has over sliding, and faded to nothing by the
               crawl so the slip model is left alone above it.

               Fading the *ceiling* rather than the force is the whole trick,
               and getting it the other way round cost a rebuild. Fade the
               output and the anchor goes on stretching in a regime where it
               is barely allowed to push: it quietly banks two centimetres of
               spring, and the instant the patch slows down and the fade lifts
               it hands all of it back at once. Measured, that turned a car
               settling through half a degree of yaw into one flicked to half
               a radian a second in a single tick — a spring that pays out
               more than it took in, which is not a spring. Fade the ceiling
               and the anchor can only ever hold what it is currently allowed
               to deliver, so there is nothing banked to give back. */
            double cap = p.Hold * peakForce * gripScale
                * (1.0 - MathUtil.Clamp(
                       MathUtil.Hypot(slideLong, slideLat)
                       / Math.Max(1e-6, p.CrawlSpeed), 0, 1));

            double mag = MathUtil.Hypot(fLong, fLat);

            if (mag > cap)
            {
                /* Let go. The anchor is dragged forward to sit exactly where
                   the capped force says it is — keep the old one and the tyre
                   would remember a stretch it never had and snap back through
                   it. At and above the crawl the ceiling is zero, so this is
                   also what releases the patch cleanly into the slip model's
                   hands rather than switching it there. */
                double scale = mag > 1e-9 ? cap / mag : 0.0;
                fLong *= scale;
                fLat *= scale;
                state.StretchLong = -fLong / k;
                state.StretchLat = -fLat / k;
                state.Stuck = false;
            }
            else
            {
                state.Stuck = cap > 0.0;
            }

            return new TireForces(
                fLong, fLat,
                MathUtil.Clamp(MathUtil.Hypot(fLong, fLat) / Math.Max(cap, 1e-6), 0, 2));
        }
    }
}
