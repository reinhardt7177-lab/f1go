using System;
using System.Collections.Generic;
using NUnit.Framework;

namespace MumuF1.Tests
{
    /// <summary>
    /// The shapes that stand beside the road.
    /// </summary>
    /// <remarks>
    /// The check that earns its keep is orientation. A mesh wound the wrong
    /// way round is invisible from outside and solid from inside — a bug you
    /// cannot see coming by reading the code and cannot miss on screen, and
    /// there is no screen here. Signed volume settles it mechanically: a
    /// closed surface wound anticlockwise seen from outside encloses positive
    /// volume, and one wound the other way encloses negative. It caught the
    /// cylinder the first time this ran, which would have made every trunk,
    /// pole and flagstaff in the game invisible.
    /// </remarks>
    [TestFixture]
    public class PropMeshTests
    {
        private static IEnumerable<string> Ids
        {
            get
            {
                foreach (var id in Circuits.Specs.Keys) yield return id;
            }
        }

        private static Array Kinds => Enum.GetValues(typeof(PropKind));

        private static Vec3 Vertex(Mesh3 m, int index) => new Vec3(
            m.Positions[index * 3], m.Positions[index * 3 + 1], m.Positions[index * 3 + 2]);

        private static Vec3 Normal(Mesh3 m, int index) => new Vec3(
            m.Normals[index * 3], m.Normals[index * 3 + 1], m.Normals[index * 3 + 2]);

        /// <summary>
        /// Every prop is a closed solid wound outward.
        /// </summary>
        /// <remarks>
        /// The tetrahedron formula: six times the volume is the sum of
        /// <c>a · (b × c)</c> over every triangle, taken about any origin.
        /// It is signed, so it is exactly the question being asked.
        /// </remarks>
        [TestCaseSource(nameof(Kinds))]
        public void IsWoundOutward(PropKind kind)
        {
            var m = PropMesh.Build(kind);
            var six = 0.0;

            for (var t = 0; t < m.TriangleCount; t++)
            {
                var a = Vertex(m, m.Indices[t * 3]);
                var b = Vertex(m, m.Indices[t * 3 + 1]);
                var c = Vertex(m, m.Indices[t * 3 + 2]);
                six += Vec3.Dot(a, Vec3.Cross(b, c));
            }

            Assert.That(six / 6.0, Is.GreaterThan(0),
                $"{kind} is inside out — it would be invisible from outside");
        }

        /// <summary>
        /// Each triangle carries its own three vertices and its own normal,
        /// because the shading is four hard bands and a shared vertex
        /// averages away the facets the style is made of.
        /// </summary>
        [TestCaseSource(nameof(Kinds))]
        public void FlatShadesEveryTriangle(PropKind kind)
        {
            var m = PropMesh.Build(kind);

            Assert.That(m.VertexCount, Is.EqualTo(m.TriangleCount * 3));
            Assert.That(m.Indices.Length, Is.EqualTo(m.VertexCount));
            Assert.That(m.Normals.Length, Is.EqualTo(m.Positions.Length));
            Assert.That(m.Colors.Length, Is.EqualTo(m.Positions.Length));

            for (var v = 0; v < m.VertexCount; v++)
            {
                Assert.That(Normal(m, v).Length, Is.EqualTo(1.0).Within(1e-5));
            }
        }

        /// <summary>
        /// The stored normal has to be the triangle's own normal. If these
        /// drift apart the light comes from the wrong side of every facet.
        /// </summary>
        [TestCaseSource(nameof(Kinds))]
        public void GivesEveryTriangleItsOwnNormal(PropKind kind)
        {
            var m = PropMesh.Build(kind);

            for (var t = 0; t < m.TriangleCount; t++)
            {
                var a = Vertex(m, m.Indices[t * 3]);
                var b = Vertex(m, m.Indices[t * 3 + 1]);
                var c = Vertex(m, m.Indices[t * 3 + 2]);

                var face = Vec3.Cross(b - a, c - a);
                Assert.That(face.Length, Is.GreaterThan(1e-9), $"{kind} has a degenerate triangle");

                var expected = face * (1.0 / face.Length);
                for (var k = 0; k < 3; k++)
                {
                    Assert.That(Vec3.Dot(Normal(m, m.Indices[t * 3 + k]), expected),
                        Is.EqualTo(1.0).Within(1e-5),
                        $"{kind} triangle {t} is lit from the wrong side");
                }
            }
        }

        /// <summary>
        /// Foot at zero. Everything is placed on the ground, so a shape
        /// centred on its own middle sinks half of itself into the verge.
        /// </summary>
        [TestCaseSource(nameof(Kinds))]
        public void StandsOnTheGround(PropKind kind)
        {
            var m = PropMesh.Build(kind);
            var lowest = double.PositiveInfinity;
            var highest = double.NegativeInfinity;

            for (var v = 0; v < m.VertexCount; v++)
            {
                lowest = Math.Min(lowest, m.Positions[v * 3 + 1]);
                highest = Math.Max(highest, m.Positions[v * 3 + 1]);
            }

            Assert.That(lowest, Is.EqualTo(0.0).Within(1e-6), $"{kind} does not sit on the ground");
            Assert.That(highest, Is.GreaterThan(1.0), $"{kind} is flat on the floor");
        }

        [TestCaseSource(nameof(Kinds))]
        public void PaintsEveryVertexInRange(PropKind kind)
        {
            var m = PropMesh.Build(kind);
            foreach (var c in m.Colors)
            {
                Assert.That(c, Is.InRange(0f, 1f));
            }
        }

        /// <summary>
        /// Cheap enough to scatter. Monza places four hundred and forty-five
        /// of these, and they are merged into one buffer — a prop that cost
        /// a thousand triangles would put half a million on a roadside
        /// nobody looks at directly.
        /// </summary>
        [TestCaseSource(nameof(Kinds))]
        public void StaysCheapEnoughToScatter(PropKind kind)
        {
            var m = PropMesh.Build(kind);
            Assert.That(m.TriangleCount, Is.GreaterThan(8));
            Assert.That(m.TriangleCount, Is.LessThan(160), $"{kind} is too heavy to scatter");
        }

        [Test]
        public void BuildsOneOfEveryKind()
        {
            var all = PropMesh.All();
            Assert.That(all.Count, Is.EqualTo(Kinds.Length));
            foreach (PropKind kind in Kinds)
            {
                Assert.That(all[kind].TriangleCount, Is.GreaterThan(0));
            }
        }

        /// <summary>
        /// A cone of seven sides is a seven-sided pyramid, and its volume is
        /// the heptagon's rather than the circle's — <c>(n/2) r² sin(2π/n)</c>
        /// against <c>π r²</c>, which is 87.1 per cent at seven sides. The
        /// conifer is three such cones on a trunk, so if the tiers ever stop
        /// being cones this number moves.
        /// </summary>
        [Test]
        public void BuildsTiersThatAreActuallyCones()
        {
            var m = PropMesh.Build(PropKind.Conifer);
            var six = 0.0;
            for (var t = 0; t < m.TriangleCount; t++)
            {
                var a = Vertex(m, m.Indices[t * 3]);
                var b = Vertex(m, m.Indices[t * 3 + 1]);
                var c = Vertex(m, m.Indices[t * 3 + 2]);
                six += Vec3.Dot(a, Vec3.Cross(b, c));
            }

            // Three tiers as true cones, plus a trunk of about 0.16 m³.
            var trueCones = Math.PI / 3 * (2.9 * 2.9 * 3.4 + 2.2 * 2.2 * 3.2 + 1.4 * 1.4 * 2.8);
            var heptagon = 7.0 / 2 * Math.Sin(2 * Math.PI / 7) / Math.PI;

            Assert.That(six / 6.0, Is.EqualTo(trueCones * heptagon).Within(0.5));
        }

        /// <summary>
        /// The gantry stands beside every circuit, not on it.
        /// </summary>
        /// <remarks>
        /// Its legs were at a fixed 12.4 m with a comment saying that was
        /// the widest half-width any circuit here used, plus its kerb. That
        /// was true when it was written. Then the Proving Ground was added,
        /// whose road is sixty metres across, and nothing re-read the
        /// comment — so two six-metre concrete legs stood seventeen metres
        /// inside the racing surface at the one place every lap begins.
        ///
        /// Only the legs are measured. The beam is meant to span the road
        /// and the light panel is meant to be the size of a light panel, so
        /// the test isolates everything below five metres, which is legs and
        /// nothing else.
        /// </remarks>
        [TestCaseSource(nameof(Ids))]
        public void StandsTheGantryBesideTheRoadAndNotOnIt(string id)
        {
            var circuit = Circuits.Get(id);
            var mesh = PropMesh.Build(PropKind.StartGantry, PropMesh.LegsFor(circuit));

            var road = circuit.HalfWidthAt(circuit.Spec.StartLine % circuit.Length)
                + circuit.KerbWidth;

            var nearest = double.PositiveInfinity;
            for (var v = 0; v < mesh.Positions.Length; v += 3)
            {
                if (mesh.Positions[v + 1] >= 5.0) continue;
                nearest = Math.Min(nearest, Math.Abs(mesh.Positions[v]));
            }

            Assert.That(nearest, Is.GreaterThan(road),
                $"a gantry leg stands {nearest:F1} m out on a road {road:F1} m wide");
        }

        /// <summary>And the beam still reaches from one leg to the other.</summary>
        [TestCaseSource(nameof(Ids))]
        public void SpansTheRoadItStandsOver(string id)
        {
            var circuit = Circuits.Get(id);
            var legs = PropMesh.LegsFor(circuit);
            var mesh = PropMesh.Build(PropKind.StartGantry, legs);

            var widest = 0.0;
            for (var v = 0; v < mesh.Positions.Length; v += 3)
            {
                if (mesh.Positions[v + 1] < 6.5) continue;
                widest = Math.Max(widest, Math.Abs(mesh.Positions[v]));
            }

            Assert.That(widest, Is.GreaterThanOrEqualTo(legs),
                "the beam stops short of the legs holding it up");
        }
    }
}
