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
        }

        /// <summary>
        /// The case that changed this rule, with the pack's real numbers.
        /// </summary>
        /// <remarks>
        /// Kenney's covered grandstand measures 1.00 by 1.19 by 1.02 — very
        /// nearly a cube — where the generated one is twenty-seven metres of
        /// width and under ten of height. Scaling longest edge to longest
        /// edge would multiply it by twenty-seven and stand a grandstand
        /// thirty-one metres tall beside the circuit. Fitting it inside the
        /// box gives eight metres by ten, which is a grandstand.
        /// </remarks>
        [Test]
        public void DoesNotStandACubeOnEndToMatchAWideBox()
        {
            var target = Box(27, 9.7, 12, cy: 4.85);
            var model = Box(1.00, 1.19, 1.02);

            var fit = KitFit.Fit(model, target);
            var seated = new Bounds3(fit.Apply(model.Min), fit.Apply(model.Max));

            Assert.That(fit.Scale, Is.EqualTo(9.7 / 1.19).Within(1e-6));
            Assert.That(seated.Size.Y, Is.EqualTo(9.7).Within(1e-6));
            Assert.That(seated.Max.Y, Is.LessThanOrEqualTo(target.Max.Y + 1e-6),
                "it is taller than the shape it replaces");
        }

        /// <summary>
        /// An axis the generated prop is a plate on cannot decide the scale.
        /// </summary>
        /// <remarks>
        /// A hoarding is seven metres wide and fourteen centimetres thick. A
        /// modelled one half a metre thick would be crushed to a fifth of a
        /// metre across if thickness were allowed to bind, so a target axis
        /// counts for at least a quarter of the longest.
        /// </remarks>
        [Test]
        public void DoesNotLetAPlateThinAxisCrushTheModel()
        {
            var target = Box(7.0, 1.8, 0.2, cy: 0.9);
            var model = Box(1.0, 1.0, 0.48);

            var fit = KitFit.Fit(model, target);
            var seated = new Bounds3(fit.Apply(model.Min), fit.Apply(model.Max));

            // Height binds at 1.8, not thickness at 0.2 / 0.48.
            Assert.That(fit.Scale, Is.EqualTo(1.8).Within(1e-9));
            Assert.That(seated.Size.Y, Is.EqualTo(1.8).Within(1e-9));
        }

        /// <summary>
        /// Nothing may come out taller or wider than the shape it replaces —
        /// the placement rules leave 1.6 m of clearance measured against that
        /// shape, and a model that overran it would be standing in the road.
        /// Depth is the one exception, by centimetres, and only where the
        /// generated prop is a plate.
        /// </summary>
        [Test]
        [TestCaseSource(typeof(KitFitTests), nameof(RealPackSizes))]
        public void KeepsARealPackInsideTheShapeItReplaces(PropKind kind, double w, double h, double d)
        {
            var target = KitFit.Reference(kind);
            var model = new Bounds3(Vec3.Zero, new Vec3(w, h, d));

            var fit = KitFit.Fit(model, target);
            var seated = new Bounds3(fit.Apply(model.Min), fit.Apply(model.Max));

            Assert.That(seated.Size.X, Is.LessThanOrEqualTo(target.Size.X + 1e-6), $"{kind} too wide");
            Assert.That(seated.Size.Y, Is.LessThanOrEqualTo(target.Size.Y + 1e-6), $"{kind} too tall");
            Assert.That(seated.Min.Y, Is.EqualTo(0).Within(1e-9), $"{kind} not on the ground");
            Assert.That(seated.Longest, Is.GreaterThan(target.Longest * 0.2), $"{kind} came out tiny");
        }

        /// <summary>
        /// Measured out of the packs themselves, so a change to either the
        /// fit or the generated shapes is checked against real models rather
        /// than against invented ones.
        /// </summary>
        private static readonly object[] RealPackSizes =
        {
            new object[] { PropKind.Conifer, 0.39, 1.53, 0.39 },        // tree_pineTallA
            new object[] { PropKind.Broadleaf, 0.64, 1.23, 0.74 },      // tree_oak
            new object[] { PropKind.Grandstand, 1.00, 1.19, 1.02 },     // grandStandCovered
            new object[] { PropKind.AdBoard, 1.00, 1.00, 0.48 },        // billboard
            new object[] { PropKind.Flag, 0.20, 1.25, 0.04 },           // flagCheckers
            new object[] { PropKind.StartGantry, 1.26, 0.69, 0.19 },    // overheadLights
            new object[] { PropKind.MarshalPost, 0.30, 0.41, 0.07 }     // sign
        };

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
        /// Bottom to bottom, not to zero.
        /// </summary>
        /// <remarks>
        /// Props stand on the ground and their reference boxes start at zero,
        /// so for them the two are the same. A wheel is different: its box is
        /// written about the car's origin, so its bottom is minus its radius,
        /// and seating it on zero would bury the car up to its axles.
        /// </remarks>
        [Test]
        public void SeatsAWheelOnItsHubRatherThanOnTheGround()
        {
            // A wheel 0.72 across, hub at the origin.
            var target = new Bounds3(new Vec3(-0.18, -0.36, -0.36), new Vec3(0.18, 0.36, 0.36));
            var model = Box(0.40, 0.60, 0.60);

            var fit = KitFit.FitCentred(model, target);
            var seated = new Bounds3(fit.Apply(model.Min), fit.Apply(model.Max));

            Assert.That(seated.Centre.Y, Is.EqualTo(0).Within(1e-9), "the wheel is off its hub");
            Assert.That(seated.Min.Y, Is.GreaterThanOrEqualTo(-0.36 - 1e-9));
            Assert.That(seated.Size.Y, Is.LessThanOrEqualTo(0.72 + 1e-9));
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
