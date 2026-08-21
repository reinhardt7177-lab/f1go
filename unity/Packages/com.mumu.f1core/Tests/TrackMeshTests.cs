using System;
using System.Collections.Generic;
using NUnit.Framework;

namespace MumuF1.Tests
{
    /// <summary>
    /// The swept road, ported from the track-mesh block of
    /// <c>f1sim/tests/circuit.test.ts</c> and extended.
    /// </summary>
    /// <remarks>
    /// The mesh is the collider, so every claim here is a claim about what a
    /// car can hit, not about what it looks like. A fold in the cross-section
    /// is a sheet of grass lying over the racing line; a gap at the seam is a
    /// hole a car crossing the timing line drops through.
    /// </remarks>
    [TestFixture]
    public class TrackMeshTests
    {
        private const double Spacing = 8;

        private static IEnumerable<string> Ids
        {
            get
            {
                foreach (var id in Circuits.Specs.Keys) yield return id;
            }
        }

        private static Vec3 Vertex(TrackGeometry g, int index) => new Vec3(
            g.Positions[index * 3],
            g.Positions[index * 3 + 1],
            g.Positions[index * 3 + 2]);

        /// <summary>
        /// Sweeping is the expensive part — the proximity clamp compares
        /// every ring with every other — and the result never changes, so
        /// the fixture builds each circuit once rather than once per test.
        /// </summary>
        private static readonly Dictionary<string, TrackGeometry> Swept =
            new Dictionary<string, TrackGeometry>(StringComparer.Ordinal);

        private static TrackGeometry Build(string id)
        {
            lock (Swept)
            {
                if (!Swept.TryGetValue(id, out var geometry))
                {
                    geometry = TrackMesh.Build(Circuits.Get(id), Spacing);
                    Swept[id] = geometry;
                }
                return geometry;
            }
        }

        [Test]
        public void ProducesAClosedIndexedMesh()
        {
            var g = Build("redbullring");
            Assert.That(g.VertexCount, Is.GreaterThan(1000));
            Assert.That(g.TriangleCount, Is.GreaterThan(2000));
            Assert.That(g.Indices.Length % 3, Is.EqualTo(0));
            Assert.That(g.VertexCount, Is.EqualTo(g.Rings * g.Across));
        }

        [TestCaseSource(nameof(Ids))]
        public void IndexesOnlyVerticesThatExist(string id)
        {
            var g = Build(id);
            var max = 0;
            var min = int.MaxValue;
            foreach (var i in g.Indices)
            {
                if (i > max) max = i;
                if (i < min) min = i;
            }
            Assert.That(min, Is.GreaterThanOrEqualTo(0));
            Assert.That(max, Is.LessThan(g.VertexCount));
        }

        [TestCaseSource(nameof(Ids))]
        public void HoldsNoDegenerateCoordinates(string id)
        {
            var g = Build(id);
            foreach (var v in g.Positions)
            {
                Assert.That(float.IsNaN(v) || float.IsInfinity(v), Is.False);
            }
            foreach (var v in g.Normals)
            {
                Assert.That(float.IsNaN(v) || float.IsInfinity(v), Is.False);
            }
        }

        /// <summary>
        /// Otherwise a car crossing the timing line drops through the seam.
        /// The last ring is stitched to the first, so the two have to be one
        /// station's spacing apart and no more.
        /// </summary>
        [TestCaseSource(nameof(Ids))]
        public void WrapsTheLastRingBackOntoTheFirst(string id)
        {
            var g = Build(id);
            var lastRing = (g.Rings - 1) * g.Across;

            for (var k = 0; k < g.Across; k++)
            {
                var gap = (Vertex(g, k) - Vertex(g, lastRing + k)).Length;
                Assert.That(gap, Is.LessThan(Spacing * 2.5),
                    $"{id} leaves a {gap:F1} m step across the timing line at station {k}");
            }
        }

        /// <summary>
        /// The road itself is never clamped away. Both clamps exist to stop
        /// the verges reaching somewhere they should not, and a circuit that
        /// narrowed its own tarmac to fix its scenery would be fixing the
        /// wrong thing.
        /// </summary>
        [TestCaseSource(nameof(Ids))]
        public void NeverNarrowsTheRoadItself(string id)
        {
            var circuit = Circuits.Get(id);
            var g = Build(id);

            for (var ring = 0; ring < g.Rings; ring++)
            {
                var s = (double)ring / g.Rings * circuit.Length;
                var start = ring * g.Across;

                // The cross-section is kept strictly ordered, so the widest
                // pair is always the first station and the last.
                var widest = (Vertex(g, start) - Vertex(g, start + g.Across - 1)).Length;

                Assert.That(widest, Is.GreaterThanOrEqualTo(2 * circuit.HalfWidthAt(s) - 0.05),
                    $"{id} pinched to {widest:F1} m at {s:F0} m");
            }
        }

        /// <summary>
        /// No quad may turn inside out.
        /// </summary>
        /// <remarks>
        /// Both clamps move stations rather than dropping them, so a clamped
        /// station lands on top of its neighbour and the quad between them
        /// degenerates to nothing — which draws as nothing. What must never
        /// happen is for it to move <em>past</em> its neighbour, because then
        /// the quad inverts, its normal flips, and the collider grows a
        /// surface facing into the ground.
        /// </remarks>
        [TestCaseSource(nameof(Ids))]
        public void NeverTurnsAQuadInsideOut(string id)
        {
            var g = Build(id);

            for (var ring = 0; ring < g.Rings; ring++)
            {
                var start = ring * g.Across;
                var axis = (Vertex(g, start + g.Across - 1) - Vertex(g, start)).Normalised();

                var previous = double.NegativeInfinity;
                for (var k = 0; k < g.Across; k++)
                {
                    var along = Vec3.Dot(Vertex(g, start + k) - Vertex(g, start), axis);
                    Assert.That(along, Is.GreaterThanOrEqualTo(previous - 0.005),
                        $"{id} station {k} of ring {ring} sits behind station {k - 1}");
                    previous = along;
                }
            }
        }

        /// <summary>
        /// The cross-section is read from the template rather than written
        /// down twice, so the drawn edges and the barrier line have to come
        /// out of the sweep itself. Two barriers — one each side — and the
        /// ink lines paired about the centre.
        /// </summary>
        [Test]
        public void FindsItsOwnEdgesAndBarriers()
        {
            var g = Build("monza");

            Assert.That(g.BarrierStations.Length, Is.EqualTo(2));
            Assert.That(g.BarrierStations[0], Is.LessThan(g.Across / 2));
            Assert.That(g.BarrierStations[1], Is.GreaterThan(g.Across / 2));

            Assert.That(g.InkStations.Length, Is.EqualTo(6));
            foreach (var ink in g.InkStations)
            {
                Assert.That(ink.Width, Is.GreaterThan(0));
                Assert.That(ink.Station, Is.InRange(0, g.Across - 1));
            }
        }

        /// <summary>
        /// A kerb painted one flat colour is the single clearest tell that a
        /// road is not a race track, so the sweep has to alternate along its
        /// length — and both halves of the stripe have to actually appear.
        /// </summary>
        [Test]
        public void PaintsTheKerbsInStripes()
        {
            var g = Build("oval");
            var red = 0;
            var pale = 0;

            for (var v = 0; v < g.VertexCount; v++)
            {
                if (g.Surfaces[v] != SurfaceKind.Kerb) continue;
                // The red half is 0.88, 0.18, 0.18; the pale half is near white.
                if (g.Colors[v * 3 + 1] < 0.5f) red++;
                else pale++;
            }

            Assert.That(red, Is.GreaterThan(0), "no red kerb");
            Assert.That(pale, Is.GreaterThan(0), "no pale kerb");
        }

        /// <summary>
        /// Paint is a colour, not a surface. The white line just inside the
        /// kerb has to read as tarmac to the car, because a white line is
        /// paint on tarmac and a driver putting a wheel on one loses nothing.
        /// </summary>
        [Test]
        public void KeepsPaintOnTopOfTarmacRatherThanInsteadOfIt()
        {
            var g = Build("monza");
            var whiteOnTarmac = 0;

            for (var v = 0; v < g.VertexCount; v++)
            {
                if (g.Surfaces[v] != SurfaceKind.Tarmac) continue;
                if (g.Colors[v * 3] > 0.9f && g.Colors[v * 3 + 2] > 0.9f) whiteOnTarmac++;
            }

            Assert.That(whiteOnTarmac, Is.GreaterThan(0), "the racing circuit has no white lines");
        }

        /// <summary>
        /// Two parts of the circuit that pass close in plan may not sweep
        /// their verges through each other.
        /// </summary>
        /// <remarks>
        /// This is what the overlap check in the circuit tests cannot see: it
        /// compares half-width only, so the verges are outside what it
        /// measures at all, and it skips pairs closer than 250 m along the
        /// lap, which is exactly where a hairpin puts them. A 24 m hairpin
        /// leaves its two straights 48 m apart and about 150 m apart around
        /// the lap — invisible to that check, and unmissable on screen.
        ///
        /// Measured on the swept vertices rather than on the limits the
        /// sweep computed, so dropping the clamp on the way into the
        /// cross-section fails here. The road itself is the one exception:
        /// a circuit that narrowed its own tarmac to fix its scenery would
        /// be fixing the wrong thing, so a ring may always reach far enough
        /// to carry its road and kerb.
        /// </remarks>
        [TestCaseSource(nameof(Ids))]
        public void NeverSweepsTheVergesThroughEachOther(string id)
        {
            var circuit = Circuits.Get(id);
            var g = Build(id);
            var ringSpacing = circuit.Length / g.Rings;

            var centres = new Vec3[g.Rings];
            var reach = new double[g.Rings];
            var floor = new double[g.Rings];

            for (var ring = 0; ring < g.Rings; ring++)
            {
                var s = (double)ring / g.Rings * circuit.Length;
                var start = ring * g.Across;
                centres[ring] = circuit.Spline.SampleAt(s).Position;
                reach[ring] = Math.Max(
                    (Vertex(g, start) - centres[ring]).Length,
                    (Vertex(g, start + g.Across - 1) - centres[ring]).Length);
                floor[ring] = circuit.HalfWidthAt(s) + circuit.KerbWidth + 0.5;
            }

            for (var i = 0; i < g.Rings; i++)
            {
                for (var j = i + 1; j < g.Rings; j++)
                {
                    if (Math.Abs(centres[i].Y - centres[j].Y) > 4) continue;

                    var plan = MathUtil.Hypot(centres[i].X - centres[j].X, centres[i].Z - centres[j].Z);
                    var alongLap = Math.Min(j - i, g.Rings - (j - i)) * ringSpacing;

                    // Same road, not two — see ProximityLimits for why the
                    // test is a ratio and not a fixed separation.
                    if (alongLap < 40 || alongLap < plan * 1.5) continue;

                    var allowed = Math.Max(plan / 2, floor[i]) + 0.2;
                    Assert.That(reach[i], Is.LessThanOrEqualTo(allowed),
                        $"{id} ring {i} reaches {reach[i]:F1} m with ring {j} only "
                        + $"{plan:F1} m away");
                }
            }
        }

        /// <summary>
        /// Banking tilts the cross-section about the tangent, so the road
        /// surface leans — and the per-vertex normal has to lean with it, or
        /// the flat shading paints a banked corner as though it were level.
        /// </summary>
        [Test]
        public void LeansTheRoadAndItsNormalsIntoTheBanking()
        {
            var g = Build("oval");
            var steepest = 0.0;

            for (var ring = 0; ring < g.Rings; ring++)
            {
                var n = new Vec3(
                    g.Normals[ring * g.Across * 3],
                    g.Normals[ring * g.Across * 3 + 1],
                    g.Normals[ring * g.Across * 3 + 2]);
                steepest = Math.Max(steepest, Math.Acos(MathUtil.Clamp(n.Y, -1, 1)));
            }

            // The oval banks at 0.06 rad; nothing should exceed that.
            Assert.That(steepest, Is.GreaterThan(0.05), "the banking never reached the mesh");
            Assert.That(steepest, Is.LessThan(0.07), "the mesh banks more than the circuit does");
        }

        /// <summary>
        /// A flat circuit has to sweep flat normals, or every straight is
        /// shaded as though it were cambered.
        /// </summary>
        [Test]
        public void SweepsAFlatCircuitFlat()
        {
            var g = Build("monza");

            for (var ring = 0; ring < g.Rings; ring++)
            {
                var y = g.Normals[ring * g.Across * 3 + 1];
                Assert.That(y, Is.GreaterThan(0.999f));
            }
        }
    }
}
