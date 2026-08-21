using System;
using System.Collections.Generic;

namespace MumuF1
{
    /// <summary>What kind of thing stands beside the road.</summary>
    /// <remarks>
    /// A kind rather than a mesh, because this assembly has no engine in it
    /// and never will. The engine side maps each kind to a prefab from the
    /// racing kit if one has been dropped in, and to a handful of primitives
    /// if not — but *where* each one goes is decided here, where it can be
    /// tested.
    /// </remarks>
    public enum PropKind
    {
        Conifer,
        Broadleaf,
        MarshalPost,
        Grandstand,

        /// <summary>An advertising hoarding, standing against the barrier.</summary>
        AdBoard,

        /// <summary>A flag on a pole, at a sector boundary.</summary>
        Flag,

        /// <summary>The gantry over the timing line.</summary>
        StartGantry
    }

    /// <summary>One thing, somewhere.</summary>
    public readonly struct Placement
    {
        public readonly PropKind Kind;
        public readonly Vec3 Position;

        /// <summary>Rotation about +Y (rad). Zero points the prop along +Z.</summary>
        public readonly double Yaw;

        public readonly double Scale;

        public Placement(PropKind kind, Vec3 position, double yaw, double scale)
        {
            Kind = kind;
            Position = position;
            Yaw = yaw;
            Scale = scale;
        }
    }

    /// <summary>
    /// What stands beside the road.
    /// </summary>
    /// <remarks>
    /// A circuit with nothing around it does not read as slow because it is
    /// slow — it reads as slow because there is nothing to pass. The whole
    /// sensation of speed at ground level comes from near objects sweeping
    /// through the frame, and an empty green plane offers none: at three
    /// hundred kilometres an hour the only thing moving is the road surface,
    /// and tarmac has no texture to move.
    ///
    /// Everything is placed from the spline, so it follows the road round
    /// rather than being dropped on a grid the circuit happens to cross, and
    /// everything is set back past the run-off, so nothing a car can reach at
    /// racing speed has a tree in it.
    /// </remarks>
    public static class Trackside
    {
        /// <summary>Metres along the circuit between attempts to place something.</summary>
        public const double Spacing = 26;

        /// <summary>How far past the run-off the treeline starts (m).</summary>
        public const double Setback = 6;

        /// <summary>Depth of the band trees are scattered through (m).</summary>
        public const double Depth = 46;

        /// <summary>
        /// A deterministic scatter.
        /// </summary>
        /// <remarks>
        /// A random one would give a different forest every load, which makes
        /// a circuit unlearnable in exactly the way a circuit must not be:
        /// the tree you brake at would move. This is the standard integer
        /// hash — the same input always gives the same tree in the same
        /// place, and the output is uncorrelated enough that a row of them
        /// does not look like a row.
        ///
        /// Written in <c>uint</c> so it is bit-for-bit the TypeScript's, whose
        /// <c>Math.imul</c> and <c>&gt;&gt;&gt;</c> are 32-bit operations.
        /// Two versions of this that disagree would put the same circuit's
        /// scenery in two different places.
        /// </remarks>
        public static double Hash(int n)
        {
            unchecked
            {
                var x = (uint)n ^ 0x9e3779b9u;
                x *= 0x85ebca6bu;
                x = (x ^ (x >> 13)) * 0xc2b2ae35u;
                return (x ^ (x >> 16)) / 4294967296.0;
            }
        }

        /// <summary>
        /// Scatter scenery along a circuit.
        /// </summary>
        /// <param name="circuit">the circuit to dress.</param>
        /// <param name="density">
        /// How much of the forest to keep, zero to one.
        /// </param>
        /// <remarks>
        /// Thinned rather than shrunk, and thinned <em>deterministically</em>.
        /// The hash already decides whether a station gets a tree; raising the
        /// threshold it is compared against removes trees from a slow machine
        /// without moving any of the ones that remain. A player who learns to
        /// brake at a tree on a desktop finds the same tree in the same place
        /// on a phone — there are simply fewer of its neighbours. Scaling them
        /// smaller, or dropping every other one, would both break that.
        /// </remarks>
        public static List<Placement> Place(Circuit circuit, double density = 1)
        {
            var keep = MathUtil.Clamp(density, 0, 1);
            var props = new List<Placement>();

            var steps = (int)Math.Floor(circuit.Length / Spacing);

            for (var i = 0; i < steps; i++)
            {
                var s = i * Spacing;
                var sample = circuit.Spline.SampleAt(s);
                var edge = circuit.HalfWidthAt(s) + circuit.KerbWidth + circuit.RunoffAt(s);

                for (var side = -1; side <= 1; side += 2)
                {
                    var seed = i * 2 + (side > 0 ? 1 : 0);

                    /* A gap in the trees every so often, because an unbroken
                       hedge both sides is a corridor — and it is the gaps
                       that let you see the corner after the one you are in. */
                    if (Hash(seed) > 0.72 * keep) continue;

                    var outward = edge + Setback + Hash(seed * 7 + 1) * Depth;
                    var along = (Hash(seed * 13 + 2) - 0.5) * Spacing;
                    var basis = circuit.Spline.SampleAt(
                        (s + along + circuit.Length) % circuit.Length);

                    var position = new Vec3(
                        basis.Position.X + sample.Left.X * outward * side,
                        basis.Position.Y - 0.4,
                        basis.Position.Z + sample.Left.Z * outward * side);

                    var yaw = Hash(seed * 31 + 3) * Math.PI * 2;
                    var scale = 0.8 + Hash(seed * 17 + 4) * 0.9;
                    var kind = Hash(seed * 23 + 5) > 0.45 ? PropKind.Conifer : PropKind.Broadleaf;

                    props.Add(new Placement(kind, position, yaw, scale));
                }

                /* A marker post every fifth station, alternating sides —
                   close to the road, where the eye actually uses it to judge
                   distance. */
                if (i % (keep < 0.6 ? 10 : 5) == 0)
                {
                    var side = i % 10 == 0 ? -1 : 1;
                    var outward = circuit.HalfWidthAt(s) + circuit.KerbWidth + 1.6;
                    props.Add(new Placement(
                        PropKind.MarshalPost,
                        Beside(sample, outward, side),
                        Facing(sample, side),
                        1));
                }

                // A stand every eight hundred metres or so, set well back.
                if (i % Math.Max(1, (int)Math.Round(800 / Spacing, MidpointRounding.AwayFromZero)) == 0)
                {
                    var side = Hash(i * 97) > 0.5 ? 1 : -1;
                    props.Add(new Placement(
                        PropKind.Grandstand,
                        Beside(sample, edge + 12, side),
                        Facing(sample, side) + Math.PI,
                        1));
                }

                /* Hoardings, against the barrier and facing the road.
                   This is the single cheapest thing that makes a green field
                   read as a circuit, and it is why the racing kit is worth
                   having at all: the boards are the one prop whose whole job
                   is to be seen for a fifth of a second at the edge of
                   vision. Every third station, so they come in runs rather
                   than ringing the whole lap. */
                if (i % 3 == 0)
                {
                    for (var side = -1; side <= 1; side += 2)
                    {
                        if (Hash(i * 61 + side) > 0.55) continue;
                        props.Add(new Placement(
                            PropKind.AdBoard,
                            Beside(sample, edge + 0.6, side),
                            Facing(sample, side) + Math.PI,
                            1));
                    }
                }
            }

            /* Flags at the sector boundaries, so the split you just crossed
               is a thing in the world and not only a number on the display. */
            foreach (var split in circuit.SectorSplits)
            {
                var sample = circuit.Spline.SampleAt(split % circuit.Length);
                var outward = circuit.HalfWidthAt(split) + circuit.KerbWidth + 2.4;
                for (var side = -1; side <= 1; side += 2)
                {
                    props.Add(new Placement(
                        PropKind.Flag,
                        Beside(sample, outward, side),
                        Facing(sample, side),
                        1));
                }
            }

            // And the gantry over the line itself.
            var line = circuit.Spline.SampleAt(circuit.Spec.StartLine % circuit.Length);
            props.Add(new Placement(
                PropKind.StartGantry,
                line.Position,
                Math.Atan2(line.Tangent.X, line.Tangent.Z),
                1));

            return props;
        }

        /// <summary>A point <paramref name="outward"/> metres to one side of the road.</summary>
        private static Vec3 Beside(TrackSample sample, double outward, int side) => new Vec3(
            sample.Position.X + sample.Left.X * outward * side,
            sample.Position.Y,
            sample.Position.Z + sample.Left.Z * outward * side);

        /// <summary>The yaw that turns a prop to look back across the road.</summary>
        private static double Facing(TrackSample sample, int side)
            => Math.Atan2(sample.Left.X * side, sample.Left.Z * side);
    }
}
