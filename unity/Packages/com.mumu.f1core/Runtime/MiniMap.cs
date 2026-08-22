using System;

namespace MumuF1
{
    /// <summary>
    /// The circuit seen from above, normalised into a square.
    /// </summary>
    /// <remarks>
    /// Points are in 0..1 with the aspect ratio kept, so a long thin circuit
    /// stays long and thin rather than being stretched to fill the box. The
    /// transform that produced them is kept alongside, because a map nobody
    /// can put a car on is a picture rather than a map — everything placed on
    /// it afterwards has to use the same one.
    ///
    /// North up, not car up. A rotating map is easier to follow for one
    /// corner and impossible to learn a circuit from, and learning the
    /// circuit is the whole point of having one.
    /// </remarks>
    public sealed class MapOutline
    {
        /// <summary>x, y pairs in 0..1, walking the centreline once.</summary>
        public float[] Points { get; internal set; }

        public int Count { get; internal set; }

        /* The transform, so anything else can land in the right place. */
        internal double MinX;
        internal double MinZ;
        internal double Span;
        internal double PadX;
        internal double PadY;
    }

    public static class MiniMap
    {
        /// <summary>Fraction of the box left empty around the circuit.</summary>
        /// <remarks>
        /// The car is drawn as a dot with a width of its own, and a circuit
        /// touching the edge of its box puts half that dot outside the map at
        /// the very corners a driver most wants to see.
        /// </remarks>
        private const double Margin = 0.06;

        /// <summary>
        /// Walk the centreline and normalise it.
        /// </summary>
        /// <param name="circuit">the circuit to draw.</param>
        /// <param name="samples">
        /// points around the lap. Enough that the shape is smooth at the size
        /// a minimap is actually drawn, which is a couple of hundred pixels.
        /// </param>
        public static MapOutline Build(Circuit circuit, int samples = 256)
        {
            if (circuit == null) throw new ArgumentNullException(nameof(circuit));
            if (samples < 8) samples = 8;

            var xs = new double[samples];
            var zs = new double[samples];

            double minX = double.PositiveInfinity, maxX = double.NegativeInfinity;
            double minZ = double.PositiveInfinity, maxZ = double.NegativeInfinity;

            for (var i = 0; i < samples; i++)
            {
                var p = circuit.Spline.SampleAt((double)i / samples * circuit.Length).Position;
                xs[i] = p.X;
                zs[i] = p.Z;
                if (p.X < minX) minX = p.X;
                if (p.X > maxX) maxX = p.X;
                if (p.Z < minZ) minZ = p.Z;
                if (p.Z > maxZ) maxZ = p.Z;
            }

            /* One scale for both axes, from the longer one. Scaling each axis
               to fill the box independently is what turns Monza into a
               circle, and a minimap whose shape is wrong is worse than none:
               it is the shape that tells you which corner is coming. */
            var span = Math.Max(Math.Max(maxX - minX, maxZ - minZ), 1e-6);
            var usable = 1.0 - Margin * 2;

            /* Centre the shorter axis rather than pinning it to a corner. */
            var padX = Margin + (usable - (maxX - minX) / span * usable) * 0.5;
            var padY = Margin + (usable - (maxZ - minZ) / span * usable) * 0.5;

            var map = new MapOutline
            {
                Points = new float[samples * 2],
                Count = samples,
                MinX = minX,
                MinZ = minZ,
                Span = span,
                PadX = padX,
                PadY = padY
            };

            for (var i = 0; i < samples; i++)
            {
                Place(map, xs[i], zs[i], out var x, out var y);
                map.Points[i * 2] = x;
                map.Points[i * 2 + 1] = y;
            }

            return map;
        }

        /// <summary>Where a world position lands on this map, in 0..1.</summary>
        /// <remarks>
        /// The only way anything should ever be placed on a map. Working the
        /// transform out a second time at the call site is how a car ends up
        /// driving alongside its own circuit.
        /// </remarks>
        public static void Place(MapOutline map, double worldX, double worldZ,
            out float x, out float y)
        {
            var usable = 1.0 - Margin * 2;
            x = (float)(map.PadX + (worldX - map.MinX) / map.Span * usable);
            y = (float)(map.PadY + (worldZ - map.MinZ) / map.Span * usable);
        }

        /// <summary>Where a distance along the lap lands on this map.</summary>
        public static void PlaceAt(MapOutline map, Circuit circuit, double s,
            out float x, out float y)
        {
            var p = circuit.Spline.SampleAt(((s % circuit.Length) + circuit.Length) % circuit.Length).Position;
            Place(map, p.X, p.Z, out x, out y);
        }
    }
}
