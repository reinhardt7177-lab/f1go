using System;
using System.Collections.Generic;

namespace MumuF1
{
    /// <summary>
    /// The circuit definitions.
    /// </summary>
    /// <remarks>
    /// Lengths, radii and gradients are read off track maps and elevation
    /// profiles rather than survey data, then adjusted so the lap closes and
    /// the total distance comes out right. The intent is that each corner
    /// <em>drives</em> like its real counterpart — that the climb to Remus is
    /// genuinely long and the Senna S genuinely steep — not that the geometry
    /// would survive a tape measure.
    /// </remarks>
    public static class Circuits
    {
        /// <summary>
        /// A banked oval, and the place to start.
        /// </summary>
        /// <remarks>
        /// The real circuits are ones to learn. This is not — it is two
        /// straights and two long left-handers, so there is nothing to
        /// memorise and the car is the only thing left to pay attention to.
        /// Getting a feel for how the rear steps out, what the tyres do as
        /// they come up to temperature and where the braking point actually
        /// is all happen faster when the corner is the same corner every
        /// time.
        ///
        /// Flat, and it stays flat. Every turn is the same radius and the two
        /// straights are the same length, so the shape closes on its own
        /// without the correction the road circuits need — the four bends sum
        /// to exactly one revolution by construction rather than by
        /// adjustment.
        ///
        /// The banking is gentle, three and a half degrees. Enough that the
        /// car leans into the corner and carries speed it could not carry
        /// flat, not so much that it drives itself round — and small for a
        /// second reason: banking tilts the whole cross-section, run-off and
        /// grass included, so a steep oval builds a hillside forty metres out
        /// on either side.
        /// </remarks>
        public static readonly CircuitSpec PracticeOval = new CircuitSpec
        {
            Id = "oval",
            Name = "Practice Oval",
            Country = "Anywhere",
            DefaultHalfWidth = 9.5,
            DefaultRunoff = 20,
            KerbWidth = 1.6,
            StartLine = 0,
            SectorSplits = new double[] { 1124, 2248, 3372 },
            Sections = new[]
            {
                new CircuitSection { Name = "Front Straight", Length = 900 },
                new CircuitSection { Name = "T1", Length = 393, Radius = -250, Banking = -0.06 },
                new CircuitSection { Name = "T2", Length = 393, Radius = -250, Banking = -0.06 },
                new CircuitSection { Name = "Back Straight", Length = 900 },
                new CircuitSection { Name = "T3", Length = 393, Radius = -250, Banking = -0.06 },
                new CircuitSection { Name = "T4", Length = 393, Radius = -250, Banking = -0.06 }
            }
        };

        /// <summary>Austria. Ten corners, three long climbs, the shortest lap here.</summary>
        public static readonly CircuitSpec RedBullRing = new CircuitSpec
        {
            Id = "redbullring",
            Name = "Red Bull Ring",
            Country = "Austria",
            DefaultHalfWidth = 8.0,
            DefaultRunoff = 16,
            KerbWidth = 1.8,
            StartLine = 0,
            SectorSplits = new double[] { 1450, 2900, 4318 },
            Sections = new[]
            {
                new CircuitSection { Name = "Start / Finish", Length = 518, Gradient = 0.02, HalfWidth = 9.2 },
                new CircuitSection { Name = "T1 Niki Lauda", Length = 60, Radius = -42, Gradient = 0.06, HalfWidth = 7.6 },
                new CircuitSection { Name = "Climb to Remus", Length = 810, Gradient = 0.09, HalfWidth = 9 },
                new CircuitSection { Name = "T3 Remus", Length = 76, Radius = -46, Gradient = 0.02, HalfWidth = 7.6 },
                new CircuitSection { Name = "Run to Schlossgold", Length = 583, Gradient = -0.02, HalfWidth = 9 },
                new CircuitSection { Name = "T4 Schlossgold", Length = 96, Radius = -78, Gradient = -0.04 },
                new CircuitSection { Name = "Descent to Rauch", Length = 422, Gradient = -0.07 },
                new CircuitSection { Name = "T5", Length = 74, Radius = -56, Gradient = -0.05 },
                new CircuitSection { Name = "T6 Rauch", Length = 90, Radius = 120, Gradient = -0.03 },
                new CircuitSection { Name = "Run to Wurth", Length = 346, Gradient = -0.02 },
                new CircuitSection { Name = "T7 Wurth", Length = 104, Radius = -84, Gradient = 0.01 },
                new CircuitSection { Name = "T8", Length = 92, Radius = 110, Gradient = 0.02 },
                new CircuitSection { Name = "Run to Rindt", Length = 345, Gradient = 0.01, HalfWidth = 9 },
                new CircuitSection { Name = "T9 Rindt", Length = 118, Radius = -92, Gradient = -0.01, HalfWidth = 7.6 },
                new CircuitSection { Name = "T10", Length = 130, Radius = -110, Gradient = -0.02 },
                new CircuitSection { Name = "Pit straight approach", Length = 454, Gradient = -0.01, HalfWidth = 9.2 }
            }
        };

        /// <summary>Brazil. Anticlockwise, and it climbs the whole last sector.</summary>
        public static readonly CircuitSpec Interlagos = new CircuitSpec
        {
            Id = "interlagos",
            Name = "Interlagos",
            Country = "Brazil",
            DefaultHalfWidth = 7.6,
            DefaultRunoff = 12,
            KerbWidth = 1.8,
            StartLine = 0,
            SectorSplits = new double[] { 1440, 2880, 4309 },
            Sections = new[]
            {
                new CircuitSection { Name = "Start / Finish", Length = 197, Gradient = -0.02, HalfWidth = 9 },
                new CircuitSection { Name = "T1 Senna S", Length = 78, Radius = 40, Gradient = -0.08, HalfWidth = 7.2 },
                new CircuitSection { Name = "T2 Senna S", Length = 80, Radius = -54, Gradient = -0.06 },
                new CircuitSection { Name = "Run to Curva do Sol", Length = 74, Gradient = -0.03, HalfWidth = 7.6 },
                new CircuitSection { Name = "T3 Curva do Sol", Length = 170, Radius = 92, Gradient = -0.01 },
                new CircuitSection { Name = "Reta Oposta", Length = 777, Gradient = -0.02, HalfWidth = 9 },
                new CircuitSection { Name = "T4 Descida do Lago", Length = 96, Radius = 60, Gradient = -0.03, HalfWidth = 7.6 },
                new CircuitSection { Name = "T5", Length = 84, Radius = 78, Gradient = 0.01 },
                new CircuitSection { Name = "Climb to Ferradura", Length = 477, Gradient = 0.05 },
                new CircuitSection { Name = "T6 Ferradura", Length = 150, Radius = -64, Gradient = 0.03 },
                new CircuitSection { Name = "T7 Laranja", Length = 96, Radius = 89, Gradient = -0.01 },
                new CircuitSection { Name = "Run to Pinheirinho", Length = 348, Gradient = -0.02 },
                new CircuitSection { Name = "T8 Pinheirinho", Length = 104, Radius = 56 },
                new CircuitSection { Name = "T9 Bico de Pato", Length = 90, Radius = -44, HalfWidth = 7.2 },
                new CircuitSection { Name = "T10 Mergulho", Length = 130, Radius = 70, Gradient = -0.01, HalfWidth = 7.6 },
                new CircuitSection { Name = "Run to Juncao", Length = 361, Gradient = -0.02 },
                new CircuitSection { Name = "T11 Juncao", Length = 100, Radius = 48, Gradient = 0.02, HalfWidth = 7.2 },
                new CircuitSection { Name = "Subida dos Boxes", Length = 472, Gradient = 0.08, HalfWidth = 9 },
                new CircuitSection { Name = "T12 Arquibancadas", Length = 180, Radius = -347, Gradient = 0.05 },
                new CircuitSection { Name = "Pit straight approach", Length = 209, Gradient = 0.02 }
            }
        };

        /// <summary>
        /// Monza. The Temple of Speed, and the opposite question to the
        /// others.
        /// </summary>
        /// <remarks>
        /// The Red Bull Ring asks what the aerodynamic platform does over
        /// elevation. Monza asks what happens when you take the wings off:
        /// three-quarters of the lap is full throttle, the corners that
        /// remain are two chicanes, two right-handers and the Parabolica, and
        /// the whole compromise moves to the straight-line end. Run the Monza
        /// trim preset here and the lap comes alive; run the Monaco trim and
        /// you lose thirty km/h down every straight for grip you barely use.
        ///
        /// Flat, deliberately — Monza's real elevation change is a couple of
        /// metres and pretending otherwise would put a gradient where the
        /// braking zones are.
        /// </remarks>
        public static readonly CircuitSpec Monza = new CircuitSpec
        {
            Id = "monza",
            Name = "Monza",
            Country = "Italy",
            DefaultHalfWidth = 7.7,
            DefaultRunoff = 14,
            KerbWidth = 1.8,
            StartLine = 0,
            SectorSplits = new double[] { 2360, 4180, 5793 },
            Sections = new[]
            {
                new CircuitSection { Name = "Rettifilo Tribune", Length = 539, HalfWidth = 9.0 },
                new CircuitSection { Name = "T1 Variante del Rettifilo", Length = 46, Radius = 30, HalfWidth = 7.0 },
                new CircuitSection { Name = "T2 Variante del Rettifilo", Length = 46, Radius = -32 },
                new CircuitSection { Name = "Run to Curva Grande", Length = 148, HalfWidth = 8.3 },
                new CircuitSection { Name = "T3 Curva Grande", Length = 500, Radius = 338, HalfWidth = 9.0 },
                new CircuitSection { Name = "Run to Roggia", Length = 306 },
                new CircuitSection { Name = "T4 Variante della Roggia", Length = 44, Radius = -28, HalfWidth = 7.0 },
                new CircuitSection { Name = "T5 Variante della Roggia", Length = 44, Radius = 26 },
                new CircuitSection { Name = "Run to Lesmo", Length = 461, HalfWidth = 8.3 },
                new CircuitSection { Name = "T6 Lesmo 1", Length = 100, Radius = 62, HalfWidth = 7.7 },
                new CircuitSection { Name = "Between the Lesmos", Length = 244 },
                new CircuitSection { Name = "T7 Lesmo 2", Length = 90, Radius = 58 },
                new CircuitSection { Name = "Curva del Serraglio", Length = 1112, HalfWidth = 9.0 },
                new CircuitSection { Name = "T8 Variante Ascari", Length = 58, Radius = -70, HalfWidth = 7.0 },
                new CircuitSection { Name = "T9 Variante Ascari", Length = 62, Radius = 56 },
                new CircuitSection { Name = "T10 Variante Ascari", Length = 58, Radius = -78 },
                new CircuitSection { Name = "Rettifilo Centrale", Length = 787, HalfWidth = 9.0 },
                new CircuitSection { Name = "T11 Parabolica", Length = 500, Radius = 138, HalfWidth = 8.3 },
                new CircuitSection { Name = "Run to the line", Length = 647, HalfWidth = 9.0 }
            }
        };

        /// <summary>
        /// Two long straights joined by constant-radius bends, flat, and wide
        /// enough to slide about on without leaving the tarmac.
        /// </summary>
        /// <remarks>
        /// Not a circuit so much as an instrument. Every vehicle-dynamics
        /// test runs here, because a measurement of braking distance or
        /// steady-state grip is only meaningful if the surface is uniform and
        /// level — on a real circuit the same test would be measuring its
        /// gradients instead.
        /// </remarks>
        public static readonly CircuitSpec ProvingGround = new CircuitSpec
        {
            Id = "proving",
            Name = "Proving Ground",
            Country = "Test bench",
            DefaultHalfWidth = 30,
            DefaultRunoff = 40,
            KerbWidth = 1.2,
            StartLine = 0,
            SectorSplits = new double[] { 1200, 1671, 3342 },
            Sections = new[]
            {
                new CircuitSection { Name = "Main Straight", Length = 1200 },
                new CircuitSection { Name = "Radius 150 Left", Length = 471, Radius = -150 },
                new CircuitSection { Name = "Return Straight", Length = 1200 },
                new CircuitSection { Name = "Radius 150 Left", Length = 471, Radius = -150 }
            }
        };

        /// <summary>
        /// Every circuit by id. The oval is first because it is where a new
        /// driver should start.
        /// </summary>
        public static readonly IReadOnlyDictionary<string, CircuitSpec> Specs =
            new Dictionary<string, CircuitSpec>(StringComparer.Ordinal)
            {
                { "oval", PracticeOval },
                { "redbullring", RedBullRing },
                { "interlagos", Interlagos },
                { "monza", Monza },
                { "proving", ProvingGround }
            };

        private static readonly Dictionary<string, Circuit> Cache =
            new Dictionary<string, Circuit>(StringComparer.Ordinal);

        /// <summary>
        /// Build a circuit by id, once.
        /// </summary>
        /// <remarks>
        /// Building is not cheap — the integration walks the lap at four
        /// metres, the spline resamples it at two, and the banking blur runs
        /// a thirty-one-wide window over the lot twice — and the result never
        /// changes, so it is cached. The lock is there because Unity loads
        /// scenes on one thread and may well ask for a circuit from a job on
        /// another; two threads racing here would otherwise build the same
        /// lap twice and hand out two different objects for the same track.
        /// </remarks>
        public static Circuit Get(string id)
        {
            lock (Cache)
            {
                if (Cache.TryGetValue(id, out var cached)) return cached;

                if (!Specs.TryGetValue(id, out var spec))
                {
                    throw new ArgumentException($"unknown circuit: {id}", nameof(id));
                }

                var circuit = Circuit.Build(spec);
                Cache[id] = circuit;
                return circuit;
            }
        }
    }
}
