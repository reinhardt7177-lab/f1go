using System;

namespace MumuF1
{
    /// <summary>
    /// The line the lap is measured from.
    /// </summary>
    /// <remarks>
    /// Every circuit here is swept from a spline, and it looks it: one grey
    /// ribbon that is the same at every metre of it. The start line is the
    /// single marking that says *which* metre you are at — without it there
    /// is nothing on the road to tell a driver they have completed anything,
    /// and a lap counter ticking over is the only evidence a lap happened.
    ///
    /// It is its own mesh rather than a colour on the road's, and the reason
    /// is arithmetic. The road's vertex colours are the right mechanism —
    /// the kerbs are striped along their length by exactly that, asking the
    /// same question of the same distance — but its rings are four metres
    /// apart, and a line is one and a half. Colouring the one ring that
    /// falls inside it gives a colour that interpolates out to the rings on
    /// either side: an eight-metre gradient smeared down the road instead of
    /// a line across it. Laid on top, it can be the width it should be.
    ///
    /// Thirty millimetres above the tarmac, which is enough to clear the
    /// depth buffer at any distance the car can see it from and far below
    /// the eighty the floor runs at, so nothing ever touches it. It carries
    /// no collider for the same reason the roadside does not.
    /// </remarks>
    public static class StartLineMesh
    {
        private static readonly Rgb Pale = new Rgb(0.90f, 0.91f, 0.93f);
        private static readonly Rgb Ink = new Rgb(0.13f, 0.14f, 0.16f);

        /// <summary>How deep the line is, along the road (m).</summary>
        private const double Depth = 1.4;

        /// <summary>How wide one square of it is (m).</summary>
        private const double Square = 0.7;

        /// <summary>How far above the tarmac it is laid (m).</summary>
        private const double Lift = 0.03;

        /// <summary>Two rows of squares across the road, at the timing line.</summary>
        public static Mesh3 Build(Circuit circuit)
        {
            var b = new MeshBuilder();

            var line = circuit.Spec.StartLine % circuit.Length;
            var halfWidth = circuit.HalfWidthAt(line);

            /* Rounded up and then trimmed to the road's own edge, so the last
               square is a part-square rather than one hanging over the kerb.
               A marking that overshoots the tarmac reads as a mistake and not
               as a wide line. */
            var columns = (int)Math.Ceiling(halfWidth * 2 / Square);
            const int rows = 2;

            for (var row = 0; row < rows; row++)
            {
                var s0 = line - Depth * 0.5 + row * (Depth / rows);
                var s1 = s0 + Depth / rows;

                for (var col = 0; col < columns; col++)
                {
                    var t0 = -halfWidth + col * Square;
                    var t1 = Math.Min(t0 + Square, halfWidth);
                    if (t1 - t0 < 1e-6) continue;

                    var colour = (row + col) % 2 == 0 ? Pale : Ink;

                    b.Quad(
                        On(circuit, s0, t0), On(circuit, s1, t0),
                        On(circuit, s1, t1), On(circuit, s0, t1),
                        colour);
                }
            }

            return b.Finish();
        }

        /// <summary>
        /// A point on the road surface, lifted clear of it.
        /// </summary>
        /// <remarks>
        /// Banked the same way the road is. Every circuit here happens to
        /// have its line on a straight, so this changes nothing today and
        /// stops the line hanging in the air on the first one that does not.
        /// </remarks>
        private static Vec3 On(Circuit circuit, double s, double t)
        {
            var sample = circuit.Spline.SampleAt(s);
            var left = AboutAxis(sample.Left, sample.Tangent, circuit.BankingAt(s));
            var up = Vec3.Cross(sample.Tangent, left).Normalised();

            return sample.Position + left * t + up * Lift;
        }

        /// <summary>Rodrigues' rotation of <paramref name="v"/> about a unit axis.</summary>
        private static Vec3 AboutAxis(Vec3 v, Vec3 axis, double radians)
        {
            var c = Math.Cos(radians);
            var s = Math.Sin(radians);

            return v * c + Vec3.Cross(axis, v) * s + axis * (Vec3.Dot(axis, v) * (1 - c));
        }
    }
}
