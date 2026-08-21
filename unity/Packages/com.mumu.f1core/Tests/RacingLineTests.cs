using System;
using System.Collections.Generic;
using NUnit.Framework;

namespace MumuF1.Tests
{
    /// <summary>
    /// The racing line.
    /// </summary>
    /// <remarks>
    /// Two claims are worth more than the rest. The line must stay inside the
    /// white lines, because a driver following it off the circuit is worse
    /// than no driver at all. And its sharpest bend must be in a corner —
    /// road width is stated per section, so the constraint steps by a metre
    /// and a half between two stations at every boundary, and a line pinned
    /// to that step inherits it as a kink. Before that was eased, the tightest
    /// curvature on a circuit could be on a straight, and the speed profile
    /// reads curvature directly: the driver would brake for nothing.
    /// </remarks>
    [TestFixture]
    public class RacingLineTests
    {
        private static IEnumerable<string> Ids
        {
            get
            {
                foreach (var id in Circuits.Specs.Keys) yield return id;
            }
        }

        /// <summary>
        /// Six hundred relaxation passes over a thousand stations is not
        /// cheap and the answer never changes, so each circuit's line is
        /// found once for the whole fixture.
        /// </summary>
        private static readonly Dictionary<string, RacingLine> Lines =
            new Dictionary<string, RacingLine>(StringComparer.Ordinal);

        private static RacingLine Line(string id)
        {
            lock (Lines)
            {
                if (!Lines.TryGetValue(id, out var line))
                {
                    line = new RacingLine(Circuits.Get(id));
                    Lines[id] = line;
                }
                return line;
            }
        }

        private static readonly RacingLineOptions Defaults = new RacingLineOptions();

        /// <summary>The one that would put a car in the gravel.</summary>
        [TestCaseSource(nameof(Ids))]
        public void NeverLeavesTheRoad(string id)
        {
            var circuit = Circuits.Get(id);
            var line = Line(id);

            for (var i = 0; i < line.StationCount; i++)
            {
                var s = i * line.Spacing;
                var allowed = Math.Max(0, circuit.HalfWidthAt(s) - Defaults.Margin);

                Assert.That(Math.Abs(line.Offsets[i]), Is.LessThanOrEqualTo(allowed + 1e-3),
                    $"{id} puts the line {Math.Abs(line.Offsets[i]):F2} m out at {s:F0} m, "
                    + $"where only {allowed:F2} m is legal");
            }
        }

        /// <summary>
        /// It is a shortest-path approximation, so it has to be shorter than
        /// the centreline. Not by much — a lap is mostly straight — but a
        /// line that came out longer would mean the relaxation had not
        /// converged, or had converged on the wrong thing.
        /// </summary>
        [TestCaseSource(nameof(Ids))]
        public void IsShorterThanTheCentreline(string id)
        {
            var circuit = Circuits.Get(id);
            var line = Line(id);

            var length = 0.0;
            for (var i = 0; i < line.StationCount; i++)
            {
                var a = line.PointAt(i * line.Spacing);
                var b = line.PointAt((i + 1) % line.StationCount * line.Spacing);
                length += (a - b).Length;
            }

            var saved = 1 - length / circuit.Length;
            Assert.That(saved, Is.GreaterThan(0.005), $"{id} saved only {saved * 100:F2}%");
            Assert.That(saved, Is.LessThan(0.08), $"{id} claims to save {saved * 100:F2}%, which is not a lap");
        }

        /// <summary>
        /// The sharpest bend in the line must be somewhere the layout
        /// actually turns. This is the test the eased width constraint exists
        /// to pass.
        /// </summary>
        [TestCaseSource(nameof(Ids))]
        public void BendsHardestInACornerAndNeverOnAStraight(string id)
        {
            var circuit = Circuits.Get(id);
            var line = Line(id);

            var peak = 0.0;
            var where = 0.0;
            for (var i = 0; i < line.StationCount; i++)
            {
                var k = Math.Abs(line.Curvature[i]);
                if (k > peak)
                {
                    peak = k;
                    where = i * line.Spacing;
                }
            }

            var section = circuit.SectionAt(where);
            var radius = 0.0;
            foreach (var candidate in Circuits.Specs[id].Sections)
            {
                if (candidate.Name == section) radius = candidate.Radius;
            }

            Assert.That(radius, Is.Not.EqualTo(0),
                $"{id} bends hardest at {where:F0} m, in \"{section}\", which is a straight");
        }

        /// <summary>
        /// Round a long corner of constant radius the shortest path simply
        /// hugs the inside edge, so its radius is the corner's less the
        /// distance the line is allowed to move. The oval is 250 m and
        /// 9.5 m wide with 1.3 m of margin, which is 241.8 m — and that is
        /// arithmetic, not a number read off a previous run.
        /// </summary>
        [Test]
        public void HugsTheInsideOfAConstantCorner()
        {
            var line = Line("oval");
            var peak = 0.0;
            for (var i = 0; i < line.StationCount; i++)
            {
                peak = Math.Max(peak, Math.Abs(line.Curvature[i]));
            }

            var expected = 250.0 - (9.5 - Defaults.Margin);
            Assert.That(1 / peak, Is.EqualTo(expected).Within(6));
        }

        /// <summary>
        /// The speed profile turns curvature straight into a target speed, so
        /// a step between neighbouring stations is a step in the throttle.
        /// </summary>
        [TestCaseSource(nameof(Ids))]
        public void KeepsTheCurvatureSmoothEnoughToDriveTo(string id)
        {
            var line = Line(id);
            var worst = 0.0;

            for (var i = 0; i < line.StationCount; i++)
            {
                var j = (i + 1) % line.StationCount;
                worst = Math.Max(worst, Math.Abs(line.Curvature[j] - line.Curvature[i]));
            }

            Assert.That(worst, Is.LessThan(0.01),
                $"{id} steps {worst:F5} in curvature between two stations");
        }

        /// <summary>
        /// A circuit is learned against the line the rivals drive. One that
        /// differed between loads would be a different circuit each time.
        /// </summary>
        [Test]
        public void FindsTheSameLineEveryTime()
        {
            var circuit = Circuits.Get("interlagos");
            var a = new RacingLine(circuit);
            var b = new RacingLine(circuit);

            Assert.That(b.StationCount, Is.EqualTo(a.StationCount));
            for (var i = 0; i < a.StationCount; i++)
            {
                Assert.That(b.Offsets[i], Is.EqualTo(a.Offsets[i]).Within(0));
                Assert.That(b.Curvature[i], Is.EqualTo(a.Curvature[i]).Within(0));
            }
        }

        /// <summary>
        /// The line's world position has to be the centreline's plus the
        /// offset along the road's left. If those two ever disagree, the
        /// driver aims at one place and the timing reads another.
        /// </summary>
        [TestCaseSource(nameof(Ids))]
        public void PutsThePointWhereTheOffsetSaysItIs(string id)
        {
            var circuit = Circuits.Get(id);
            var line = Line(id);

            for (var s = 0.0; s < circuit.Length; s += 37)
            {
                var sample = circuit.Spline.SampleAt(s);
                var expected = sample.Position + sample.Left * line.OffsetAt(s);
                Assert.That((line.PointAt(s) - expected).Length, Is.LessThan(1e-9));
            }
        }

        /// <summary>
        /// A closed circuit has no end, and a car crossing the timing line
        /// asks for the line just past it.
        /// </summary>
        [TestCaseSource(nameof(Ids))]
        public void WrapsRoundTheLapInBothDirections(string id)
        {
            var circuit = Circuits.Get(id);
            var line = Line(id);

            Assert.That(line.OffsetAt(circuit.Length + 40),
                Is.EqualTo(line.OffsetAt(40)).Within(1e-9));
            Assert.That(line.OffsetAt(-40),
                Is.EqualTo(line.OffsetAt(circuit.Length - 40)).Within(1e-9));
            Assert.That(line.CurvatureAt(-40),
                Is.EqualTo(line.CurvatureAt(circuit.Length - 40)).Within(1e-9));
        }

        [TestCaseSource(nameof(Ids))]
        public void HoldsNoDegenerateValues(string id)
        {
            var line = Line(id);
            for (var i = 0; i < line.StationCount; i++)
            {
                Assert.That(float.IsNaN(line.Offsets[i]) || float.IsInfinity(line.Offsets[i]), Is.False);
                Assert.That(float.IsNaN(line.Curvature[i]) || float.IsInfinity(line.Curvature[i]), Is.False);
            }
        }
    }
}
