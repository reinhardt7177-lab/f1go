using System;
using System.Collections.Generic;
using NUnit.Framework;

namespace MumuF1.Tests
{
    /// <summary>
    /// Standards every circuit has to meet, ported from
    /// <c>f1sim/tests/circuits.test.ts</c> and the surface half of
    /// <c>f1sim/tests/circuit.test.ts</c>.
    /// </summary>
    /// <remarks>
    /// These are the properties any layout must have to be driveable at all,
    /// applied to every circuit in the registry, so adding a new one cannot
    /// quietly ship a shape that launches cars off the road.
    ///
    /// The important one is closure of the <em>raw</em> layout. The spline
    /// closes the loop by construction, so the gap it reports is always tiny
    /// no matter how badly the section list integrates — a circuit whose
    /// sections end a kilometre from where they started still produces a
    /// closed spline, just one whose shape near the timing line is nothing
    /// like what was specified. Measuring the section integration directly is
    /// the only way to see that error, and Monza's first draft had it at
    /// eighteen per cent of a lap while every other check passed.
    /// </remarks>
    [TestFixture]
    public class CircuitTests
    {
        /// <summary>Every id in the registry, as NUnit test cases.</summary>
        private static IEnumerable<string> Ids
        {
            get
            {
                foreach (var id in Circuits.Specs.Keys) yield return id;
            }
        }

        /// <summary>Walk the section list exactly as <c>Circuit.Build</c> does.</summary>
        private static void Integrate(CircuitSpec spec, out double miss, out double length)
        {
            var totalTurn = 0.0;
            foreach (var s in spec.Sections)
            {
                if (s.Radius != 0) totalTurn += s.Length / s.Radius;
            }
            var scale = Math.Abs(totalTurn) > 1e-6
                ? Math.Sign(totalTurn) * 2 * Math.PI / totalTurn
                : 1.0;

            var heading = 0.0;
            var x = 0.0;
            var z = 0.0;
            length = 0;

            foreach (var s in spec.Sections)
            {
                length += s.Length;
                var turn = s.Radius != 0 ? s.Length / s.Radius * scale : 0;
                var steps = Math.Max(1, (int)Math.Round(s.Length, MidpointRounding.AwayFromZero));
                for (var i = 0; i < steps; i++)
                {
                    heading += turn / steps;
                    x += Math.Sin(heading) * (s.Length / steps);
                    z += Math.Cos(heading) * (s.Length / steps);
                }
            }

            miss = MathUtil.Hypot(x, z);
        }

        [TestCaseSource(nameof(Ids))]
        public void ClosesOnItselfBeforeTheSplineHasToHelp(string id)
        {
            Integrate(Circuits.Specs[id], out var miss, out var length);
            Assert.That(miss / length, Is.LessThan(0.04),
                $"{id} ends {miss:F0} m from where it started, over a {length:F0} m lap");
        }

        [TestCaseSource(nameof(Ids))]
        public void TurnsThroughExactlyOneRevolution(string id)
        {
            var circuit = Circuits.Get(id);
            var a = circuit.Spline.SampleAt(0).Tangent;
            var b = circuit.Spline.SampleAt(circuit.Length - 1).Tangent;
            Assert.That(Vec3.Dot(a, b), Is.GreaterThan(0.999));
        }

        [TestCaseSource(nameof(Ids))]
        public void HasNoKinkACarCouldBeThrownOff(string id)
        {
            var circuit = Circuits.Get(id);
            var worst = 0.0;

            for (var s = 0.0; s < circuit.Length; s += 2)
            {
                var p = circuit.Spline.SampleAt(s).Tangent;
                var q = circuit.Spline.SampleAt(s + 2).Tangent;
                worst = Math.Max(worst, Math.Acos(Math.Min(1, Vec3.Dot(p, q))));
            }

            Assert.That(worst, Is.LessThan(0.15),
                $"{id} turns {worst * MathUtil.Deg:F1} degrees across two metres");
        }

        /// <summary>
        /// A road laid over itself is a wall in the collider, and the only
        /// legitimate way two pieces of tarmac occupy the same ground plan is
        /// a bridge — which is genuine height separation, not an overlap.
        /// </summary>
        [TestCaseSource(nameof(Ids))]
        public void NeverLaysOnePieceOfRoadOverAnother(string id)
        {
            var circuit = Circuits.Get(id);
            var worst = double.NegativeInfinity;
            var where = string.Empty;

            for (var s1 = 0.0; s1 < circuit.Length; s1 += 8)
            {
                var p1 = circuit.Spline.SampleAt(s1).Position;
                for (var s2 = s1 + 250; s2 < circuit.Length; s2 += 8)
                {
                    if (circuit.Length - (s2 - s1) < 250) continue;
                    var p2 = circuit.Spline.SampleAt(s2).Position;
                    if (Math.Abs(p1.Y - p2.Y) > 6) continue;

                    var plan = MathUtil.Hypot(p1.X - p2.X, p1.Z - p2.Z);
                    var needed = circuit.HalfWidthAt(s1) + circuit.HalfWidthAt(s2);
                    if (needed - plan > worst)
                    {
                        worst = needed - plan;
                        where = $"{circuit.SectionAt(s1)} over {circuit.SectionAt(s2)}";
                    }
                }
            }

            Assert.That(worst, Is.LessThanOrEqualTo(0), $"{id} overlaps itself: {where}");
        }

        [TestCaseSource(nameof(Ids))]
        public void NamesEveryMetreOfTheLap(string id)
        {
            var circuit = Circuits.Get(id);
            for (var s = 0.0; s < circuit.Length; s += 137)
            {
                Assert.That(circuit.SectionAt(s), Is.Not.Null.And.Not.Empty);
            }
        }

        [TestCaseSource(nameof(Ids))]
        public void ReportsSectorSplitsThatRunInOrderAndEndAtTheLap(string id)
        {
            var splits = Circuits.Specs[id].SectorSplits;
            var circuit = Circuits.Get(id);

            for (var i = 1; i < splits.Count; i++)
            {
                Assert.That(splits[i], Is.GreaterThan(splits[i - 1]));
            }
            var last = splits[splits.Count - 1];
            Assert.That(Math.Abs(last - circuit.Length) / circuit.Length, Is.LessThan(0.05));
        }

        /// <summary>
        /// The lap distances the circuits are fitted to. Only the ones that
        /// model a real track carry this claim — the oval and the proving
        /// ground are instruments, and their length is whatever is convenient.
        /// </summary>
        [TestCase("monza", 5793)]
        [TestCase("redbullring", 4318)]
        [TestCase("interlagos", 4309)]
        public void ComesOutCloseToTheRealLapDistance(string id, double real)
        {
            var circuit = Circuits.Get(id);
            Assert.That(Math.Abs(circuit.Length - real) / real, Is.LessThan(0.06),
                $"{id} came out {circuit.Length:F0} m against a real {real:F0} m");
        }

        /// <summary>
        /// Building is cached, so the same id has to hand back the same
        /// object — a second build would be a second collider mesh and a
        /// second set of timing lines for one track.
        /// </summary>
        [Test]
        public void BuildsEachCircuitOnce()
        {
            Assert.That(Circuits.Get("oval"), Is.SameAs(Circuits.Get("oval")));
        }

        [Test]
        public void RefusesACircuitItDoesNotHave()
        {
            Assert.Throws<ArgumentException>(() => Circuits.Get("nurburgring"));
        }

        [Test]
        public void LaysOutTarmacKerbRunoffAndGrassOutwards()
        {
            var circuit = Circuits.Get("redbullring");
            const double s = 400;
            var w = circuit.HalfWidthAt(s);
            var k = circuit.KerbWidth;
            var r = circuit.RunoffAt(s);

            Assert.That(circuit.SurfaceAt(s, 0), Is.EqualTo(SurfaceKind.Tarmac));
            Assert.That(circuit.SurfaceAt(s, w - 0.1), Is.EqualTo(SurfaceKind.Tarmac));
            Assert.That(circuit.SurfaceAt(s, w + k * 0.5), Is.EqualTo(SurfaceKind.Kerb));
            Assert.That(circuit.SurfaceAt(s, w + k + r * 0.5), Is.EqualTo(SurfaceKind.Runoff));
            Assert.That(circuit.SurfaceAt(s, w + k + r + 5), Is.EqualTo(SurfaceKind.Grass));
        }

        [Test]
        public void IsSymmetricAboutTheCentreline()
        {
            var circuit = Circuits.Get("redbullring");
            const double s = 1200;
            foreach (var t in new double[] { 3, 8, 14, 30 })
            {
                Assert.That(circuit.SurfaceAt(s, t), Is.EqualTo(circuit.SurfaceAt(s, -t)));
            }
        }

        [Test]
        public void GripsBestOnTarmacAndWorstOnGrass()
        {
            Assert.That(Surface.Grip(SurfaceKind.Tarmac), Is.GreaterThan(Surface.Grip(SurfaceKind.Kerb)));
            Assert.That(Surface.Grip(SurfaceKind.Kerb), Is.GreaterThan(Surface.Grip(SurfaceKind.Runoff)));
            Assert.That(Surface.Grip(SurfaceKind.Runoff), Is.GreaterThan(Surface.Grip(SurfaceKind.Gravel)));
            Assert.That(Surface.Grip(SurfaceKind.Gravel), Is.GreaterThan(Surface.Grip(SurfaceKind.Grass)));
        }

        [Test]
        public void CallsACarWithinTheWhiteLinesOnTrack()
        {
            var circuit = Circuits.Get("redbullring");
            var w = circuit.HalfWidthAt(600);
            Assert.That(circuit.IsOnTrack(600, 0), Is.True);
            Assert.That(circuit.IsOnTrack(600, w - 0.2), Is.True);
            Assert.That(circuit.IsOnTrack(600, w + 0.5), Is.False);
        }

        /// <summary>
        /// Distance is periodic, so everything that reads it has to be. A
        /// car crossing the timing line moves from <c>length - 1</c> to
        /// <c>1</c>, and a lookup that clamped instead of wrapping would
        /// hold it on the last sample of the lap forever.
        /// </summary>
        [Test]
        public void ReadsTheProfileRoundTheSeamInBothDirections()
        {
            var circuit = Circuits.Get("oval");
            Assert.That(circuit.HalfWidthAt(circuit.Length + 25), Is.EqualTo(circuit.HalfWidthAt(25)).Within(1e-9));
            Assert.That(circuit.HalfWidthAt(-25), Is.EqualTo(circuit.HalfWidthAt(circuit.Length - 25)).Within(1e-9));
            Assert.That(circuit.SectionAt(-25), Is.EqualTo(circuit.SectionAt(circuit.Length - 25)));
        }

        [Test]
        public void PutsEveryDistanceInASectorAndTheLastSplitAtTheLap()
        {
            var circuit = Circuits.Get("interlagos");
            Assert.That(circuit.SectorSplits[circuit.SectorSplits.Count - 1],
                Is.EqualTo(circuit.Length).Within(1e-9));

            Assert.That(circuit.SectorAt(0), Is.EqualTo(0));
            Assert.That(circuit.SectorAt(circuit.Length - 1), Is.EqualTo(2));

            for (var s = 0.0; s < circuit.Length; s += 53)
            {
                var sector = circuit.SectorAt(s);
                Assert.That(sector, Is.InRange(0, circuit.SectorSplits.Count - 1));
            }
        }

        /// <summary>
        /// The banking blur exists because a step in banking is a wall across
        /// the road, and a wall across the road launches cars. Two passes of
        /// a 120 m window have to leave the oval's three and a half degrees
        /// changing by millimetres between one four-metre sample and the
        /// next, measured at the road edge where it is worst.
        /// </summary>
        [Test]
        public void RampsBankingInsteadOfSteppingIt()
        {
            var circuit = Circuits.Get("oval");
            var worst = 0.0;

            for (var s = 0.0; s < circuit.Length; s += 4)
            {
                var a = circuit.BankingAt(s);
                var b = circuit.BankingAt(s + 4);
                var edge = circuit.HalfWidthAt(s);
                worst = Math.Max(worst, Math.Abs(Math.Sin(b) - Math.Sin(a)) * edge);
            }

            Assert.That(worst, Is.LessThan(0.02),
                $"the road edge steps {worst * 1000:F0} mm between samples");
        }

        /// <summary>
        /// Blurring must not quietly flatten the banking it is smoothing —
        /// the oval is banked for a reason, and a filter that halved the
        /// angle would take the corner speed with it.
        /// </summary>
        [Test]
        public void KeepsTheBankingItRampsIn()
        {
            var circuit = Circuits.Get("oval");
            var deepest = 0.0;
            for (var s = 0.0; s < circuit.Length; s += 4)
            {
                deepest = Math.Max(deepest, Math.Abs(circuit.BankingAt(s)));
            }

            Assert.That(deepest, Is.GreaterThan(0.045), "the corners lost their banking");
            Assert.That(deepest, Is.LessThanOrEqualTo(0.06 + 1e-9), "the blur invented banking");
        }

        /// <summary>
        /// A gradient step is a kink of a few degrees, not a wall, so heights
        /// are smoothed rather than blurred — but the hills still have to be
        /// there afterwards. The Red Bull Ring climbs some eighty metres from
        /// Turn 1 to Remus, and the reference test asserts fifty.
        /// </summary>
        [Test]
        public void KeepsTheElevationAfterSmoothing()
        {
            var circuit = Circuits.Get("redbullring");
            var lowest = double.PositiveInfinity;
            var highest = double.NegativeInfinity;

            for (var s = 0.0; s < circuit.Length; s += 4)
            {
                var y = circuit.Spline.SampleAt(s).Position.Y;
                lowest = Math.Min(lowest, y);
                highest = Math.Max(highest, y);
            }

            Assert.That(highest - lowest, Is.GreaterThan(50));
            Assert.That(highest - lowest, Is.LessThan(120));
        }

        /// <summary>
        /// The flat circuits have to come out flat. Monza's real elevation
        /// change is a couple of metres, and the loop-closing ramp spreads
        /// the integration's mismatch over the whole lap — including in Y,
        /// where it would otherwise tilt the entire circuit.
        /// </summary>
        [TestCase("monza")]
        [TestCase("oval")]
        [TestCase("proving")]
        public void KeepsTheFlatCircuitsFlat(string id)
        {
            var circuit = Circuits.Get(id);
            var lowest = double.PositiveInfinity;
            var highest = double.NegativeInfinity;

            for (var s = 0.0; s < circuit.Length; s += 4)
            {
                var y = circuit.Spline.SampleAt(s).Position.Y;
                lowest = Math.Min(lowest, y);
                highest = Math.Max(highest, y);
            }

            Assert.That(highest - lowest, Is.LessThan(1.0), $"{id} is not level");
        }

        [TestCaseSource(nameof(Ids))]
        public void ClosesTheLoop(string id)
        {
            var circuit = Circuits.Get(id);
            var start = circuit.Spline.SampleAt(0).Position;
            var end = circuit.Spline.SampleAt(circuit.Length - 0.01).Position;
            Assert.That((start - end).Length, Is.LessThan(2));
        }

        [Test]
        public void NamesTheSectionYouAreDrivingThrough()
        {
            var circuit = Circuits.Get("redbullring");
            var names = new HashSet<string>(StringComparer.Ordinal);
            for (var s = 0.0; s < circuit.Length; s += 10) names.Add(circuit.SectionAt(s));

            Assert.That(names, Contains.Item("T1 Niki Lauda"));
            Assert.That(names, Contains.Item("Climb to Remus"));
            Assert.That(names, Contains.Item("T9 Rindt"));
        }

        /// <summary>
        /// The whole point of <c>(s, t)</c>: a point on the centreline has to
        /// project back to the distance it was sampled at, with no lateral
        /// offset. Everything downstream — lap counting, off-track detection,
        /// the racing line — is a one-liner only if this holds.
        /// </summary>
        [TestCaseSource(nameof(Ids))]
        public void ProjectsTheCentrelineBackOntoItself(string id)
        {
            var circuit = Circuits.Get(id);

            for (var s = 0.0; s < circuit.Length; s += 61)
            {
                var sample = circuit.Spline.SampleAt(s);
                var projection = circuit.Spline.Project(sample.Position);

                Assert.That(Math.Abs(projection.T), Is.LessThan(0.15),
                    $"{id} at {s:F0} m projects {projection.T:F2} m off the centreline");

                var slip = Math.Abs(projection.S - s);
                slip = Math.Min(slip, circuit.Length - slip);
                Assert.That(slip, Is.LessThan(1.5),
                    $"{id} at {s:F0} m projects back to {projection.S:F0} m");
            }
        }
    }
}
