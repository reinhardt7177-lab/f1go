using System;

namespace MumuF1
{
    /// <summary>
    /// The car, generated.
    /// </summary>
    /// <remarks>
    /// Five boxes stood in for this until now, and from the outside they read
    /// as a red brick with wheels. The argument for keeping them was that a
    /// modelled car is an asset, an asset cannot be authored as text, and the
    /// shape of the car changes nothing about how it drives. The first two
    /// are true of a *modelled* car. They are not true of a generated one,
    /// and a generated one is what this is: a lofted hull, a wing, a halo and
    /// a helmet, written down, diffable, and checkable without an editor.
    ///
    /// It is built from cross-sections rather than from primitives because
    /// the thing that makes a single-seater recognisable is its taper — a
    /// needle nose that swells to a cockpit and narrows again to a gearbox.
    /// Axis-aligned boxes cannot taper, which is why the boxes never looked
    /// like a car no matter how many of them there were. <see cref="Loft"/>
    /// walks a list of sections and skins them, so the silhouette is a table
    /// of numbers and changing the car means changing the table.
    ///
    /// Flat-shaded and vertex-coloured like everything else, so the whole car
    /// is one draw call and takes the same toon shading and outline as the
    /// road and the roadside. Wheels are not here: they turn and steer
    /// independently, so they are their own objects with their own transforms.
    ///
    /// +Z is forward, +Y is up, and the origin is the centre of the car at
    /// hub height — the same frame the suspension hardpoints are in, so a
    /// section's Y is directly comparable with a wheel's.
    /// </remarks>
    public static class CarMesh
    {
        /// <summary>The livery a car gets when nobody says otherwise.</summary>
        public static readonly Rgb Livery = new Rgb(0.80f, 0.07f, 0.10f);
        private static readonly Rgb Dark = new Rgb(0.10f, 0.11f, 0.13f);
        private static readonly Rgb Carbon = new Rgb(0.16f, 0.17f, 0.20f);
        private static readonly Rgb Trim = new Rgb(0.93f, 0.94f, 0.96f);
        private static readonly Rgb Gold = new Rgb(0.92f, 0.74f, 0.16f);
        private static readonly Rgb Visor = new Rgb(0.13f, 0.16f, 0.22f);
        private static readonly Rgb Rubber = new Rgb(0.09f, 0.09f, 0.10f);
        private static readonly Rgb Rim = new Rgb(0.72f, 0.74f, 0.78f);

        /// <summary>
        /// One station along the car's length.
        /// </summary>
        /// <remarks>
        /// A rounded rectangle would need a dozen points per section and buy
        /// nothing: the shading is four hard bands, so a chamfer reads as a
        /// band and a fillet reads as a chamfer. Six points — floor edge,
        /// shoulder, deck — are enough to give the hull a waist and a
        /// tumblehome, which is all the eye is asking for.
        /// </remarks>
        private readonly struct Section
        {
            public readonly double Z;

            /// <summary>Half-width at the floor.</summary>
            public readonly double Foot;

            /// <summary>Half-width at the shoulder, the widest point.</summary>
            public readonly double Waist;

            /// <summary>Half-width at the deck.</summary>
            public readonly double Deck;

            public readonly double Floor;

            /// <summary>Height of the shoulder, where the sides turn over.</summary>
            public readonly double Shoulder;

            public readonly double Top;

            public Section(double z, double foot, double waist, double deck,
                           double floor, double shoulder, double top)
            {
                Z = z;
                Foot = foot;
                Waist = waist;
                Deck = deck;
                Floor = floor;
                Shoulder = shoulder;
                Top = top;
            }

            /// <summary>
            /// The section's outline, anticlockwise seen from behind.
            /// </summary>
            /// <remarks>
            /// Anticlockwise from the front of the car means the skin between
            /// two sections comes out facing outward without any per-face
            /// thought, and the cap on the last section comes out facing
            /// backward. Getting this the wrong way round produces a car that
            /// is invisible from outside and solid from within, which is the
            /// one modelling mistake that cannot be seen in the code.
            /// </remarks>
            public Vec3[] Ring() => new[]
            {
                new Vec3(-Foot, Floor, Z),
                new Vec3(Foot, Floor, Z),
                new Vec3(Waist, Shoulder, Z),
                new Vec3(Deck, Top, Z),
                new Vec3(-Deck, Top, Z),
                new Vec3(-Waist, Shoulder, Z)
            };
        }

        /// <summary>
        /// The silhouette, front to back.
        /// </summary>
        /// <remarks>
        /// Read the Z column and the car is there: a nose tip out at 3.25,
        /// the front axle at 1.98, the cockpit opening either side of the
        /// origin, the rear axle at −1.62 and the crash structure ending at
        /// −2.30. The waist column is the plan view and the top column is the
        /// side view, so the two together are the drawing.
        ///
        /// The floor stays at −0.10 for most of the length and lifts at both
        /// ends, which is what gives the car a visible rake and keeps the
        /// plank off the road over a kerb.
        /// </remarks>
        private static readonly Section[] Hull =
        {
            //            z      foot  waist  deck   floor  shldr   top
            new Section(3.25, 0.05, 0.07, 0.05, 0.02, 0.10, 0.14),
            new Section(2.85, 0.10, 0.14, 0.09, 0.00, 0.14, 0.24),
            new Section(2.30, 0.16, 0.21, 0.13, -0.04, 0.16, 0.31),
            new Section(1.98, 0.20, 0.25, 0.16, -0.07, 0.16, 0.34),
            new Section(1.40, 0.26, 0.32, 0.21, -0.09, 0.15, 0.38),
            new Section(0.85, 0.32, 0.41, 0.27, -0.10, 0.13, 0.44),
            new Section(0.42, 0.40, 0.56, 0.30, -0.10, 0.10, 0.46),
            new Section(-0.05, 0.44, 0.62, 0.32, -0.10, 0.08, 0.47),
            new Section(-0.60, 0.44, 0.60, 0.30, -0.10, 0.08, 0.50),
            new Section(-1.10, 0.38, 0.48, 0.24, -0.10, 0.10, 0.48),
            new Section(-1.62, 0.28, 0.33, 0.17, -0.09, 0.12, 0.40),
            new Section(-2.00, 0.18, 0.21, 0.11, -0.06, 0.12, 0.30),
            new Section(-2.30, 0.10, 0.12, 0.07, -0.02, 0.10, 0.20)
        };

        /// <summary>The whole car, less its wheels.</summary>
        /// <remarks>
        /// The livery is an argument rather than a repaint afterwards. A car
        /// whose bodywork, wings, floor and helmet differ by vertex colour is
        /// one mesh and one draw call, and there is no material left to swap
        /// — so the field of ten gets ten meshes, which is ten small buffers
        /// and nine fewer renderers each than painting the parts separately
        /// would have cost.
        /// </remarks>
        public static Mesh3 Build(Rgb livery)
        {
            var b = new MeshBuilder();

            Loft(b, Hull, livery);
            Cockpit(b, livery);
            Sidepods(b);
            FrontWing(b, livery);
            RearWing(b, livery);
            Floor(b);

            return b.Finish();
        }

        /// <summary>
        /// One wheel, about its hub, with its axle along +Y.
        /// </summary>
        /// <remarks>
        /// Along +Y because that is the axis Unity's own cylinder uses, and
        /// the view already stands each wheel on its rim with a fixed
        /// rotation it applies before the steer and the spin. Generating it
        /// the other way round would mean changing that too, for nothing.
        ///
        /// The spokes are the point. A plain black cylinder is rotationally
        /// symmetric, so a wheel doing three thousand rpm looks exactly like
        /// a wheel that is locked — which is the one thing the player most
        /// needs to see. Five bright bars break the symmetry, and now a
        /// locked front under braking is visible from the cockpit camera.
        /// </remarks>
        public static Mesh3 Wheel()
        {
            const double radius = 0.36, half = 0.18;
            var b = new MeshBuilder();

            b.Tube(new Vec3(0, -half, 0), radius, radius, half * 2, 16, Rubber);

            for (var side = -1; side <= 1; side += 2)
            {
                var y = side * (half + 0.004);

                b.Tube(new Vec3(0, y - 0.004, 0), 0.075, 0.075, 0.008, 8, Rim);

                for (var s = 0; s < 5; s++)
                {
                    var a = 2 * Math.PI * s / 5;
                    var dx = Math.Cos(a);
                    var dz = Math.Sin(a);

                    Vec3 At(double r, double t) =>
                        new Vec3(dx * r - dz * t, y, dz * r + dx * t);

                    /* Wound so the face looks outward on each side, which is
                       opposite senses for the two sides of the wheel. */
                    if (side > 0)
                        b.Quad(At(0.07, 0.035), At(0.26, 0.035), At(0.26, -0.035), At(0.07, -0.035), Rim);
                    else
                        b.Quad(At(0.07, -0.035), At(0.26, -0.035), At(0.26, 0.035), At(0.07, 0.035), Rim);
                }
            }

            return b.Finish();
        }

        /// <summary>
        /// The box the car fills, as the reference an imported model is
        /// fitted to.
        /// </summary>
        /// <remarks>
        /// Taken from the section table and the wings rather than measured
        /// off the built mesh, because it is the *intended* size of the car
        /// and a model dropped in should be fitted to that. Measuring the
        /// generated one would make an installed car inherit whatever the
        /// generated one happened to add up to, including a wing mirror.
        /// </remarks>
        public static Bounds3 Space => new Bounds3(
            new Vec3(-0.90, -0.13, -2.48), new Vec3(0.90, 0.86, 3.36));

        /// <summary>Skin a run of sections.</summary>
        /// <remarks>
        /// Capped at both ends, so the hull is closed and the tests can
        /// measure its volume. An open tube has no inside and no sign.
        /// </remarks>
        private static void Loft(MeshBuilder b, Section[] sections, Rgb colour)
        {
            var previous = sections[0].Ring();
            Cap(b, previous, front: true, colour: colour);

            for (var i = 1; i < sections.Length; i++)
            {
                var next = sections[i].Ring();
                for (var k = 0; k < previous.Length; k++)
                {
                    var k2 = (k + 1) % previous.Length;
                    /* Front ring first and in order, back ring reversed:
                       that is the anticlockwise-from-outside winding for a
                       quad spanning two rings that both run anticlockwise
                       seen from behind. */
                    b.Quad(previous[k], previous[k2], next[k2], next[k], colour);
                }
                previous = next;
            }

            Cap(b, previous, front: false, colour: colour);
        }

        /// <summary>Close one end of a loft with a fan.</summary>
        private static void Cap(MeshBuilder b, Vec3[] ring, bool front, Rgb colour)
        {
            var centre = Vec3.Zero;
            foreach (var p in ring) centre = centre + p;
            centre = centre * (1.0 / ring.Length);

            for (var k = 0; k < ring.Length; k++)
            {
                var k2 = (k + 1) % ring.Length;
                if (front) b.Tri(centre, ring[k2], ring[k], colour);
                else b.Tri(centre, ring[k], ring[k2], colour);
            }
        }

        /// <summary>The tub opening, the roll hoop, the halo and the driver.</summary>
        private static void Cockpit(MeshBuilder b, Rgb livery)
        {
            // The opening, sunk into the deck so the driver sits in a hole.
            b.Box(new Vec3(0, 0.44, 0.30), new Vec3(0.46, 0.06, 1.05), Dark);

            // Shoulders either side of it.
            b.Box(new Vec3(-0.30, 0.46, 0.05), new Vec3(0.14, 0.10, 0.55), livery);
            b.Box(new Vec3(0.30, 0.46, 0.05), new Vec3(0.14, 0.10, 0.55), livery);

            // Helmet, and a visor that catches a different band of light.
            b.Ball(new Vec3(0, 0.56, 0.28), 0.15, 8, 5, Trim);
            b.Box(new Vec3(0, 0.57, 0.41), new Vec3(0.20, 0.07, 0.06), Visor);

            // Roll hoop over the driver's head, and the airbox behind it.
            b.Box(new Vec3(0, 0.62, -0.02), new Vec3(0.30, 0.30, 0.16), Carbon);
            b.Box(new Vec3(0, 0.58, -0.30), new Vec3(0.26, 0.22, 0.44), livery);

            // The engine cover fin, running back to the wing.
            b.Quad(
                new Vec3(0, 0.66, -0.30), new Vec3(0, 0.48, -1.20),
                new Vec3(0, 0.48, -1.90), new Vec3(0, 0.72, -1.60), livery);
            b.Quad(
                new Vec3(0, 0.72, -1.60), new Vec3(0, 0.48, -1.90),
                new Vec3(0, 0.48, -1.20), new Vec3(0, 0.66, -0.30), livery);

            Halo(b);
        }

        /// <summary>
        /// The halo, as a hoop on a post.
        /// </summary>
        /// <remarks>
        /// Seven segments around the front of the cockpit. It is the one part
        /// of a modern car that is unmistakable in silhouette from any angle,
        /// which is worth more than the forty triangles it costs.
        /// </remarks>
        private static void Halo(MeshBuilder b)
        {
            const double y = 0.60, r = 0.36, half = 0.09;
            const int segments = 7;

            for (var i = 0; i < segments; i++)
            {
                var a0 = Math.PI * (0.08 + 0.84 * i / segments);
                var a1 = Math.PI * (0.08 + 0.84 * (i + 1) / segments);

                var p0 = new Vec3(-Math.Cos(a0) * 0.46, y + Math.Sin(a0) * 0.06, 0.30 + Math.Sin(a0) * r);
                var p1 = new Vec3(-Math.Cos(a1) * 0.46, y + Math.Sin(a1) * 0.06, 0.30 + Math.Sin(a1) * r);

                b.Box(new Vec3((p0.X + p1.X) * 0.5, (p0.Y + p1.Y) * 0.5, (p0.Z + p1.Z) * 0.5),
                    new Vec3(Math.Max(Math.Abs(p1.X - p0.X), half * 0.7),
                             half * 0.6,
                             Math.Max(Math.Abs(p1.Z - p0.Z), half * 0.7)),
                    Carbon);
            }

            // The post down the centreline, ahead of the driver.
            b.Box(new Vec3(0, 0.54, 0.66), new Vec3(0.06, 0.20, 0.09), Carbon);
        }

        /// <summary>Sidepod inlets and the shoulder above them.</summary>
        private static void Sidepods(MeshBuilder b)
        {
            for (var side = -1; side <= 1; side += 2)
            {
                // The mouth, dark so it reads as a hole rather than a panel.
                b.Box(new Vec3(side * 0.52, 0.16, 0.52), new Vec3(0.16, 0.26, 0.14), Dark);

                // Bargeboard ahead of it, down at floor level.
                b.Box(new Vec3(side * 0.46, -0.02, 1.05), new Vec3(0.05, 0.20, 0.60), Carbon);

                // The winglet on top of the pod.
                b.Box(new Vec3(side * 0.44, 0.40, -0.30), new Vec3(0.34, 0.03, 0.40), Carbon);
            }
        }

        /// <summary>
        /// The front wing.
        /// </summary>
        /// <remarks>
        /// Two planes and two endplates. The endplates are what actually
        /// carry the shape — a bare plank across the nose reads as a bumper,
        /// and the two vertical fins at the tips are the thing that says
        /// open-wheel.
        /// </remarks>
        private static void FrontWing(MeshBuilder b, Rgb livery)
        {
            b.Box(new Vec3(0, -0.09, 3.02), new Vec3(1.74, 0.04, 0.44), Carbon);
            b.Box(new Vec3(0, -0.02, 3.20), new Vec3(1.60, 0.04, 0.26), livery);

            for (var side = -1; side <= 1; side += 2)
            {
                b.Box(new Vec3(side * 0.87, 0.00, 3.06), new Vec3(0.05, 0.26, 0.56), Trim);
                // The pylon back to the nose, so the wing is attached to something.
                b.Box(new Vec3(side * 0.10, -0.03, 2.86), new Vec3(0.04, 0.14, 0.30), Carbon);
            }
        }

        /// <summary>The rear wing, its endplates and the beam under it.</summary>
        private static void RearWing(MeshBuilder b, Rgb livery)
        {
            b.Box(new Vec3(0, 0.80, -2.18), new Vec3(1.34, 0.05, 0.42), Carbon);
            b.Box(new Vec3(0, 0.70, -2.28), new Vec3(1.30, 0.04, 0.22), livery);
            b.Box(new Vec3(0, 0.36, -2.20), new Vec3(0.90, 0.04, 0.26), Carbon);

            for (var side = -1; side <= 1; side += 2)
            {
                b.Box(new Vec3(side * 0.68, 0.60, -2.16), new Vec3(0.04, 0.50, 0.60), Trim);
            }

            // The light in the middle of the crash structure.
            b.Box(new Vec3(0, 0.06, -2.36), new Vec3(0.10, 0.10, 0.05), Gold);

            // Pylons from the gearbox up to the wing.
            b.Box(new Vec3(0, 0.58, -2.10), new Vec3(0.07, 0.40, 0.20), Carbon);
        }

        /// <summary>The floor and diffuser, seen from behind and from a kerb.</summary>
        private static void Floor(MeshBuilder b)
        {
            b.Box(new Vec3(0, -0.11, -0.30), new Vec3(1.05, 0.03, 2.60), Carbon);

            // The diffuser ramp, stepped rather than swept: three boxes read
            // as a ramp under four bands of shading and cost nine faces.
            for (var i = 0; i < 3; i++)
            {
                b.Box(new Vec3(0, -0.10 + i * 0.035, -1.70 - i * 0.22),
                    new Vec3(0.94 - i * 0.06, 0.03, 0.26), Dark);
            }
        }
    }
}
