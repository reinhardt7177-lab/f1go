using System;
using System.Collections.Generic;
using NUnit.Framework;

namespace MumuF1.Tests
{
    /// <summary>
    /// What stands beside the road, and where.
    /// </summary>
    /// <remarks>
    /// Two claims matter more than the rest and both are safety rather than
    /// taste. Nothing may stand anywhere a car reaches at racing speed. And
    /// the scatter must be the same scatter every time, on every machine, at
    /// every quality setting — a circuit is learned by its landmarks, and a
    /// tree that moves between loads is worse than no tree.
    /// </remarks>
    [TestFixture]
    public class TracksideTests
    {
        private static IEnumerable<string> Ids
        {
            get
            {
                foreach (var id in Circuits.Specs.Keys) yield return id;
            }
        }

        /// <summary>
        /// The hash is bit-for-bit the TypeScript's, so these are its
        /// numbers. Two versions that disagree would put the same circuit's
        /// scenery in two different places, which is the whole thing this
        /// exists to prevent.
        /// </summary>
        [Test]
        public void ScattersTheSameWayTheReferenceDoes()
        {
            Assert.That(Trackside.Hash(0), Is.EqualTo(0.11478774505667388).Within(1e-15));
            Assert.That(Trackside.Hash(1), Is.EqualTo(0.24678996880538762).Within(1e-15));
            Assert.That(Trackside.Hash(7), Is.EqualTo(0.38546495721675456).Within(1e-15));
            Assert.That(Trackside.Hash(1234), Is.EqualTo(0.52219093707390130).Within(1e-15));
        }

        [Test]
        public void KeepsTheHashInsideZeroToOne()
        {
            for (var n = -5000; n < 5000; n += 7)
            {
                var h = Trackside.Hash(n);
                Assert.That(h, Is.GreaterThanOrEqualTo(0.0));
                Assert.That(h, Is.LessThan(1.0));
            }
        }

        [TestCaseSource(nameof(Ids))]
        public void PlacesTheSameSceneryEveryTime(string id)
        {
            var circuit = Circuits.Get(id);
            var a = Trackside.Place(circuit);
            var b = Trackside.Place(circuit);

            Assert.That(b.Count, Is.EqualTo(a.Count));
            for (var i = 0; i < a.Count; i++)
            {
                Assert.That(b[i].Kind, Is.EqualTo(a[i].Kind));
                Assert.That(b[i].Position.X, Is.EqualTo(a[i].Position.X).Within(0));
                Assert.That(b[i].Position.Z, Is.EqualTo(a[i].Position.Z).Within(0));
                Assert.That(b[i].Yaw, Is.EqualTo(a[i].Yaw).Within(0));
                Assert.That(b[i].Scale, Is.EqualTo(a[i].Scale).Within(0));
            }
        }

        /// <summary>
        /// The one that would hurt. Nothing may stand on the road — and
        /// "the road" means the tarmac and its kerbs, because a car putting
        /// two wheels on a kerb is racing, not crashing.
        /// </summary>
        /// <remarks>
        /// The gantry is the deliberate exception: it spans the timing line
        /// because that is what a gantry does, and it clears the car by
        /// standing over it rather than beside it. That is asserted
        /// separately rather than waved through.
        /// </remarks>
        [TestCaseSource(nameof(Ids))]
        public void NeverStandsAnythingOnTheRoad(string id)
        {
            var circuit = Circuits.Get(id);

            foreach (var prop in Trackside.Place(circuit))
            {
                if (prop.Kind == PropKind.StartGantry) continue;

                var projection = circuit.Spline.Project(prop.Position);
                var road = circuit.HalfWidthAt(projection.S) + circuit.KerbWidth;

                Assert.That(Math.Abs(projection.T), Is.GreaterThan(road),
                    $"{id} puts a {prop.Kind} {Math.Abs(projection.T):F1} m from the centreline, "
                    + $"inside a {road:F1} m road");
            }
        }

        [TestCaseSource(nameof(Ids))]
        public void StandsTheGantryOverTheLineAndNotInIt(string id)
        {
            var circuit = Circuits.Get(id);
            var gantry = Trackside.Place(circuit)
                .Find(p => p.Kind == PropKind.StartGantry);

            Assert.That(gantry.Kind, Is.EqualTo(PropKind.StartGantry), "no gantry was placed");

            var projection = circuit.Spline.Project(gantry.Position);
            var wrapped = Math.Min(
                Math.Abs(projection.S - circuit.Spec.StartLine),
                circuit.Length - Math.Abs(projection.S - circuit.Spec.StartLine));

            Assert.That(wrapped, Is.LessThan(3), "the gantry is not over the timing line");
            Assert.That(Math.Abs(projection.T), Is.LessThan(1), "the gantry is off to one side");
        }

        /// <summary>
        /// Thinning removes trees; it never moves them. A player who learns
        /// to brake at a tree on a desktop has to find that same tree in
        /// that same place on a phone.
        /// </summary>
        [Test]
        public void ThinsTheForestWithoutMovingIt()
        {
            var circuit = Circuits.Get("redbullring");
            var full = Trackside.Place(circuit, 1.0);
            var thin = Trackside.Place(circuit, 0.5);

            var trees = new HashSet<string>(StringComparer.Ordinal);
            foreach (var p in full)
            {
                if (p.Kind == PropKind.Conifer || p.Kind == PropKind.Broadleaf)
                {
                    trees.Add($"{p.Kind}|{p.Position.X:R}|{p.Position.Z:R}");
                }
            }

            var kept = 0;
            foreach (var p in thin)
            {
                if (p.Kind != PropKind.Conifer && p.Kind != PropKind.Broadleaf) continue;
                kept++;
                Assert.That(trees, Contains.Item($"{p.Kind}|{p.Position.X:R}|{p.Position.Z:R}"),
                    "thinning moved a tree instead of removing one");
            }

            Assert.That(kept, Is.GreaterThan(0), "thinning removed the whole forest");
            Assert.That(kept, Is.LessThan(trees.Count), "thinning removed nothing");
        }

        [Test]
        public void PlacesSomethingOfEveryKind()
        {
            var found = new HashSet<PropKind>();
            foreach (var p in Trackside.Place(Circuits.Get("redbullring"))) found.Add(p.Kind);

            foreach (PropKind kind in Enum.GetValues(typeof(PropKind)))
            {
                Assert.That(found, Contains.Item(kind), $"nothing of kind {kind} was placed");
            }
        }

        /// <summary>
        /// One flag each side of every sector boundary, so the split you have
        /// just crossed is a thing in the world and not only a number on the
        /// display.
        /// </summary>
        [TestCaseSource(nameof(Ids))]
        public void FliesAFlagAtEverySectorBoundary(string id)
        {
            var circuit = Circuits.Get(id);
            var flags = new List<Placement>();
            foreach (var p in Trackside.Place(circuit))
            {
                if (p.Kind == PropKind.Flag) flags.Add(p);
            }

            Assert.That(flags.Count, Is.EqualTo(circuit.SectorSplits.Count * 2));

            foreach (var split in circuit.SectorSplits)
            {
                var nearest = double.PositiveInfinity;
                var target = circuit.Spline.SampleAt(split % circuit.Length).Position;
                foreach (var flag in flags)
                {
                    nearest = Math.Min(nearest, (flag.Position - target).Length);
                }
                Assert.That(nearest, Is.LessThan(60), $"no flag near the split at {split:F0} m");
            }
        }

        [TestCaseSource(nameof(Ids))]
        public void HoldsNoDegeneratePlacements(string id)
        {
            foreach (var p in Trackside.Place(Circuits.Get(id)))
            {
                Assert.That(double.IsNaN(p.Position.X) || double.IsInfinity(p.Position.X), Is.False);
                Assert.That(double.IsNaN(p.Position.Y) || double.IsInfinity(p.Position.Y), Is.False);
                Assert.That(double.IsNaN(p.Position.Z) || double.IsInfinity(p.Position.Z), Is.False);
                Assert.That(double.IsNaN(p.Yaw) || double.IsInfinity(p.Yaw), Is.False);
                Assert.That(p.Scale, Is.GreaterThan(0));
            }
        }

        /// <summary>
        /// Density zero has to mean an empty forest, not a crash and not a
        /// full one — it is what a machine that cannot afford the scenery
        /// asks for. The furniture that tells you where you are stays.
        /// </summary>
        [Test]
        public void StripsTheForestAtZeroDensityButKeepsTheFurniture()
        {
            var props = Trackside.Place(Circuits.Get("monza"), 0);
            var trees = 0;
            var furniture = 0;

            foreach (var p in props)
            {
                if (p.Kind == PropKind.Conifer || p.Kind == PropKind.Broadleaf) trees++;
                else furniture++;
            }

            Assert.That(trees, Is.EqualTo(0));
            Assert.That(furniture, Is.GreaterThan(0));
        }

        /// <summary>
        /// The barrier is swept from the road's own vertices, so it has to
        /// follow the road exactly: one quad per ring per barrier station,
        /// closed round the lap, and standing on the verge rather than
        /// hovering over it.
        /// </summary>
        [TestCaseSource(nameof(Ids))]
        public void SweepsAWallAlongEveryBarrierStation(string id)
        {
            var track = TrackMesh.Build(Circuits.Get(id), 8);
            Barriers.Build(track, out var face, out var cap);

            var quads = track.Rings * track.BarrierStations.Length;
            Assert.That(track.BarrierStations.Length, Is.EqualTo(2));
            Assert.That(face.VertexCount, Is.EqualTo(quads * 4));
            Assert.That(face.Indices.Length, Is.EqualTo(quads * 6));
            Assert.That(cap.VertexCount, Is.EqualTo(face.VertexCount));

            foreach (var i in face.Indices)
            {
                Assert.That(i, Is.InRange(0, face.VertexCount - 1));
            }
            foreach (var v in face.Positions)
            {
                Assert.That(float.IsNaN(v) || float.IsInfinity(v), Is.False);
            }
        }

        /// <summary>
        /// The wall has to be a wall: about a metre of it, with its foot
        /// under the verge rather than floating, and the cap sitting on top
        /// of the face rather than through it.
        /// </summary>
        [Test]
        public void StandsTheWallOnTheVergeAtTheHeightItClaims()
        {
            var track = TrackMesh.Build(Circuits.Get("monza"), 8);
            Barriers.Build(track, out var face, out var cap);

            // Monza is flat, so the mesh heights are the wall's heights.
            var lowest = double.PositiveInfinity;
            var highestFace = double.NegativeInfinity;
            for (var v = 0; v < face.VertexCount; v++)
            {
                lowest = Math.Min(lowest, face.Positions[v * 3 + 1]);
                highestFace = Math.Max(highestFace, face.Positions[v * 3 + 1]);
            }

            var highestCap = double.NegativeInfinity;
            for (var v = 0; v < cap.VertexCount; v++)
            {
                highestCap = Math.Max(highestCap, cap.Positions[v * 3 + 1]);
            }

            // The verge at the barrier line drops 0.1 m below the road.
            Assert.That(lowest, Is.LessThan(-0.1), "the wall's foot is hanging in the air");
            Assert.That(highestCap - lowest,
                Is.EqualTo(Barriers.Height - Barriers.Foot).Within(0.01));
            Assert.That(highestCap, Is.GreaterThan(highestFace), "the cap is under the face");
        }
    }
}
