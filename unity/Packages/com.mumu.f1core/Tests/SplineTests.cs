using System;
using System.Collections.Generic;
using NUnit.Framework;

namespace MumuF1.Tests
{
    /// <summary>
    /// The centreline, ported from <c>f1sim/tests/spline.test.ts</c> with
    /// the same assertions against the same numbers.
    /// </summary>
    /// <remarks>
    /// A circle is the right shape to test this on: its length, its
    /// curvature and the lateral offset of any point are all known
    /// exactly, so every claim can be checked against arithmetic rather
    /// than against a previous run.
    /// </remarks>
    [TestFixture]
    public class SplineTests
    {
        /// <summary>A circle of a known radius, as control points.</summary>
        private static List<Vec3> Circle(double radius = 100, int points = 16)
        {
            var list = new List<Vec3>(points);
            for (int i = 0; i < points; i++)
            {
                double a = (double)i / points * Math.PI * 2;
                list.Add(new Vec3(Math.Cos(a) * radius, 0, Math.Sin(a) * radius));
            }
            return list;
        }

        [Test]
        public void RejectsACentrelineTooShortToInterpolate()
        {
            Assert.Throws<ArgumentException>(() => new CenterlineSpline(
                new List<Vec3> { Vec3.Zero, new Vec3(1, 0, 0), new Vec3(2, 0, 0) }));
        }

        [Test]
        public void MeasuresTheLengthOfAKnownCircle()
        {
            var s = new CenterlineSpline(Circle(100, 32), 1);
            // Catmull-Rom through points on a circle is very slightly short.
            double circumference = 2 * Math.PI * 100;
            Assert.That(s.Length, Is.GreaterThan(circumference * 0.99));
            Assert.That(s.Length, Is.LessThan(circumference * 1.01));
        }

        [Test]
        public void KeepsEverySampleOnTheCircle()
        {
            var s = new CenterlineSpline(Circle(100, 32), 2);
            for (double d = 0; d < s.Length; d += 7)
            {
                Vec3 p = s.SampleAt(d).Position;
                Assert.That(MathUtil.Hypot(p.X, p.Z), Is.EqualTo(100.0).Within(0.5));
            }
        }

        [Test]
        public void ReportsCurvatureOfRoughlyOneOverRadius()
        {
            var s = new CenterlineSpline(Circle(100, 48), 1);
            double k = Math.Abs(s.SampleAt(s.Length * 0.3).Curvature);
            // 1/100 = 0.01, and the resampling costs a little either way.
            Assert.That(k, Is.GreaterThan(0.008));
            Assert.That(k, Is.LessThan(0.012));
        }

        [Test]
        public void ProjectsAPointWithTheRightLateralOffset()
        {
            var s = new CenterlineSpline(Circle(100, 32), 1);

            Projection outside = s.Project(new Vec3(110, 0, 0));
            Assert.That(Math.Abs(outside.T), Is.EqualTo(10.0).Within(0.5));

            Projection inside = s.Project(new Vec3(90, 0, 0));
            Assert.That(Math.Abs(inside.T), Is.EqualTo(10.0).Within(0.5));

            // The two must sit on opposite sides of the centreline.
            Assert.That(Math.Sign(outside.T), Is.EqualTo(-Math.Sign(inside.T)));
        }

        [Test]
        public void ReportsHeightSeparatelyFromLateralOffset()
        {
            var s = new CenterlineSpline(Circle(100, 32), 1);
            Projection p = s.Project(new Vec3(100, 3.5, 0));
            Assert.That(p.Height, Is.EqualTo(3.5).Within(0.05));
            Assert.That(Math.Abs(p.T), Is.LessThan(0.5));
        }

        [Test]
        public void AdvancesDistanceMonotonicallyAroundTheLap()
        {
            var s = new CenterlineSpline(Circle(100, 32), 1);
            double previous = -1;
            for (int i = 0; i < 40; i++)
            {
                double a = (double)i / 80 * Math.PI * 2;
                Projection p = s.Project(new Vec3(Math.Cos(a) * 100, 0, Math.Sin(a) * 100));
                Assert.That(p.S, Is.GreaterThan(previous));
                previous = p.S;
            }
        }

        [Test]
        public void GivesTheSameAnswerWithAndWithoutASearchHint()
        {
            /* The hint is what makes this affordable to call every tick
               for every car, so it has to be an optimisation and not a
               different answer. */
            var s = new CenterlineSpline(Circle(100, 32), 1);
            var point = new Vec3(0, 0, 104);

            Projection cold = s.Project(point);
            Projection hinted = s.Project(point, cold.S);

            Assert.That(hinted.S, Is.EqualTo(cold.S).Within(1e-6));
            Assert.That(hinted.T, Is.EqualTo(cold.T).Within(1e-6));
        }

        [Test]
        public void WrapsDistanceRoundAClosedLap()
        {
            // A closed circuit has no end, so asking past the line and
            // before the start both have to land back on the road.
            var s = new CenterlineSpline(Circle(100, 32), 1);
            Vec3 atZero = s.SampleAt(0).Position;

            Assert.That(Vec3.DistanceSquared(s.SampleAt(s.Length).Position, atZero),
                Is.LessThan(1e-6));
            Assert.That(Vec3.DistanceSquared(s.SampleAt(-s.Length).Position, atZero),
                Is.LessThan(1e-6));
        }

        [Test]
        public void TangentAndLeftAreUnitAndPerpendicular()
        {
            var s = new CenterlineSpline(Circle(100, 32), 1);
            for (double d = 0; d < s.Length; d += 11)
            {
                TrackSample sample = s.SampleAt(d);
                Assert.That(sample.Tangent.Length, Is.EqualTo(1.0).Within(1e-6));
                Assert.That(sample.Left.Length, Is.EqualTo(1.0).Within(1e-6));
                Assert.That(Vec3.Dot(sample.Tangent, sample.Left), Is.EqualTo(0.0).Within(1e-6));
            }
        }
    }
}
