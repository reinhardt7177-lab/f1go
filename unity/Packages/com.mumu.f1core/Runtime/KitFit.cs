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
    /// The longest edge rather than the height, because the longest edge is
    /// what a thing reads as: a grandstand is twenty-six metres of width and
    /// nine of height, and matching its height would leave it a third too
    /// short along the straight it is supposed to line.
    /// </remarks>
    public static class KitFit
    {
        /// <summary>
        /// How to place <paramref name="model"/> so it stands where a prop
        /// occupying <paramref name="target"/> would have.
        /// </summary>
        public static KitTransform Fit(Bounds3 model, Bounds3 target)
        {
            var from = model.Longest;
            var to = target.Longest;

            /* A model with no size at all is not something to divide by. It
               is also not something worth drawing, but that is the caller's
               problem — this returns something harmless rather than a NaN
               that would put every instance of it at the origin. */
            var scale = from > 1e-9 && to > 1e-9 ? to / from : 1.0;

            var centre = model.Centre;
            return new KitTransform(scale, new Vec3(
                target.Centre.X - centre.X * scale,
                -model.Min.Y * scale,
                target.Centre.Z - centre.Z * scale));
        }

        /// <summary>The box a generated prop occupies, for use as the reference.</summary>
        public static Bounds3 Reference(PropKind kind)
        {
            var mesh = PropMesh.Build(kind);
            return Bounds3.Around(mesh.Positions, mesh.VertexCount);
        }
    }
}
