using System;
using NUnit.Framework;

namespace MumuF1.Tests
{
    /// <summary>
    /// Making somebody else's model stand where ours would have.
    /// </summary>
    /// <remarks>
    /// The two things that make a dropped-in model look wrong are its units
    /// and its pivot, and neither is knowable before the file is opened. This
    /// is what makes it unnecessary to know: measure the model, measure the
    /// shape it replaces, and scale and seat one onto the other.
    /// </remarks>
    [TestFixture]
    public class KitFitTests
    {
        private static Bounds3 Box(double w, double h, double d, double cx = 0, double cy = 0, double cz = 0)
            => new Bounds3(
                new Vec3(cx - w / 2, cy - h / 2, cz - d / 2),
                new Vec3(cx + w / 2, cy + h / 2, cz + d / 2));

        /// <summary>
        /// The case this exists for. A grandstand exported in centimetres,
        /// about the middle of its own bounding box, has to end up the size
        /// of the generated one and standing on the ground.
        /// </summary>
        [Test]
        public void RescalesAPackExportedInCentimetres()
        {
            var target = Box(26, 9, 12, cy: 4.5);
            var model = Box(2600, 900, 1200);          // metres to centimetres, pivot centred

            var fit = KitFit.Fit(model, target);

            Assert.That(fit.Scale, Is.EqualTo(0.01).Within(1e-9));

            var seated = new Bounds3(fit.Apply(model.Min), fit.Apply(model.Max));
            Assert.That(seated.Min.Y, Is.EqualTo(0).Within(1e-9), "it is not standing on the ground");
            Assert.That(seated.Size.X, Is.EqualTo(26).Within(1e-9));
            Assert.That(seated.Size.Y, Is.EqualTo(9).Within(1e-9));
        }

        /// <summary>
        /// A model already the right size and already sitting on its foot
        /// must be left alone. An importer that "corrects" a correct model
        /// is worse than no importer.
        /// </summary>
        [Test]
        public void LeavesAModelThatAlreadyFitsAlone()
        {
            var target = Box(3, 8, 3, cy: 4);
            var fit = KitFit.Fit(target, target);

            Assert.That(fit.Scale, Is.EqualTo(1).Within(1e-9));
            Assert.That(fit.Offset.X, Is.EqualTo(0).Within(1e-9));
            Assert.That(fit.Offset.Y, Is.EqualTo(0).Within(1e-9));
            Assert.That(fit.Offset.Z, Is.EqualTo(0).Within(1e-9));
        }

        /// <summary>
        /// Uniform, always. A model squashed on one axis to fill a box looks
        /// worse than one that is slightly the wrong size, and the shapes
        /// being replaced are approximations anyway.
        /// </summary>
        [Test]
        public void ScalesUniformlyRatherThanFillingTheBox()
        {
            var target = Box(7, 1.4, 0.14, cy: 1.05);
            var model = Box(2, 2, 2);                  // a cube, nothing like the target

            var fit = KitFit.Fit(model, target);
            var seated = new Bounds3(fit.Apply(model.Min), fit.Apply(model.Max));

            Assert.That(seated.Size.X, Is.EqualTo(seated.Size.Y).Within(1e-9));
            Assert.That(seated.Size.Y, Is.EqualTo(seated.Size.Z).Within(1e-9));
            Assert.That(seated.Longest, Is.EqualTo(target.Longest).Within(1e-9));
        }

        /// <summary>
        /// The longest edge decides the scale, not the height. A grandstand
        /// is twenty-six metres of width and nine of height; matching its
        /// height would leave it a third too short along the straight it is
        /// meant to line.
        /// </summary>
        [Test]
        public void MatchesTheLongestEdgeRatherThanTheHeight()
        {
            var target = Box(26, 9, 12, cy: 4.5);
            var model = Box(52, 30, 24);               // twice as wide, over three times as tall

            var fit = KitFit.Fit(model, target);
            var seated = new Bounds3(fit.Apply(model.Min), fit.Apply(model.Max));

            Assert.That(seated.Size.X, Is.EqualTo(26).Within(1e-9));
            Assert.That(seated.Size.Y, Is.EqualTo(15).Within(1e-9));
        }

        /// <summary>
        /// Whatever the model, its foot ends up on the ground — that is the
        /// half of this that stops things sinking into the verge.
        /// </summary>
        [Test]
        [TestCase(0.0)]
        [TestCase(-500.0)]
        [TestCase(37.5)]
        public void AlwaysPutsTheFootOnTheGround(double modelCentreY)
        {
            var target = Box(3, 8, 3, cy: 4);
            var model = Box(120, 400, 90, cy: modelCentreY);

            var fit = KitFit.Fit(model, target);
            var seated = new Bounds3(fit.Apply(model.Min), fit.Apply(model.Max));

            Assert.That(seated.Min.Y, Is.EqualTo(0).Within(1e-9));
        }

        /// <summary>
        /// A model with no size is not something to divide by. Returning
        /// something harmless beats a NaN that would put every instance of
        /// it at the origin.
        /// </summary>
        [Test]
        public void RefusesToDivideByAModelWithNoSize()
        {
            var fit = KitFit.Fit(new Bounds3(Vec3.Zero, Vec3.Zero), Box(3, 8, 3, cy: 4));

            Assert.That(fit.Scale, Is.EqualTo(1).Within(1e-9));
            Assert.That(double.IsNaN(fit.Offset.X) || double.IsInfinity(fit.Offset.X), Is.False);
            Assert.That(double.IsNaN(fit.Offset.Y) || double.IsInfinity(fit.Offset.Y), Is.False);
        }

        /// <summary>
        /// The reference is the generated prop itself, so every kind has one
        /// and it is the size the placement rules were written against.
        /// </summary>
        [Test]
        public void ReadsAReferenceBoxForEveryKind()
        {
            foreach (PropKind kind in Enum.GetValues(typeof(PropKind)))
            {
                var box = KitFit.Reference(kind);
                Assert.That(box.Min.Y, Is.EqualTo(0).Within(1e-6), $"{kind} is not on the ground");
                Assert.That(box.Longest, Is.GreaterThan(1), $"{kind} has no size to match");
            }
        }

        [Test]
        public void MeasuresABoxAroundLooseVertices()
        {
            var positions = new[] { 1f, 2f, 3f, -4f, 0f, 7f, 0f, -5f, 0f };
            var box = Bounds3.Around(positions, 3);

            Assert.That(box.Min.X, Is.EqualTo(-4).Within(0));
            Assert.That(box.Min.Y, Is.EqualTo(-5).Within(0));
            Assert.That(box.Max.Z, Is.EqualTo(7).Within(0));
            Assert.That(box.Longest, Is.EqualTo(7).Within(1e-9));
        }

        [Test]
        public void MeasuresNothingWithoutFallingOver()
        {
            var box = Bounds3.Around(new float[0], 0);
            Assert.That(box.Longest, Is.EqualTo(0).Within(0));
        }
    }
}
