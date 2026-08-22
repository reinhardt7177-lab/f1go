using NUnit.Framework;

namespace MumuF1.Tests
{
    /// <summary>
    /// The line the lap is measured from.
    /// </summary>
    /// <remarks>
    /// It is a flat marking laid on the road, so the checks are about where
    /// it lies rather than what it encloses: face up, sit on the road, stay
    /// inside the tarmac, and land on the distance the timer measures from.
    /// A line that misses any of those is one nobody can use to judge a lap.
    /// </remarks>
    [TestFixture]
    public class StartLineMeshTests
    {
        private static readonly string[] Ids =
            { "oval", "redbullring", "interlagos", "monza", "proving" };

        private static Vec3 Vertex(Mesh3 m, int i) => new Vec3(
            m.Positions[i * 3], m.Positions[i * 3 + 1], m.Positions[i * 3 + 2]);

        private static Vec3 Normal(Mesh3 m, int i) => new Vec3(
            m.Normals[i * 3], m.Normals[i * 3 + 1], m.Normals[i * 3 + 2]);

        [TestCaseSource(nameof(Ids))]
        public void EveryFaceLooksUp(string id)
        {
            var circuit = Circuits.Get(id);
            var m = StartLineMesh.Build(circuit);

            Assert.That(m.TriangleCount, Is.GreaterThan(0), "nothing was drawn");

            for (var v = 0; v < m.VertexCount; v++)
            {
                Assert.That(Normal(m, v).Y, Is.GreaterThan(0.9),
                    $"a face of the line is not facing the sky ({id})");
            }
        }

        /// <summary>
        /// It sits on the road, not in it and not above it.
        /// </summary>
        /// <remarks>
        /// Thirty millimetres, which has to clear the depth buffer without
        /// being something the car can notice. The floor runs at eighty, so
        /// there is no case where the two meet.
        ///
        /// Re-derived from the banking rather than compared against a flat
        /// road, so this still means something on a circuit whose timing
        /// line is on a banked section. None here is, today.
        /// </remarks>
        [TestCaseSource(nameof(Ids))]
        public void LiesOnTheRoadSurface(string id)
        {
            var circuit = Circuits.Get(id);
            var m = StartLineMesh.Build(circuit);
            var line = circuit.Spec.StartLine % circuit.Length;

            for (var v = 0; v < m.VertexCount; v++)
            {
                var p = Vertex(m, v);
                var projection = circuit.Spline.Project(p, line);
                var banking = circuit.BankingAt(projection.S);

                /* The road at that lateral offset is `t sin b` above the
                   centreline, and the marking is `0.03 cos b` above that
                   along the surface normal. */
                var expected = projection.T * System.Math.Sin(banking)
                             + 0.03 * System.Math.Cos(banking);

                Assert.That(projection.Height, Is.EqualTo(expected).Within(0.01),
                    $"the line is not lying on the road ({id})");
            }
        }

        [TestCaseSource(nameof(Ids))]
        public void StaysOnTheTarmacAndSpansIt(string id)
        {
            var circuit = Circuits.Get(id);
            var m = StartLineMesh.Build(circuit);
            var line = circuit.Spec.StartLine % circuit.Length;
            var halfWidth = circuit.HalfWidthAt(line);

            var widest = 0.0;

            for (var v = 0; v < m.VertexCount; v++)
            {
                var t = circuit.Spline.Project(Vertex(m, v), line).T;
                /* A centimetre of slack, because the mesh stores its
                   positions as floats and this reads them back as doubles
                   through a projection. */
                Assert.That(System.Math.Abs(t), Is.LessThanOrEqualTo(halfWidth + 0.01),
                    $"the line overhangs the kerb ({id})");
                widest = System.Math.Max(widest, System.Math.Abs(t));
            }

            Assert.That(widest, Is.EqualTo(halfWidth).Within(0.05),
                $"the line does not reach the edge of the road ({id})");
        }

        /// <summary>
        /// It is drawn where the lap is timed from, and nowhere else.
        /// </summary>
        [TestCaseSource(nameof(Ids))]
        public void SitsAtTheTimingLine(string id)
        {
            var circuit = Circuits.Get(id);
            var m = StartLineMesh.Build(circuit);
            var line = circuit.Spec.StartLine % circuit.Length;

            for (var v = 0; v < m.VertexCount; v++)
            {
                var s = circuit.Spline.Project(Vertex(m, v), line).S;
                var d = System.Math.Abs(s - line);
                d = System.Math.Min(d, circuit.Length - d);

                Assert.That(d, Is.LessThanOrEqualTo(0.75),
                    $"part of the line is not at the timing line ({id})");
            }
        }

        /// <summary>Two colours, so it reads as squares rather than a band.</summary>
        [Test]
        public void IsChequered()
        {
            var m = StartLineMesh.Build(Circuits.Get("monza"));
            var pale = 0;
            var ink = 0;

            for (var v = 0; v < m.VertexCount; v++)
            {
                if (m.Colors[v * 3] > 0.5f) pale++;
                else ink++;
            }

            Assert.That(pale, Is.GreaterThan(0));
            Assert.That(ink, Is.GreaterThan(0));
        }
    }
}
