using System;

namespace MumuF1
{
    /// <summary>
    /// A three-component vector, in double precision.
    /// </summary>
    /// <remarks>
    /// Deliberately not <c>UnityEngine.Vector3</c>, for two reasons that
    /// both matter. The first is that this assembly must compile without
    /// an engine, which is what lets the whole simulation be tested by a
    /// plain <c>dotnet test</c> with no editor and no licence. The second
    /// is precision: Unity's vector is <c>float</c>, and a circuit is
    /// seven kilometres long with a centreline resampled every metre —
    /// at that scale a float carries about half a millimetre, and the
    /// curvature is a second difference of positions, so the error in it
    /// is squared. The racing line and the sector timing both read
    /// curvature.
    ///
    /// Conversion to and from the engine's vector lives on the Unity side
    /// of the fence, so this file never has to know the engine exists.
    /// </remarks>
    public readonly struct Vec3 : IEquatable<Vec3>
    {
        public readonly double X;
        public readonly double Y;
        public readonly double Z;

        public Vec3(double x, double y, double z)
        {
            X = x;
            Y = y;
            Z = z;
        }

        public static readonly Vec3 Zero = new Vec3(0, 0, 0);
        public static readonly Vec3 Up = new Vec3(0, 1, 0);

        public static Vec3 operator +(Vec3 a, Vec3 b) => new Vec3(a.X + b.X, a.Y + b.Y, a.Z + b.Z);
        public static Vec3 operator -(Vec3 a, Vec3 b) => new Vec3(a.X - b.X, a.Y - b.Y, a.Z - b.Z);
        public static Vec3 operator *(Vec3 a, double k) => new Vec3(a.X * k, a.Y * k, a.Z * k);
        public static Vec3 operator *(double k, Vec3 a) => a * k;

        public double LengthSquared => X * X + Y * Y + Z * Z;
        public double Length => Math.Sqrt(LengthSquared);

        public static double Dot(Vec3 a, Vec3 b) => a.X * b.X + a.Y * b.Y + a.Z * b.Z;

        public static Vec3 Cross(Vec3 a, Vec3 b) => new Vec3(
            a.Y * b.Z - a.Z * b.Y,
            a.Z * b.X - a.X * b.Z,
            a.X * b.Y - a.Y * b.X);

        public Vec3 Normalised()
        {
            double l = Length;
            return l > 1e-12 ? this * (1.0 / l) : Zero;
        }

        public static Vec3 Lerp(Vec3 a, Vec3 b, double t) => a + (b - a) * t;

        /// <summary>Distance squared, for comparisons that never need the root.</summary>
        public static double DistanceSquared(Vec3 a, Vec3 b)
        {
            double dx = a.X - b.X, dy = a.Y - b.Y, dz = a.Z - b.Z;
            return dx * dx + dy * dy + dz * dz;
        }

        public bool Equals(Vec3 other) => X == other.X && Y == other.Y && Z == other.Z;
        public override bool Equals(object obj) => obj is Vec3 v && Equals(v);
        public override int GetHashCode() => (X, Y, Z).GetHashCode();
        public override string ToString() => $"({X:F3}, {Y:F3}, {Z:F3})";
    }
}
