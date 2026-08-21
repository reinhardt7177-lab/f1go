namespace MumuF1
{
    /// <summary>
    /// The handful of scalar helpers the simulation leans on.
    /// </summary>
    /// <remarks>
    /// Deliberately not <c>UnityEngine.Mathf</c>. Everything in this
    /// assembly has to compile without an engine — that is what lets the
    /// whole simulation be tested by a plain <c>dotnet test</c>, with no
    /// editor and no licence — and <c>Mathf</c> would tie it to one.
    /// It is also <c>double</c> throughout rather than <c>float</c>,
    /// matching the TypeScript this is ported from: the reference
    /// implementation runs in double precision and the tests here are
    /// checked against its numbers.
    /// </remarks>
    public static class MathUtil
    {
        /// <summary>Radians per degree.</summary>
        public const double Rad = System.Math.PI / 180.0;

        /// <summary>Degrees per radian.</summary>
        public const double Deg = 180.0 / System.Math.PI;

        /// <summary>Metres per second to kilometres per hour.</summary>
        public const double Kmh = 3.6;

        public static double Clamp(double v, double lo, double hi)
            => v < lo ? lo : v > hi ? hi : v;

        public static double Lerp(double a, double b, double t) => a + (b - a) * t;

        /// <summary>Length of a two-dimensional vector, without allocating one.</summary>
        public static double Hypot(double x, double y) => System.Math.Sqrt(x * x + y * y);
    }
}
