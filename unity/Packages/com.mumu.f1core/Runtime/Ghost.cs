using System;
using System.Collections.Generic;

namespace MumuF1
{
    /// <summary>Where the car was, once.</summary>
    public struct GhostSample
    {
        public float X;
        public float Y;
        public float Z;
        public float Heading;

        /// <summary>Metres along the circuit centreline. Monotonic within a lap.</summary>
        public float Distance;
    }

    /// <summary>One recorded lap.</summary>
    public sealed class GhostLap
    {
        /// <summary>Lap time in seconds, as the timer recorded it.</summary>
        public double Time { get; }

        /// <summary>
        /// <c>[x, y, z, heading, distance]</c> per sample, at <see cref="Ghost.SampleHz"/>.
        /// </summary>
        /// <remarks>
        /// Single precision, matching the reference rather than improving on
        /// it. Position to a hundredth of a millimetre at any point on any of
        /// these circuits is far past what anyone can see, and the width is
        /// what the size budget was written against.
        /// </remarks>
        public float[] Path { get; }

        public GhostLap(double time, float[] path)
        {
            Time = time;
            Path = path ?? new float[0];
        }

        public int SampleCount => Path.Length / Ghost.Stride;
    }

    /// <summary>Where the ghost was, interpolated.</summary>
    public struct GhostFrame
    {
        public double X;
        public double Y;
        public double Z;
        public double Heading;
        public double Distance;

        /// <summary>Metres a second, from the two samples either side.</summary>
        public double Speed;

        /// <summary>True once the recorded lap has run out.</summary>
        public bool Finished;
    }

    /// <summary>
    /// The lap you drove, driving beside you. Ported from
    /// <c>f1sim/src/race/ghost.ts</c>.
    /// </summary>
    /// <remarks>
    /// A ghost is drawn, never simulated — it has no grip to solve for and
    /// nothing can hit it — so this stores a path rather than the inputs that
    /// produced one. A replay needs determinism; a ghost does not, and
    /// storing the answer instead of the question costs no second physics
    /// world, cannot drift if the tyre model is retuned, and keeps a lap
    /// recorded today playable after a change that would invalidate an input
    /// replay.
    ///
    /// A sample is five floats — x, y, z, heading, and distance along the
    /// centreline. Time is not stored because it is the index: sample
    /// <c>i</c> is the car at <c>i / SampleHz</c> seconds into the lap. That
    /// is a fifth of the file saved and it removes a whole class of bug where
    /// the timestamps and the positions disagree.
    ///
    /// The distance earns its place least obviously and matters most.
    /// Position says where to draw the ghost; distance says <em>when the
    /// ghost was here</em>, which is the only way to answer the one question
    /// a time trial is about. Comparing positions cannot: two cars at the
    /// same moment are in different places, and two cars in the same place
    /// were there at different times.
    ///
    /// Attitude is not stored. A ghost that rolls and pitches needs four more
    /// floats to say something nobody looks at from a hundred metres.
    /// </remarks>
    public static class Ghost
    {
        /// <summary>
        /// Samples a second.
        /// </summary>
        /// <remarks>
        /// Chosen rather than inherited. At 85 m/s this is a sample every
        /// 4.25 m; through a 100 m radius corner the straight line between
        /// two samples departs from the arc by 4.25² / (8 × 100) ≈ 2.3 cm,
        /// a tenth of the width of a tyre. Recording at the simulation's own
        /// 120 Hz would be six times the file for an error already far below
        /// what anyone can see.
        /// </remarks>
        public const int SampleHz = 20;

        /// <summary>Floats per sample: x, y, z, heading, distance.</summary>
        public const int Stride = 5;

        /// <summary>
        /// Longest lap worth keeping, in seconds.
        /// </summary>
        /// <remarks>
        /// A lap this slow is not going to be anybody's best, so the recording
        /// would be stored and never played. The cap exists so that a player
        /// who parks on the grass and goes to lunch does not write a megabyte
        /// into the store.
        /// </remarks>
        public const double MaxLapSeconds = 360;

        /// <summary>Seconds of recorded lap, from the sample count.</summary>
        public static double Duration(GhostLap lap) =>
            Math.Max(0, lap.Path.Length / Stride - 1) / (double)SampleHz;

        /// <summary>Shortest signed way round from <paramref name="a"/> to <paramref name="b"/> (rad).</summary>
        private static double AngleDelta(double a, double b)
        {
            const double twoPi = Math.PI * 2;
            var d = (b - a) % twoPi;
            if (d > Math.PI) d -= twoPi;
            if (d < -Math.PI) d += twoPi;
            return d;
        }

        /// <summary>
        /// Where the ghost was <paramref name="lapTime"/> seconds into its lap.
        /// </summary>
        /// <remarks>
        /// Linear between samples for position. Heading is interpolated
        /// <em>along the shortest arc</em>, and it has to be: a car pointing
        /// at 179° and then at −179° has turned two degrees, and a naive lerp
        /// sends it 358° the other way. At 20 Hz that shows up as the ghost
        /// spinning on the spot every time it crosses whichever compass
        /// bearing the circuit was authored around — an obvious bug that is
        /// invisible until the layout happens to put a corner there.
        ///
        /// Past the end the ghost holds its last sample and reports finished,
        /// so the caller can stop drawing a car that has already taken the
        /// flag rather than parking it on the road.
        /// </remarks>
        public static GhostFrame Sample(GhostLap lap, double lapTime)
        {
            var count = lap.Path.Length / Stride;

            if (count == 0) return new GhostFrame { Finished = true };

            var exact = Math.Max(0, lapTime) * SampleHz;

            if (exact >= count - 1)
            {
                var last = count - 1;
                return new GhostFrame
                {
                    X = At(lap, last, 0),
                    Y = At(lap, last, 1),
                    Z = At(lap, last, 2),
                    Heading = At(lap, last, 3),
                    Distance = At(lap, last, 4),
                    Speed = 0,
                    Finished = true
                };
            }

            var i = (int)Math.Floor(exact);
            var f = exact - i;
            var j = i + 1;

            var dx = At(lap, j, 0) - At(lap, i, 0);
            var dy = At(lap, j, 1) - At(lap, i, 1);
            var dz = At(lap, j, 2) - At(lap, i, 2);

            return new GhostFrame
            {
                X = At(lap, i, 0) + dx * f,
                Y = At(lap, i, 1) + dy * f,
                Z = At(lap, i, 2) + dz * f,
                Heading = At(lap, i, 3) + AngleDelta(At(lap, i, 3), At(lap, j, 3)) * f,
                Distance = At(lap, i, 4) + (At(lap, j, 4) - At(lap, i, 4)) * f,
                Speed = Math.Sqrt(dx * dx + dy * dy + dz * dz) * SampleHz,
                Finished = false
            };
        }

        private static double At(GhostLap lap, int sample, int field) =>
            lap.Path[sample * Stride + field];

        /// <summary>
        /// When the ghost reached <paramref name="distance"/> metres, in
        /// seconds into its lap — or null if it never did.
        /// </summary>
        /// <remarks>
        /// This is the whole of the delta readout: subtract the answer from
        /// the player's current lap time and the sign says whether they are up
        /// or down, at this point on the circuit rather than at this instant.
        ///
        /// Binary search, because the distance column is monotonic within a
        /// lap and a linear scan would be a thousand comparisons a frame for a
        /// number that changes by four metres.
        ///
        /// Null before the first sample or after the last, which is the honest
        /// answer rather than a clamped one: a delta against a point the ghost
        /// never reached is not a delta, and a clamped one reads as exactly
        /// zero in the place a driver is looking hardest.
        /// </remarks>
        public static double? TimeAtDistance(GhostLap lap, double distance)
        {
            var count = lap.Path.Length / Stride;
            if (count < 2) return null;

            if (distance < D(lap, 0) || distance > D(lap, count - 1)) return null;

            /* Lower bound: the first sample at or past `distance`, which is
               the ghost's *first arrival* there.

               That "first" is load-bearing rather than a detail. If the ghost
               was stationary for half a second — a spin, or a car sitting in
               the gravel — several samples share one distance, and taking the
               last of them would credit the player with the whole time the
               ghost stood still. The delta would read as a gain that was never
               made. */
            var lo = 0;
            var hi = count - 1;
            while (lo < hi)
            {
                var mid = (lo + hi) >> 1;
                if (D(lap, mid) >= distance) hi = mid;
                else lo = mid + 1;
            }

            if (lo == 0) return 0;

            var span = D(lap, lo) - D(lap, lo - 1);
            var f = span > 1e-6 ? (distance - D(lap, lo - 1)) / span : 1;
            return (lo - 1 + f) / SampleHz;
        }

        private static double D(GhostLap lap, int sample) => lap.Path[sample * Stride + 4];

        /// <summary>
        /// Base64 of the raw float bytes.
        /// </summary>
        /// <remarks>
        /// A store holds strings, and text of an array of floats is about four
        /// times the size of the bytes it describes — a 90 s lap is 1,800
        /// samples, which is 36 KB of float against something over 100 KB once
        /// every number has been printed with a decimal point. Base64 costs a
        /// third on top of the bytes, which still leaves it comfortably ahead,
        /// and it round-trips exactly where a printed float does not.
        ///
        /// No chunking here, unlike the reference: that exists to work around
        /// a browser throwing on a thirty-thousand-argument call, and
        /// <see cref="Buffer.BlockCopy"/> has no such limit.
        /// </remarks>
        public static string Encode(GhostLap lap)
        {
            var bytes = new byte[lap.Path.Length * sizeof(float)];
            Buffer.BlockCopy(lap.Path, 0, bytes, 0, bytes.Length);
            return Convert.ToBase64String(bytes);
        }

        /// <summary>The lap those bytes describe, or null if they do not describe one.</summary>
        public static GhostLap Decode(double time, string encoded)
        {
            if (string.IsNullOrEmpty(encoded)) return null;

            byte[] bytes;
            try
            {
                bytes = Convert.FromBase64String(encoded);
            }
            catch (FormatException)
            {
                return null;
            }

            /* A truncated or hand-edited entry is exactly how a byte count
               that is not a whole number of samples happens. */
            if (bytes.Length == 0 || bytes.Length % (Stride * sizeof(float)) != 0) return null;

            var path = new float[bytes.Length / sizeof(float)];
            Buffer.BlockCopy(bytes, 0, path, 0, bytes.Length);
            return new GhostLap(time, path);
        }
    }

    /// <summary>
    /// Accumulates one lap.
    /// </summary>
    /// <remarks>
    /// Fed the car's position every simulation tick and told the lap time; it
    /// decides for itself which ticks become samples. Driving that from the
    /// <em>lap clock</em> rather than from a tick counter is what keeps a
    /// sample at a known second even though the simulation runs at 120 Hz and
    /// the sample rate is 20 — no accumulator to drift, and the same lap
    /// driven twice produces samples at the same times.
    /// </remarks>
    public sealed class GhostRecorder
    {
        private readonly List<float> _samples = new List<float>();

        /// <summary>Index of the next sample owed, so a stalled frame cannot skip one.</summary>
        private int _next;

        private bool _overrun;

        /// <summary>Samples taken so far.</summary>
        public int Length => _samples.Count / Ghost.Stride;

        /// <summary>True once the lap has run past the cap and been abandoned.</summary>
        public bool Abandoned => _overrun;

        public void Reset()
        {
            _samples.Clear();
            _next = 0;
            _overrun = false;
        }

        /// <summary>
        /// Offer the car's state at <paramref name="lapTime"/> seconds into the lap.
        /// </summary>
        /// <remarks>
        /// Called every tick; takes a sample only when the lap clock has
        /// reached the next slot. A frame that swallowed several ticks fills
        /// every slot it passed rather than leaving a hole, which is what
        /// stops a hitch on a phone from shortening the recorded lap — and a
        /// short recording is a ghost that arrives everywhere early.
        /// </remarks>
        public void Record(double lapTime, GhostSample at)
        {
            if (_overrun) return;

            if (lapTime > Ghost.MaxLapSeconds)
            {
                _overrun = true;
                _samples.Clear();
                return;
            }

            while (_next <= lapTime * Ghost.SampleHz)
            {
                _samples.Add(at.X);
                _samples.Add(at.Y);
                _samples.Add(at.Z);
                _samples.Add(at.Heading);
                _samples.Add(at.Distance);
                _next++;
            }
        }

        /// <summary>
        /// The lap just finished, as a recording — or null if there is not
        /// enough of one to play back.
        /// </summary>
        public GhostLap Take(double time)
        {
            if (_overrun || Length < 2) return null;
            return new GhostLap(time, _samples.ToArray());
        }
    }

    /// <summary>
    /// Somewhere to keep a ghost between sessions.
    /// </summary>
    /// <remarks>
    /// An interface rather than an implementation, because this assembly has
    /// no host to store anything in — the reference reaches straight for
    /// <c>localStorage</c>, and the Unity side reaches for <c>PlayerPrefs</c>.
    /// Neither belongs here.
    ///
    /// Every method is allowed to fail silently. A blocked or corrupt store is
    /// not worth failing a session over: the lap still counted, it just will
    /// not be raced against.
    /// </remarks>
    public interface IGhostStore
    {
        GhostLap Load(string circuitId);
        void Save(string circuitId, GhostLap lap);
        void Clear(string circuitId);
    }
}
