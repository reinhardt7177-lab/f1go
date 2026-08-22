using System;
using System.Collections.Generic;
using NUnit.Framework;

namespace MumuF1.Tests
{
    /// <summary>
    /// The circuit drawn small, which is only useful if it is the right
    /// shape and if a car can be put on it.
    /// </summary>
    [TestFixture]
    public class MiniMapTests
    {
        private static IEnumerable<string> Ids
        {
            get
            {
                foreach (var id in Circuits.Specs.Keys) yield return id;
            }
        }

        [TestCaseSource(nameof(Ids))]
        public void StaysInsideItsBox(string id)
        {
            var map = MiniMap.Build(Circuits.Get(id));

            Assert.That(map.Count, Is.GreaterThan(32));
            foreach (var v in map.Points)
            {
                Assert.That(v, Is.InRange(0f, 1f), "the circuit runs off its own map");
            }
        }

        /// <summary>
        /// The shape is the point.
        /// </summary>
        /// <remarks>
        /// Scaling each axis to fill the box independently would make every
        /// circuit the same shape, and the shape is the entire reason a
        /// minimap tells you which corner is coming. So the aspect ratio the
        /// map is drawn at has to be the aspect ratio the circuit has.
        /// </remarks>
        [TestCaseSource(nameof(Ids))]
        public void KeepsTheCircuitsProportions(string id)
        {
            var circuit = Circuits.Get(id);
            var map = MiniMap.Build(circuit);

            double minX = double.PositiveInfinity, maxX = double.NegativeInfinity;
            double minZ = double.PositiveInfinity, maxZ = double.NegativeInfinity;
            for (var i = 0; i < 512; i++)
            {
                var p = circuit.Spline.SampleAt((double)i / 512 * circuit.Length).Position;
                minX = Math.Min(minX, p.X); maxX = Math.Max(maxX, p.X);
                minZ = Math.Min(minZ, p.Z); maxZ = Math.Max(maxZ, p.Z);
            }

            float mapMinX = 1, mapMaxX = 0, mapMinY = 1, mapMaxY = 0;
            for (var i = 0; i < map.Count; i++)
            {
                mapMinX = Math.Min(mapMinX, map.Points[i * 2]);
                mapMaxX = Math.Max(mapMaxX, map.Points[i * 2]);
                mapMinY = Math.Min(mapMinY, map.Points[i * 2 + 1]);
                mapMaxY = Math.Max(mapMaxY, map.Points[i * 2 + 1]);
            }

            var world = (maxX - minX) / (maxZ - minZ);
            var drawn = (mapMaxX - mapMinX) / (mapMaxY - mapMinY);

            Assert.That(drawn, Is.EqualTo(world).Within(0.02),
                "the circuit is drawn a different shape from the one it is");
        }

        /// <summary>
        /// A car at the start line lands on the line drawn for it.
        /// </summary>
        /// <remarks>
        /// The failure this guards against is the one that makes a minimap
        /// worse than none: a car driving alongside its own circuit because
        /// the dot and the outline were normalised by two different sums.
        /// </remarks>
        [TestCaseSource(nameof(Ids))]
        public void PutsTheCarOnTheCircuit(string id)
        {
            var circuit = Circuits.Get(id);
            var map = MiniMap.Build(circuit);

            for (var lap = 0.0; lap < 1.0; lap += 0.05)
            {
                MiniMap.PlaceAt(map, circuit, lap * circuit.Length, out var x, out var y);

                var nearest = double.PositiveInfinity;
                for (var i = 0; i < map.Count; i++)
                {
                    var dx = map.Points[i * 2] - x;
                    var dy = map.Points[i * 2 + 1] - y;
                    nearest = Math.Min(nearest, Math.Sqrt(dx * dx + dy * dy));
                }

                Assert.That(nearest, Is.LessThan(0.02),
                    $"at {lap:P0} of the lap the car is off its own outline");
            }
        }

        /// <summary>Distance past the line wraps rather than walking off the map.</summary>
        [Test]
        public void WrapsPastTheLine()
        {
            var circuit = Circuits.Get("oval");
            var map = MiniMap.Build(circuit);

            MiniMap.PlaceAt(map, circuit, 12, out var x0, out var y0);
            MiniMap.PlaceAt(map, circuit, 12 + circuit.Length * 3, out var x1, out var y1);

            Assert.That(x1, Is.EqualTo(x0).Within(1e-4));
            Assert.That(y1, Is.EqualTo(y0).Within(1e-4));
        }
    }
}
