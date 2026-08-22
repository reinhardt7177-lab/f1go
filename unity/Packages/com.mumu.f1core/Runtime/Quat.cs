using System;

namespace MumuF1
{
    /// <summary>
    /// A unit quaternion, ported from <c>f1sim/src/core/math.ts</c>.
    /// </summary>
    /// <remarks>
    /// Deliberately not <c>UnityEngine.Quaternion</c>, for the same reason
    /// <see cref="Vec3"/> is not <c>Vector3</c>: everything in this assembly
    /// has to compile and be tested without an editor, and everything in it
    /// has to agree with the reference to the digit. Unity's type is single
    /// precision and normalises when it feels like it.
    ///
    /// The component order matches the reference exactly, and the rotation
    /// below is the same expansion — <c>v + 2w(q × v) + 2q × (q × v)</c>
    /// written out — so a port that drifts here drifts everywhere that reads
    /// a car's heading.
    /// </remarks>
    public readonly struct Quat : IEquatable<Quat>
    {
        public readonly double X;
        public readonly double Y;
        public readonly double Z;
        public readonly double W;

        public Quat(double x, double y, double z, double w)
        {
            X = x;
            Y = y;
            Z = z;
            W = w;
        }

        public static readonly Quat Identity = new Quat(0, 0, 0, 1);

        /// <summary>The rotation that undoes this one.</summary>
        /// <remarks>
        /// The conjugate rather than a true inverse, which is the same thing
        /// for a unit quaternion and is why every one of these must be unit.
        /// </remarks>
        public Quat Conjugate => new Quat(-X, -Y, -Z, W);

        /// <summary>Rotate a vector by this rotation.</summary>
        public Vec3 Rotate(Vec3 v)
        {
            var tx = 2 * (Y * v.Z - Z * v.Y);
            var ty = 2 * (Z * v.X - X * v.Z);
            var tz = 2 * (X * v.Y - Y * v.X);

            return new Vec3(
                v.X + W * tx + (Y * tz - Z * ty),
                v.Y + W * ty + (Z * tx - X * tz),
                v.Z + W * tz + (X * ty - Y * tx));
        }

        /// <summary>Rotate a vector by the inverse of this rotation (world to local).</summary>
        public Vec3 RotateInverse(Vec3 v) => Conjugate.Rotate(v);

        /// <summary>Shortest-arc interpolation. Used only to smooth the camera.</summary>
        public static Quat Slerp(Quat a, Quat b, double t)
        {
            var cos = a.X * b.X + a.Y * b.Y + a.Z * b.Z + a.W * b.W;
            double bx = b.X, by = b.Y, bz = b.Z, bw = b.W;

            /* Two unit quaternions a hemisphere apart describe the same pair
               of orientations by the shorter or the longer way round. Flipping
               one takes the shorter. */
            if (cos < 0)
            {
                cos = -cos;
                bx = -bx;
                by = -by;
                bz = -bz;
                bw = -bw;
            }

            /* Nearly parallel: the sine below goes to zero and the division
               with it, so interpolate straight and renormalise. */
            if (cos > 0.9995)
            {
                var lx = MathUtil.Lerp(a.X, bx, t);
                var ly = MathUtil.Lerp(a.Y, by, t);
                var lz = MathUtil.Lerp(a.Z, bz, t);
                var lw = MathUtil.Lerp(a.W, bw, t);
                var l = Math.Sqrt(lx * lx + ly * ly + lz * lz + lw * lw);
                if (l == 0) l = 1;
                return new Quat(lx / l, ly / l, lz / l, lw / l);
            }

            var theta = Math.Acos(cos);
            var s = Math.Sin(theta);
            var wa = Math.Sin((1 - t) * theta) / s;
            var wb = Math.Sin(t * theta) / s;

            return new Quat(
                a.X * wa + bx * wb,
                a.Y * wa + by * wb,
                a.Z * wa + bz * wb,
                a.W * wa + bw * wb);
        }

        public bool Equals(Quat other) => X == other.X && Y == other.Y && Z == other.Z && W == other.W;
        public override bool Equals(object obj) => obj is Quat q && Equals(q);
        public override int GetHashCode() => (X, Y, Z, W).GetHashCode();
        public override string ToString() => $"({X:F4}, {Y:F4}, {Z:F4}, {W:F4})";
    }
}
