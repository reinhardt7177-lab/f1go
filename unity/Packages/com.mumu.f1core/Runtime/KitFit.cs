using System;

namespace MumuF1
{
    /// <summary>An axis-aligned box.</summary>
    public readonly struct Bounds3
    {
        public readonly Vec3 Min;
        public readonly Vec3 Max;

        public Bounds3(Vec3 min, Vec3 max)
        {
            Min = min;
            Max = max;
        }

        public Vec3 Size => Max - Min;

        public Vec3 Centre => new Vec3(
            (Min.X + Max.X) * 0.5,
            (Min.Y + Max.Y) * 0.5,
            (Min.Z + Max.Z) * 0.5);

        /// <summary>The longest edge — the one that decides how big a thing reads.</summary>
        public double Longest
        {
            get
            {
                var s = Size;
                return Math.Max(s.X, Math.Max(s.Y, s.Z));
            }
        }

        /// <summary>The box around a run of positions, three floats to a vertex.</summary>
        public static Bounds3 Around(float[] positions, int vertexCount)
        {
            if (positions == null || vertexCount <= 0) return new Bounds3(Vec3.Zero, Vec3.Zero);

            double minX = double.PositiveInfinity, minY = double.PositiveInfinity, minZ = double.PositiveInfinity;
            double maxX = double.NegativeInfinity, maxY = double.NegativeInfinity, maxZ = double.NegativeInfinity;

            for (var v = 0; v < vertexCount; v++)
            {
                double x = positions[v * 3], y = positions[v * 3 + 1], z = positions[v * 3 + 2];
                if (x < minX) minX = x;
                if (y < minY) minY = y;
                if (z < minZ) minZ = z;
                if (x > maxX) maxX = x;
                if (y > maxY) maxY = y;
                if (z > maxZ) maxZ = z;
            }

            return new Bounds3(new Vec3(minX, minY, minZ), new Vec3(maxX, maxY, maxZ));
        }
    }

    /// <summary>A uniform scale and a translation, in that order.</summary>
    public readonly struct KitTransform
    {
        public readonly double Scale;
        public readonly Vec3 Offset;

        public KitTransform(double scale, Vec3 offset)
        {
            Scale = scale;
            Offset = offset;
        }

        public static readonly KitTransform Identity = new KitTransform(1, Vec3.Zero);

        /// <summary>Where a point of the model ends up.</summary>
        public Vec3 Apply(Vec3 p) => p * Scale + Offset;
    }

    /// <summary>
    /// Makes somebody else's model stand where ours would have.
    /// </summary>
    /// <remarks>
    /// An imported model arrives in whatever units and about whatever pivot
    /// its author chose, and neither is knowable in advance. A pack exported
    /// in centimetres is a hundred times too big; one whose pivot is the
    /// middle of the bounding box sinks half of itself into the verge. Asking
    /// for models that already satisfy both is asking the person dropping a
    /// zip in to open every file and check — which is precisely the work they
    /// were trying to avoid.
    ///
    /// So it is measured instead. The generated prop is the reference: an
    /// imported model is scaled until its longest edge matches the generated
    /// one's, then moved so its foot is on the ground and its footprint sits
    /// where the generated one's did. Uniform scale, because a model squashed
    /// on one axis to fit a box is worse than one that is slightly the wrong
    /// size.
    ///
    /// The rule is the tightest axis rather than the longest edge, and that
    /// was learned from a real pack. Kenney's covered grandstand is roughly
    /// cubic — one metre by one point two by one — where the generated one is
    /// twenty-six metres of width and nine of height. Matching longest edge
    /// to longest edge scales the model by twenty-six and produces a
    /// grandstand thirty-one metres tall. Fitting it inside the box instead
    /// keeps every clearance the placement tests were written against, and
    /// those tests measure the generated box.
    ///
    /// With one qualification: an axis the generated prop is a plate on
    /// cannot be allowed to decide. A hoarding is seven metres wide and
    /// fourteen centimetres thick, and a modelled one thicker than that would
    /// otherwise be crushed to nothing to fit the thickness. So a target axis
    /// counts for at least a quarter of the longest before the ratio is
    /// taken. A model may therefore end up slightly deeper than the shape it
    /// replaces, which is centimetres against the 1.6 m of clearance every
    /// prop is placed with.
    /// </remarks>
    public static class KitFit
    {
        /// <summary>
        /// How to place <paramref name="model"/> so it stands where a prop
        /// occupying <paramref name="target"/> would have.
        /// </summary>
        /// <summary>How thin a target axis may get before it stops deciding.</summary>
        private const double PlateFloor = 0.25;

        public static KitTransform Fit(Bounds3 model, Bounds3 target)
        {
            var from = model.Size;
            var to = target.Size;
            var floor = target.Longest * PlateFloor;

            var scale = double.PositiveInfinity;
            Consider(from.X, to.X, floor, ref scale);
            Consider(from.Y, to.Y, floor, ref scale);
            Consider(from.Z, to.Z, floor, ref scale);

            /* A model with no size at all on any axis is not something to
               divide by. It is also not something worth drawing, but that is
               the caller's problem — this returns something harmless rather
               than a NaN that would put every instance of it at the origin. */
            if (double.IsInfinity(scale) || scale <= 0) scale = 1.0;

            /* Bottom to bottom rather than to zero. For a prop the target's
               bottom *is* zero and this is the same thing — but a car body
               and a wheel are also fitted this way, and their boxes are
               written about the car's own origin, so a wheel's bottom is
               minus its radius. Seating those on y = 0 would bury the car up
               to its axles. */
            var centre = model.Centre;
            return new KitTransform(scale, new Vec3(
                target.Centre.X - centre.X * scale,
                target.Min.Y - model.Min.Y * scale,
                target.Centre.Z - centre.Z * scale));
        }

        /// <summary>
        /// The same, but centred on the target rather than stood on its floor.
        /// </summary>
        /// <remarks>
        /// For anything mounted about a hub rather than resting on the
        /// ground. A wheel is the case: the pack's is 0.6 across where ours
        /// is 0.72, and standing the smaller one on the larger one's floor
        /// would hang it below the axle by the difference.
        /// </remarks>
        public static KitTransform FitCentred(Bounds3 model, Bounds3 target)
        {
            var seated = Fit(model, target);
            var lift = target.Centre.Y - (model.Centre.Y * seated.Scale + seated.Offset.Y);
            return new KitTransform(seated.Scale, new Vec3(
                seated.Offset.X, seated.Offset.Y + lift, seated.Offset.Z));
        }

        /// <summary>Let one axis have its say, if it has one.</summary>
        private static void Consider(double from, double to, double floor, ref double scale)
        {
            if (from <= 1e-9) return;
            var ratio = Math.Max(to, floor) / from;
            if (ratio > 0 && ratio < scale) scale = ratio;
        }

        /// <summary>The box a generated prop occupies, for use as the reference.</summary>
        public static Bounds3 Reference(PropKind kind)
        {
            var mesh = PropMesh.Build(kind);
            return Bounds3.Around(mesh.Positions, mesh.VertexCount);
        }
    }
}
