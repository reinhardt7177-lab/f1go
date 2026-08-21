using System;
using System.Collections.Generic;
using NUnit.Framework;

namespace MumuF1.Tests
{
    /// <summary>
    /// The speed profile over the racing line.
    /// </summary>
    /// <remarks>
    /// The numbers here were measured against the reference implementation
    /// before they were written down, and several of them are claims about
    /// the car rather than about the code — that a hairpin is slow, that a
    /// fast enough sweep is flat out, that a lap comes out near a real pole
    /// time. Those are the ones worth having: a port that compiles and runs
    /// but produces a car nobody would recognise has answered nothing.
    /// </remarks>
    [TestFixture]
    public class SpeedProfileTests
    {
        private static readonly ProfileCar Car = new ProfileCar();
        private static readonly ProfileOptions Options = new ProfileOptions();

        private static IEnumerable<string> Ids
        {
            get
            {
                foreach (var id in Circuits.Specs.Keys) yield return id;
            }
        }

        /// <summary>
        /// A racing line takes six hundred relaxation passes and a profile
        /// four more over the lap, and neither ever changes.
        /// </summary>
        private static readonly Dictionary<string, SpeedProfile> Profiles =
            new Dictionary<string, SpeedProfile>(StringComparer.Ordinal);

        private static SpeedProfile Profile(string id)
        {
            lock (Profiles)
            {
                if (!Profiles.TryGetValue(id, out var profile))
                {
                    profile = new SpeedProfile(new RacingLine(Circuits.Get(id)), Car, Options);
                    Profiles[id] = profile;
                }
                return profile;
            }
        }

        private static double Limit(double radius) =>
            SpeedProfile.CornerLimit(1.0 / radius, Car, Options);

        /// <summary>The whole point of the algebra: a wider corner is a faster one.</summary>
        [Test]
        public void GoesFasterRoundAWiderCorner()
        {
            var radii = new[] { 20.0, 30, 42, 60, 100, 150 };
            for (var i = 1; i < radii.Length; i++)
            {
                Assert.That(Limit(radii[i]), Is.GreaterThan(Limit(radii[i - 1])),
                    $"a {radii[i]} m corner is not faster than a {radii[i - 1]} m one");
            }
        }

        /// <summary>
        /// The numbers, so a change to the tyre or the wings shows up here
        /// rather than as a car that feels different for no stated reason.
        /// </summary>
        [TestCase(20.0, 64.0)]
        [TestCase(42.0, 98.0)]
        [TestCase(100.0, 182.0)]
        [TestCase(150.0, 268.0)]
        public void TakesAKnownCornerAtAKnownSpeed(double radius, double kmh)
        {
            Assert.That(Limit(radius) * MathUtil.Kmh, Is.EqualTo(kmh).Within(3));
        }

        /// <summary>
        /// Past a certain radius the corner is flat out at any speed, and
        /// that is not a special case bolted on — it is the denominator of
        /// the corner-speed solution going negative, which happens exactly
        /// when downforce grows faster than the corner demands. For this car
        /// the threshold is a shade under 200 m.
        /// </summary>
        [Test]
        public void CallsAWideEnoughCornerFlatOut()
        {
            Assert.That(Limit(150), Is.LessThan(Options.MaxSpeed - 1),
                "a 150 m corner should not be flat out");
            Assert.That(Limit(250), Is.EqualTo(Options.MaxSpeed).Within(1e-9));

            // Bisect for the threshold, the way it was measured.
            double lo = 1, hi = 5000;
            for (var i = 0; i < 60; i++)
            {
                var mid = (lo + hi) / 2;
                if (Limit(mid) >= Options.MaxSpeed - 1e-9) hi = mid;
                else lo = mid;
            }
            Assert.That(hi, Is.EqualTo(198.6).Within(4));
        }

        /// <summary>
        /// The oval exists to be flat. Its 250 m corners put the racing line
        /// at 242 m, which is past the threshold above, so a lap of it is
        /// full throttle from the line to the line — which is what makes it
        /// the right place to learn what the car does rather than what the
        /// circuit does.
        /// </summary>
        [Test]
        public void TakesThePracticeOvalFlatOut()
        {
            var profile = Profile("oval");
            for (var i = 0; i < profile.Target.Count; i++)
            {
                Assert.That(profile.Target[i], Is.EqualTo(Options.MaxSpeed).Within(0.5),
                    $"station {i} of the oval is not flat out");
            }
        }

        [TestCaseSource(nameof(Ids))]
        public void NeverTargetsMoreThanTheCeilingOrLessThanNothing(string id)
        {
            var profile = Profile(id);
            for (var i = 0; i < profile.Target.Count; i++)
            {
                Assert.That(profile.Target[i], Is.GreaterThan(0), $"{id} station {i} targets a stop");
                Assert.That(profile.Target[i], Is.LessThanOrEqualTo(Options.MaxSpeed + 1e-3));
            }
        }

        /// <summary>
        /// Braking has to start before the corner rather than at it, so the
        /// lookahead can never report something faster than the target here
        /// and now.
        /// </summary>
        [TestCaseSource(nameof(Ids))]
        public void NeverLooksAheadToSomethingFaster(string id)
        {
            var circuit = Circuits.Get(id);
            var profile = Profile(id);

            for (var s = 0.0; s < circuit.Length; s += 17)
            {
                Assert.That(profile.Lookahead(s, 120), Is.LessThanOrEqualTo(profile.At(s) + 1e-6));
            }
        }

        /// <summary>
        /// The backward pass is what produces braking points, so the car has
        /// to arrive at the slowest corner on the lap having already shed a
        /// great deal of speed.
        /// </summary>
        /// <remarks>
        /// Deliberately not a claim that the approach slows monotonically.
        /// Monza's slowest point is the second apex of the Roggia chicane,
        /// and the profile correctly accelerates between the two — a chicane
        /// is two corners, not one.
        /// </remarks>
        [TestCase("redbullring")]
        [TestCase("interlagos")]
        [TestCase("monza")]
        public void ArrivesAtTheSlowestCornerHavingBraked(string id)
        {
            var circuit = Circuits.Get(id);
            var profile = Profile(id);

            var slowest = double.PositiveInfinity;
            var where = 0.0;
            for (var s = 0.0; s < circuit.Length; s += 1)
            {
                var v = profile.At(s);
                if (v < slowest)
                {
                    slowest = v;
                    where = s;
                }
            }

            var before = profile.At(where - 120);
            Assert.That(before - slowest, Is.GreaterThan(20),
                $"{id} arrives at its slowest corner having shed only "
                + $"{(before - slowest) * MathUtil.Kmh:F0} km/h over 120 m");

            var radius = 0.0;
            foreach (var section in Circuits.Specs[id].Sections)
            {
                if (section.Name == circuit.SectionAt(where)) radius = section.Radius;
            }
            Assert.That(radius, Is.Not.EqualTo(0),
                $"{id} is slowest at \"{circuit.SectionAt(where)}\", which is a straight");
        }

        /// <summary>
        /// The claim that this is an F1 car and not merely a fast one.
        /// </summary>
        /// <remarks>
        /// Real pole laps, near enough: 64 s at the Red Bull Ring, 70 at
        /// Interlagos, 80 at Monza. A profile is an upper bound on what a
        /// driver achieves and this one is a crude integration, so it is
        /// allowed to be off — but not by the factor that would mean the
        /// grip, the wings or the ceiling had drifted.
        /// </remarks>
        [TestCase("redbullring", 64.0)]
        [TestCase("interlagos", 70.0)]
        [TestCase("monza", 80.0)]
        public void PredictsALapNearTheRealPoleTime(string id, double pole)
        {
            var ideal = Profile(id).IdealLapTime();
            Assert.That(Math.Abs(ideal - pole) / pole, Is.LessThan(0.20),
                $"{id} comes out at {ideal:F1} s against a real {pole:F0} s");
        }

        [Test]
        public void FindsTheSameProfileEveryTime()
        {
            var line = new RacingLine(Circuits.Get("monza"));
            var a = new SpeedProfile(line, Car, Options);
            var b = new SpeedProfile(line, Car, Options);

            for (var i = 0; i < a.Target.Count; i++)
            {
                Assert.That(b.Target[i], Is.EqualTo(a.Target[i]).Within(0));
            }
        }

        [TestCaseSource(nameof(Ids))]
        public void WrapsRoundTheLapInBothDirections(string id)
        {
            var circuit = Circuits.Get(id);
            var profile = Profile(id);

            Assert.That(profile.At(circuit.Length + 30), Is.EqualTo(profile.At(30)).Within(1e-6));
            Assert.That(profile.At(-30), Is.EqualTo(profile.At(circuit.Length - 30)).Within(1e-6));
        }

        /// <summary>
        /// A corner with no curvature at all is a straight, and a straight is
        /// the ceiling. Worth pinning because the guard is an epsilon, and an
        /// epsilon that drifts turns every straight into a slow corner.
        /// </summary>
        [Test]
        public void TreatsAStraightAsAStraight()
        {
            Assert.That(SpeedProfile.CornerLimit(0, Car, Options),
                Is.EqualTo(Options.MaxSpeed).Within(0));
            Assert.That(SpeedProfile.CornerLimit(-1e-9, Car, Options),
                Is.EqualTo(Options.MaxSpeed).Within(0));
        }

        /// <summary>Sign is direction, not difficulty — a left is as fast as a right.</summary>
        [Test]
        public void DoesNotCareWhichWayTheCornerTurns()
        {
            foreach (var radius in new[] { 25.0, 60, 120 })
            {
                Assert.That(SpeedProfile.CornerLimit(1 / radius, Car, Options),
                    Is.EqualTo(SpeedProfile.CornerLimit(-1 / radius, Car, Options)).Within(1e-12));
            }
        }
    }
}
