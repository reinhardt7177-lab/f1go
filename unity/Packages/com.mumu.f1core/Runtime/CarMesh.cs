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
            /// The section's outline, anticlockwise seen from in front.
            /// </summary>
            /// <remarks>
            /// Which is to say the ring's own normal points along +Z, at the
            /// nose. Both the skin and the caps are wound from that fact, and
            /// getting it backwards turns the whole car inside out at once —
            /// invisible from outside, solid from within. It is the one
            /// modelling mistake that cannot be seen by reading the code, and
            /// it is why <c>CarMeshTests</c> measures the signed volume: the
            /// first version of this file had all three windings reversed and
            /// the test is the only reason that is not what shipped.
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
        /// Read the Z column and the car is there: a nose tip out at 3.32,
        /// the front axle at 1.98, the cockpit opening either side of the
        /// origin, the rear axle at −1.62 and the crash structure ending at
        /// −2.30. The waist column is the plan view and the top column is the
        /// side view, so the two together are the drawing.
        ///
        /// Two numbers hold the whole thing together, and the first draft got
        /// both wrong. The road is at y = −0.32 — the hub sits at +0.04 and a
        /// wheel is 0.36 in radius — so a floor at −0.10 stands the car 220 mm
        /// off the ground on stilts. It runs at −0.24 now, which is the 80 mm
        /// ride height <c>CarController.FloorY</c> already uses, so the model
        /// and the aerodynamics agree about where the plank is.
        ///
        /// And the waist was 0.62, against a wheel whose inner face is at
        /// 0.62. The body touched the tyres, which is the one thing a
        /// single-seater must not do: what makes it read as open-wheel is the
        /// daylight between the two. At 0.47 there is 150 mm of it.
        ///
        /// The floor lifts at both ends, which gives the car a visible rake
        /// and keeps the plank off the road over a kerb.
        /// </remarks>
        private static readonly Section[] Hull =
        {
            //            z      foot  waist  deck   floor  shldr   top
            new Section(3.32, 0.04, 0.06, 0.04, -0.06, 0.00, 0.06),
            new Section(2.90, 0.08, 0.11, 0.07, -0.10, -0.02, 0.14),
            new Section(2.30, 0.13, 0.17, 0.10, -0.16, -0.06, 0.20),
            new Section(1.98, 0.16, 0.20, 0.12, -0.19, -0.09, 0.23),
            new Section(1.40, 0.20, 0.25, 0.15, -0.22, -0.11, 0.28),
            new Section(0.85, 0.25, 0.32, 0.19, -0.24, -0.12, 0.34),
            new Section(0.42, 0.31, 0.43, 0.23, -0.24, -0.13, 0.38),
            new Section(-0.05, 0.35, 0.47, 0.25, -0.24, -0.13, 0.40),
            new Section(-0.60, 0.35, 0.45, 0.23, -0.24, -0.13, 0.44),
            new Section(-1.10, 0.29, 0.36, 0.18, -0.24, -0.12, 0.42),
            new Section(-1.62, 0.21, 0.25, 0.13, -0.23, -0.11, 0.34),
            new Section(-2.00, 0.13, 0.16, 0.08, -0.20, -0.10, 0.24),
            new Section(-2.30, 0.07, 0.09, 0.05, -0.16, -0.08, 0.14)
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
            new Vec3(-0.98, -0.33, -2.44), new Vec3(0.98, 0.68, 3.36));

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
                    /* Walked backwards around the front ring and forwards
                       around the back one. The rings run anticlockwise seen
                       from the nose, so following them in step would face
                       every panel inward — the bottom of the car would look
                       up. */
                    b.Quad(previous[k2], previous[k], next[k], next[k2], colour);
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
                if (front) b.Tri(centre, ring[k], ring[k2], colour);
                else b.Tri(centre, ring[k2], ring[k], colour);
            }
        }

        /// <summary>The tub opening, the roll hoop, the halo and the driver.</summary>
        private static void Cockpit(MeshBuilder b, Rgb livery)
        {
            // The opening, sunk into the deck so the driver sits in a hole.
            b.Box(new Vec3(0, 0.37, 0.30), new Vec3(0.40, 0.06, 1.00), Dark);

            // Shoulders either side of it.
            b.Box(new Vec3(-0.25, 0.39, 0.05), new Vec3(0.12, 0.09, 0.52), livery);
            b.Box(new Vec3(0.25, 0.39, 0.05), new Vec3(0.12, 0.09, 0.52), livery);

            // Helmet, and a visor that catches a different band of light.
            b.Ball(new Vec3(0, 0.45, 0.26), 0.14, 8, 5, Trim);
            b.Box(new Vec3(0, 0.46, 0.38), new Vec3(0.19, 0.07, 0.06), Visor);

            /* Roll hoop over the driver's head, and the airbox behind it.
               Its top lands 0.94 above the road, which is where a real one
               is — the regulations put the whole car under 0.95. */
            b.Box(new Vec3(0, 0.52, -0.02), new Vec3(0.26, 0.28, 0.16), Carbon);
            b.Box(new Vec3(0, 0.49, -0.30), new Vec3(0.23, 0.20, 0.44), livery);

            // The engine cover fin, running back to the wing.
            Fin(b, livery);

            Halo(b);
        }

        /// <summary>
        /// The shark fin, as a blade with thickness.
        /// </summary>
        /// <remarks>
        /// Two skins and a spine rather than one quad drawn twice. A surface
        /// with no thickness has no inside, so the outline pass — which draws
        /// the back faces pushed out along their normals — pushes both skins
        /// the same way and the fin loses its edge. Ten millimetres is enough
        /// to give it one.
        /// </remarks>
        private static void Fin(MeshBuilder b, Rgb livery)
        {
            var profile = new[]
            {
                new Vec3(0, 0.56, -0.30),
                new Vec3(0, 0.60, -1.55),
                new Vec3(0, 0.40, -1.95),
                new Vec3(0, 0.40, -1.10)
            };

            const double t = 0.012;

            for (var i = 0; i < profile.Length; i++)
            {
                var a = profile[i];
                var c = profile[(i + 1) % profile.Length];
                b.Quad(
                    new Vec3(-t, a.Y, a.Z), new Vec3(t, a.Y, a.Z),
                    new Vec3(t, c.Y, c.Z), new Vec3(-t, c.Y, c.Z), livery);
            }

            b.Quad(
                new Vec3(t, profile[0].Y, profile[0].Z), new Vec3(t, profile[1].Y, profile[1].Z),
                new Vec3(t, profile[2].Y, profile[2].Z), new Vec3(t, profile[3].Y, profile[3].Z), livery);
            b.Quad(
                new Vec3(-t, profile[3].Y, profile[3].Z), new Vec3(-t, profile[2].Y, profile[2].Z),
                new Vec3(-t, profile[1].Y, profile[1].Z), new Vec3(-t, profile[0].Y, profile[0].Z), livery);
        }

        /// <summary>
        /// The halo, as a hoop on a post.
        /// </summary>
        /// <remarks>
        /// Swept rather than assembled. It was seven axis-aligned boxes sized
        /// to span each arc segment, and axis-aligned is exactly what an arc
        /// is not: every box stuck out along whichever axis its segment
        /// happened to run, and the whole thing rendered as a pair of
        /// asterisks over the cockpit. A square section carried along the
        /// curve costs the same triangles and is the shape it is meant to be.
        ///
        /// It is worth its forty triangles. The halo is the one part of a
        /// modern car that is unmistakable in silhouette from any angle.
        /// </remarks>
        private static void Halo(MeshBuilder b)
        {
            const int segments = 9;
            const double t = 0.035;

            Vec3 On(double u)
            {
                var a = Math.PI * (0.06 + 0.88 * u);
                return new Vec3(
                    -Math.Cos(a) * 0.42,
                    0.50 + Math.Sin(a) * 0.055,
                    0.28 + Math.Sin(a) * 0.34);
            }

            var previous = Section4(On(0), On(1.0 / segments), t);

            for (var i = 1; i <= segments; i++)
            {
                var here = On((double)i / segments);
                var ahead = On(Math.Min(1.0, (i + 1.0) / segments));
                var next = Section4(here, i == segments ? here + (here - On((i - 1.0) / segments)) : ahead, t);

                for (var k = 0; k < 4; k++)
                {
                    var k2 = (k + 1) % 4;
                    b.Quad(previous[k2], previous[k], next[k], next[k2], Carbon);
                }
                previous = next;
            }

            // The post down the centreline, ahead of the driver.
            b.Box(new Vec3(0, 0.45, 0.62), new Vec3(0.05, 0.18, 0.08), Carbon);
        }

        /// <summary>
        /// A square section at <paramref name="at"/>, square to the line
        /// running towards <paramref name="towards"/>.
        /// </summary>
        private static Vec3[] Section4(Vec3 at, Vec3 towards, double half)
        {
            var dx = towards.X - at.X;
            var dz = towards.Z - at.Z;
            var len = Math.Sqrt(dx * dx + dz * dz);
            if (len < 1e-9) { dx = 1; dz = 0; len = 1; }
            dx /= len;
            dz /= len;

            /* Perpendicular in the ground plane, and straight up. Good enough
               for a hoop that only ever leans a few degrees — a full frame
               carried along the curve would buy nothing at this size. */
            var px = -dz * half;
            var pz = dx * half;

            return new[]
            {
                new Vec3(at.X - px, at.Y - half, at.Z - pz),
                new Vec3(at.X + px, at.Y - half, at.Z + pz),
                new Vec3(at.X + px, at.Y + half, at.Z + pz),
                new Vec3(at.X - px, at.Y + half, at.Z - pz)
            };
        }

        /// <summary>Sidepod inlets and the shoulder above them.</summary>
        private static void Sidepods(MeshBuilder b)
        {
            for (var side = -1; side <= 1; side += 2)
            {
                // The mouth, dark so it reads as a hole rather than a panel.
                b.Box(new Vec3(side * 0.40, -0.06, 0.50), new Vec3(0.14, 0.22, 0.12), Dark);

                // Bargeboard ahead of it, down at floor level.
                b.Box(new Vec3(side * 0.38, -0.15, 1.05), new Vec3(0.04, 0.18, 0.56), Carbon);

                // The winglet on top of the pod.
                b.Box(new Vec3(side * 0.34, 0.30, -0.35), new Vec3(0.26, 0.03, 0.36), Carbon);
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
            b.Box(new Vec3(0, -0.25, -0.30), new Vec3(0.92, 0.03, 2.60), Carbon);

            // The diffuser ramp, stepped rather than swept: three boxes read
            // as a ramp under four bands of shading and cost nine faces.
            for (var i = 0; i < 3; i++)
            {
                b.Box(new Vec3(0, -0.24 + i * 0.04, -1.70 - i * 0.22),
                    new Vec3(0.82 - i * 0.06, 0.03, 0.26), Dark);
            }
        }
    }
}
