using NUnit.Framework;

namespace MumuF1.Tests
{
    /// <summary>
    /// The car's own geometry.
    /// </summary>
    /// <remarks>
    /// The same check the props get, for the same reason: a surface wound the
    /// wrong way round is invisible from outside and solid from inside, which
    /// cannot be seen by reading the code. It matters more here, because the
    /// hull is lofted rather than assembled from primitives — a loft gets its
    /// winding from the order two rings are walked in, and getting that
    /// backwards turns the whole car inside out at once rather than one face
    /// of one box.
    ///
    /// The rest is dimensional. A car is the one object in the game whose
    /// size the player can check by eye against the road it is on, and the
    /// numbers it has to agree with — the wheelbase, the track, how far the
    /// wheels hang below the hull — belong to the chassis, not to the mesh.
    /// </remarks>
    [TestFixture]
    public class CarMeshTests
    {
        private static Vec3 Vertex(Mesh3 m, int index) => new Vec3(
            m.Positions[index * 3], m.Positions[index * 3 + 1], m.Positions[index * 3 + 2]);

        private static double SixVolume(Mesh3 m)
        {
            var six = 0.0;
            for (var t = 0; t < m.TriangleCount; t++)
            {
                var a = Vertex(m, m.Indices[t * 3]);
                var b = Vertex(m, m.Indices[t * 3 + 1]);
                var c = Vertex(m, m.Indices[t * 3 + 2]);
                six += Vec3.Dot(a, Vec3.Cross(b, c));
            }
            return six;
        }

        private static Bounds3 Box(Mesh3 m) => Bounds3.Around(m.Positions, m.VertexCount);

        [Test]
        public void TheHullIsWoundOutward()
        {
            Assert.That(SixVolume(CarMesh.Build(CarMesh.Livery)) / 6.0, Is.GreaterThan(0),
                "the car is inside out — it would be invisible from outside");
        }

        [Test]
        public void TheWheelIsWoundOutward()
        {
            Assert.That(SixVolume(CarMesh.Wheel()) / 6.0, Is.GreaterThan(0),
                "the wheel is inside out");
        }

        /// <summary>
        /// Every triangle carries its own three vertices, so no normal is
        /// ever averaged across a facet.
        /// </summary>
        [Test]
        public void EveryTriangleIsFlatShaded()
        {
            var m = CarMesh.Build(CarMesh.Livery);
            Assert.That(m.VertexCount, Is.EqualTo(m.TriangleCount * 3));

            for (var i = 0; i < m.Indices.Length; i++)
            {
                Assert.That(m.Indices[i], Is.EqualTo(i), "vertices are shared between triangles");
            }
        }

        /// <summary>
        /// The car fits inside the space it advertises.
        /// </summary>
        /// <remarks>
        /// <see cref="CarMesh.Space"/> is what an imported model is scaled to,
        /// so it has to contain the generated one — otherwise dropping a car
        /// into the kit folder would visibly change the size of the car, which
        /// is exactly what fitting is supposed to prevent.
        /// </remarks>
        [Test]
        public void TheCarFitsTheSpaceItAdvertises()
        {
            var box = Box(CarMesh.Build(CarMesh.Livery));
            var space = CarMesh.Space;

            Assert.That(box.Min.X, Is.GreaterThanOrEqualTo(space.Min.X - 1e-6));
            Assert.That(box.Min.Y, Is.GreaterThanOrEqualTo(space.Min.Y - 1e-6));
            Assert.That(box.Min.Z, Is.GreaterThanOrEqualTo(space.Min.Z - 1e-6));
            Assert.That(box.Max.X, Is.LessThanOrEqualTo(space.Max.X + 1e-6));
            Assert.That(box.Max.Y, Is.LessThanOrEqualTo(space.Max.Y + 1e-6));
            Assert.That(box.Max.Z, Is.LessThanOrEqualTo(space.Max.Z + 1e-6));
        }

        /// <summary>
        /// It is a single-seater, not a saloon.
        /// </summary>
        /// <remarks>
        /// The thing that makes the silhouette read is that it is long and
        /// narrow and that the body is narrower than the axle track, so the
        /// wheels stand clear of it. A hull as wide as the wheels is a
        /// touring car whatever else is bolted to it.
        /// </remarks>
        [Test]
        public void ItHasASingleSeatersProportions()
        {
            var box = Box(CarMesh.Build(CarMesh.Livery));
            var length = box.Max.Z - box.Min.Z;
            var width = box.Max.X - box.Min.X;

            Assert.That(length, Is.GreaterThan(5.0).And.LessThan(6.0), "length");
            Assert.That(width, Is.GreaterThan(1.5).And.LessThan(2.0), "width across the wings");
            Assert.That(length / width, Is.GreaterThan(2.8), "too stubby to read as a single-seater");
        }

        /// <summary>
        /// The wheel is the size the chassis thinks it is.
        /// </summary>
        /// <remarks>
        /// 0.36 m radius and 0.36 m wide, matching <c>CarController</c>'s
        /// <c>WheelRadius</c>. If the drawn wheel were larger than the
        /// simulated one it would sink into the road; smaller and the car
        /// would hover.
        /// </remarks>
        [Test]
        public void TheWheelIsTheSizeTheChassisThinksItIs()
        {
            var box = Box(CarMesh.Wheel());

            Assert.That(box.Max.X, Is.EqualTo(0.36).Within(0.005), "radius");
            Assert.That(box.Max.Z, Is.EqualTo(0.36).Within(0.005), "radius");
            Assert.That(box.Max.Y - box.Min.Y, Is.EqualTo(0.36).Within(0.02), "width");
        }

        /// <summary>The livery reaches the bodywork, and only the bodywork.</summary>
        /// <remarks>
        /// A rival's colour is baked into its mesh rather than painted on
        /// afterwards, so if the livery failed to reach any vertex every car
        /// in the field would be the same red. The tyres, wings and halo are
        /// carbon on every car and must not take it.
        /// </remarks>
        [Test]
        public void TheLiveryColoursTheBodyworkAndNotTheWings()
        {
            var m = CarMesh.Build(new Rgb(0f, 0f, 1f));
            var blue = 0;
            var other = 0;

            for (var v = 0; v < m.VertexCount; v++)
            {
                if (m.Colors[v * 3] == 0f && m.Colors[v * 3 + 1] == 0f && m.Colors[v * 3 + 2] == 1f) blue++;
                else other++;
            }

            Assert.That(blue, Is.GreaterThan(0), "the livery reached nothing");
            Assert.That(other, Is.GreaterThan(0), "the livery reached everything, including the tyres");
        }
    }
}
