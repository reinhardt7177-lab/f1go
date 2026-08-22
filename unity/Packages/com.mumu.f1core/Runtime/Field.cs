using System;
using System.Collections.Generic;

namespace MumuF1
{
    /// <summary>One of the other cars.</summary>
    public sealed class Rival
    {
        public string Name { get; internal set; }

        /// <summary>Paint, as an RGB hex string.</summary>
        public string Colour { get; internal set; }

        /// <summary>Fraction of the racing line's own speed this driver manages.</summary>
        public double Pace { get; internal set; }

        /// <summary>Distance along the centreline (m).</summary>
        public double Distance;

        /// <summary>Laps completed, one-based.</summary>
        public int Lap;

        /// <summary>Current speed (m/s) — for the gap readout and the renderer.</summary>
        public double Speed;

        public Vec3 Position;
        public double Heading;

        /// <summary>Session time at the flag, so a finisher stops being overtaken.</summary>
        public double? FinishedAt;

        /// <summary>
        /// Which side of the centreline this car's grid box is on (m).
        /// </summary>
        /// <remarks>
        /// A Formula 1 grid is not a queue. The boxes stagger left and right
        /// of the racing line so that no car is directly behind the one in
        /// front — which is what the start looks like, and also what makes the
        /// run to the first corner a race rather than a procession.
        /// </remarks>
        public double GridLateral { get; internal set; }
    }

    public sealed class FieldOptions
    {
        /// <summary>How many rivals. Nine makes a twenty-car grid look like ten.</summary>
        public int Count { get; set; } = 9;

        /// <summary>Fastest rival, as a fraction of the line's own pace.</summary>
        public double Fastest { get; set; } = 0.99;

        /// <summary>And the slowest.</summary>
        public double Slowest { get; set; } = 0.90;

        /// <summary>Metres between grid boxes along the road.</summary>
        /// <remarks>
        /// Eight, which is what the painted grid uses. Fourteen was a queue
        /// with room to accelerate into; this is a grid.
        /// </remarks>
        public double GridGap { get; set; } = 8;

        /// <summary>How far each box sits off the centreline (m).</summary>
        public double GridStagger { get; set; } = 3.1;
    }

    /// <summary>A row of the results, once the flag has fallen.</summary>
    public struct ClassificationRow
    {
        public string Name;
        public bool Player;
    }

    /// <summary>
    /// The rest of the grid, ported from <c>f1sim/src/race/field.ts</c>.
    /// </summary>
    /// <remarks>
    /// A race needs someone to race. The simulation models one car properly —
    /// a rigid body on four raycast wheels — and putting nine more of those in
    /// the world would multiply the physics cost by ten to produce opponents
    /// the player mostly sees from behind.
    ///
    /// So rivals are run along the racing line instead, at a fraction of the
    /// speed profile the line is worth. That profile already knows what every
    /// corner can be taken at, because it is the same one the autopilot
    /// drives to; a rival is therefore not following a scripted path so much
    /// as driving the same solution the AI does, less well. Give one a pace of
    /// 0.96 and it takes every corner four per cent below the limit, all the
    /// way round, which is what a slightly slower driver looks like.
    ///
    /// What this deliberately does not model is contact. Rivals do not collide
    /// with the player or with each other — they are traffic to be judged and
    /// passed, not objects to lean on. Making them physical is a later problem
    /// and a much larger one.
    /// </remarks>
    public sealed class Field
    {
        private static readonly string[] Names =
        {
            "VERGARA", "ANDERSSON", "KIM", "ROSSI", "DUBOIS",
            "NAKAMURA", "SILVA", "MULLER", "OKONKWO"
        };

        /* Paint rather than highlighter: these are read as a tint over a plain
           white car, so a fully saturated value comes back glowing. */
        private static readonly string[] Colours =
        {
            "#0f6b46", "#a8161d", "#c25410", "#1c4a9c", "#5b4a9e",
            "#b08a12", "#127d92", "#9c2450", "#4f6b28"
        };

        private readonly RacingLine _line;
        private readonly SpeedProfile _profile;
        private readonly double _lapLength;
        private readonly List<Rival> _rivals = new List<Rival>();

        public IReadOnlyList<Rival> Rivals => _rivals;

        /// <summary>
        /// How much of the grid stagger is still being applied, one down to
        /// zero.
        /// </summary>
        /// <remarks>
        /// The boxes are off the racing line and the race is on it, so the two
        /// have to be blended rather than switched: a car that jumped sideways
        /// onto the line at the moment the lights went out would look like it
        /// had been teleported. Three metres over about two seconds is the
        /// same drift a real field makes on the run to the first corner.
        /// </remarks>
        private double _gridBlend = 1;

        public Field(RacingLine line, SpeedProfile profile, double lapLength, FieldOptions options = null)
        {
            options = options ?? new FieldOptions();

            _line = line;
            _profile = profile;
            _lapLength = lapLength;

            for (var i = 0; i < options.Count; i++)
            {
                var t = options.Count == 1 ? 0 : i / (double)(options.Count - 1);

                _rivals.Add(new Rival
                {
                    Name = Names[i % Names.Length],
                    Colour = Colours[i % Colours.Length],
                    Pace = options.Fastest + (options.Slowest - options.Fastest) * t,

                    /* Ahead of the player, who starts last — the whole race is
                       then about getting through them rather than defending a
                       lead handed over at the lights. */
                    Distance = (options.Count - i) * options.GridGap,
                    Lap = 1,
                    Speed = 0,
                    Position = Vec3.Zero,
                    Heading = 0,
                    FinishedAt = null,

                    /* Pole on one side, second on the other, alternating back
                       down the order. The player is last, so their box is on
                       whichever side the count leaves free. */
                    GridLateral = (i % 2 == 0 ? 1 : -1) * options.GridStagger
                });
            }
        }

        /// <summary>Advance every rival.</summary>
        /// <param name="dt">the step (s).</param>
        /// <param name="raceTime">elapsed session time, for recording finishes.</param>
        /// <param name="totalLaps">null in practice, where nobody finishes.</param>
        /// <param name="onGrid">
        /// true while the field is held for the start, when the cars sit in
        /// their boxes rather than on the line.
        /// </param>
        public void Update(double dt, double raceTime, int? totalLaps, bool onGrid = false)
        {
            if (onGrid) _gridBlend = 1;
            else if (_gridBlend > 0) _gridBlend = Math.Max(0, _gridBlend - dt / 2);

            foreach (Rival rival in _rivals)
            {
                if (rival.FinishedAt != null) continue;

                /* The line's speed at this point, scaled by how good this
                   driver is. Sampling a little ahead rather than underfoot is
                   what stops a rival braking at the apex instead of before
                   it. */
                var target = _profile.Lookahead(rival.Distance, 30) * rival.Pace;

                /* Ease toward it rather than snapping: a rival that changed
                   speed instantly would close and open gaps in single frames,
                   which reads as teleporting when you are following one. */
                rival.Speed += (target - rival.Speed) * Math.Min(1, dt * 2.5);

                rival.Distance += rival.Speed * dt;
                if (rival.Distance >= _lapLength)
                {
                    rival.Distance -= _lapLength;
                    rival.Lap += 1;
                    if (totalLaps != null && rival.Lap > totalLaps.Value)
                    {
                        rival.FinishedAt = raceTime;
                    }
                }

                Vec3 p = _line.PointAt(rival.Distance);

                /* Heading from a short step along the line, which keeps a
                   rival pointing where it is going through a corner rather
                   than where the centreline happens to aim.

                   `atan2(dx, dz)`, and the sign of the second argument is the
                   whole of it. This read `-(ahead.Z - p.Z)` — the reference's
                   convention, where forward is −Z — and every other heading in
                   this project is Unity's, where forward is +Z: the start
                   heading, the roadside props, the gantry over the line. The
                   renderer feeds this straight into a Y rotation, so a rival
                   travelling along +Z faced backwards down the circuit while
                   one travelling along +X faced correctly. A mirror about the
                   X axis, on nine cars out of ten. */
                Vec3 ahead = _line.PointAt((rival.Distance + 4) % _lapLength);
                rival.Heading = Math.Atan2(ahead.X - p.X, ahead.Z - p.Z);

                /* And out to the grid box while the field is still held.
                   `Left` at this point on the circuit rather than a world
                   axis, so the stagger stays square to the road wherever the
                   grid is. */
                if (_gridBlend > 0)
                {
                    Vec3 left = _line.LeftAt(rival.Distance);
                    var outBy = rival.GridLateral * _gridBlend;
                    rival.Position = new Vec3(
                        p.X + left.X * outBy,
                        p.Y + left.Y * outBy,
                        p.Z + left.Z * outBy);
                }
                else
                {
                    rival.Position = p;
                }
            }
        }

        /// <summary>
        /// Where the player's box sits off the centreline (m).
        /// </summary>
        /// <remarks>
        /// They start last, so it is the side the alternating order leaves
        /// free — which is what stops the player being parked on top of the
        /// car directly in front of them.
        /// </remarks>
        public double PlayerGridLateral =>
            _rivals.Count == 0 ? 0 : -_rivals[_rivals.Count - 1].GridLateral;

        /// <summary>Total distance covered, for ordering the field.</summary>
        private double Covered(Rival rival)
        {
            /* Finishers rank by when they took the flag and always ahead of
               anyone still running. */
            if (rival.FinishedAt != null) return FinishedRank(rival.FinishedAt.Value);
            return (rival.Lap - 1) * _lapLength + rival.Distance;
        }

        /// <summary>
        /// A sort key that puts finishers above everyone still on the road,
        /// earliest first.
        /// </summary>
        /// <remarks>
        /// The reference uses <c>Number.MAX_SAFE_INTEGER</c>, which is 2^53−1.
        /// The same value is spelled out here rather than reached for as
        /// <c>double.MaxValue</c>, because at 1e308 subtracting a race time
        /// changes nothing at all — every finisher would compare exactly equal
        /// and the finishing order would be whatever the sort happened to do.
        /// </remarks>
        private static double FinishedRank(double finishedAt) => 9007199254740991.0 - finishedAt;

        /// <summary>Where the player sits, one-based.</summary>
        /// <param name="playerLap">laps completed, one-based like the rivals'.</param>
        /// <param name="playerDistance">metres into the current lap.</param>
        /// <param name="playerFinished">session time at the flag, or null.</param>
        public int PositionOf(int playerLap, double playerDistance, double? playerFinished)
        {
            var mine = PlayerCovered(playerLap, playerDistance, playerFinished);

            var ahead = 0;
            foreach (Rival rival in _rivals)
            {
                if (Covered(rival) > mine) ahead++;
            }

            return ahead + 1;
        }

        private double PlayerCovered(int playerLap, double playerDistance, double? playerFinished) =>
            playerFinished != null
                ? FinishedRank(playerFinished.Value)
                : (playerLap - 1) * _lapLength + playerDistance;

        /// <summary>Everyone in finishing order, player included, for the results.</summary>
        public IReadOnlyList<ClassificationRow> Classification(
            int playerLap, double playerDistance, double? playerFinished)
        {
            var rows = new List<(string Name, bool Player, double Covered, int Seed)>();

            foreach (Rival r in _rivals) rows.Add((r.Name, false, Covered(r), rows.Count));
            rows.Add(("YOU", true, PlayerCovered(playerLap, playerDistance, playerFinished), rows.Count));

            /* The seed is the tie-break, and it is not decoration. JavaScript's
               sort has been stable since ES2019, so in the reference two cars
               dead level keep the order they were built in — grid order, with
               the player last. List.Sort is an introsort and is not stable, so
               without this the same tie would come out in whatever order the
               partitioning happened to leave, and a dead heat at the line
               would classify differently on two runs of the same race. */
            rows.Sort((a, b) =>
            {
                var byDistance = b.Covered.CompareTo(a.Covered);
                return byDistance != 0 ? byDistance : a.Seed.CompareTo(b.Seed);
            });

            var order = new List<ClassificationRow>(rows.Count);
            foreach ((string Name, bool Player, double Covered, int Seed) row in rows)
            {
                order.Add(new ClassificationRow { Name = row.Name, Player = row.Player });
            }

            return order;
        }

        /// <summary>The car immediately ahead on the road, for the gap readout.</summary>
        public double? GapAhead(int playerLap, double playerDistance)
        {
            var mine = (playerLap - 1) * _lapLength + playerDistance;

            double? best = null;
            foreach (Rival rival in _rivals)
            {
                var d = Covered(rival) - mine;
                if (d > 0 && (best == null || d < best.Value)) best = d;
            }

            return best;
        }
    }
}
