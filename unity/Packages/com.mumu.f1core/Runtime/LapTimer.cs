using System;
using System.Collections.Generic;

namespace MumuF1
{
    /// <summary>One sector, once it has been driven.</summary>
    public readonly struct SectorTime
    {
        public readonly int Index;
        public readonly double Time;

        /// <summary>True when this is the best time recorded for the sector.</summary>
        public readonly bool PersonalBest;

        public SectorTime(int index, double time, bool personalBest)
        {
            Index = index;
            Time = time;
            PersonalBest = personalBest;
        }
    }

    /// <summary>A lap, once it is over.</summary>
    public sealed class CompletedLap
    {
        public int Number { get; internal set; }
        public double Time { get; internal set; }
        public double[] Sectors { get; internal set; }

        /// <summary>A lap with any wheel beyond the white line does not count.</summary>
        public bool Valid { get; internal set; }
    }

    /// <summary>
    /// Lap and sector timing.
    /// </summary>
    /// <remarks>
    /// Everything here is arithmetic on <c>(s, t)</c> — the pair the
    /// centreline produces from a world position. Crossing the timing line
    /// is a wrap in <c>s</c>; a sector split is <c>s</c> passing a threshold;
    /// running wide is <c>|t|</c> exceeding the road half-width. No trigger
    /// volumes, no colliders, no special-case geometry anywhere on the track
    /// — which is the whole reason the centreline was worth porting first.
    /// </remarks>
    public sealed class LapTimer
    {
        private readonly Circuit _circuit;

        /// <summary>Laps started, 1-based. Zero until the line is first crossed.</summary>
        public int Lap { get; private set; }

        /// <summary>Time since the timing line (s).</summary>
        public double LapTime { get; private set; }

        /// <summary>Sector currently being driven, 0-based.</summary>
        public int Sector { get; private set; }

        /// <summary>Splits banked so far this lap.</summary>
        public IReadOnlyList<double> CurrentSectors => _currentSectors;

        public CompletedLap BestLap { get; private set; }
        public CompletedLap LastLap { get; private set; }
        public IReadOnlyList<double> BestSectors => _bestSectors;
        public IReadOnlyList<CompletedLap> History => _history;

        private readonly List<double> _currentSectors = new List<double>();
        private readonly double[] _bestSectors;
        private readonly List<CompletedLap> _history = new List<CompletedLap>();

        /// <summary>Cleared at the timing line; set the moment a wheel runs wide.</summary>
        private bool _lapValid = true;

        private bool _started;
        private double _lastS;

        /// <summary>Distance travelled this lap, used to reject a spurious wrap.</summary>
        private double _travelled;

        public LapTimer(Circuit circuit)
        {
            _circuit = circuit ?? throw new ArgumentNullException(nameof(circuit));
            _bestSectors = new double[circuit.SectorSplits.Count];
            for (var i = 0; i < _bestSectors.Length; i++) _bestSectors[i] = double.PositiveInfinity;
            _lapValid = true;

            /* On lap one before the first tick, not lap zero.
               `Update` sets this on the tick it first runs, which was
               indistinguishable from setting it here until the caller stopped
               ticking the timer on a held grid — and then the start card read
               "LAP 0" over a car waiting for the lights. A timer that has not
               started is not between laps, it is on its first. */
            Lap = 1;
        }

        /// <summary>
        /// Advance the timer.
        /// </summary>
        /// <param name="s">distance along the centreline.</param>
        /// <param name="onTrack">whether the car is within the white lines.</param>
        /// <param name="dt">the step (s).</param>
        /// <returns>the lap just completed, if the line was crossed this tick.</returns>
        public CompletedLap Update(double s, bool onTrack, double dt)
        {
            var length = _circuit.Length;

            if (!_started)
            {
                _started = true;
                _lastS = s;
                Lap = 1;
                return null;
            }

            /* Unwrap progress across the timing line. A jump of more than
               half a lap in either direction is the line, not a teleport. */
            var raw = s - _lastS;
            var delta = raw;
            var crossedForward = false;

            if (raw < -length / 2)
            {
                delta = raw + length;
                crossedForward = true;
            }
            else if (raw > length / 2)
            {
                delta = raw - length;
            }

            _lastS = s;
            _travelled += delta;
            LapTime += dt;
            if (!onTrack) _lapValid = false;

            /* Sector splits. The travelled guard stops a car that rolls back
               and forth over a line from banking the same sector repeatedly. */
            var splits = _circuit.SectorSplits;
            while (Sector < splits.Count - 1
                   && s >= splits[Sector]
                   && _travelled >= splits[Sector] * 0.5)
            {
                _currentSectors.Add(LapTime - Banked());
                Sector++;
            }

            if (crossedForward && _travelled > length * 0.5) return CompleteLap();
            return null;
        }

        private double Banked()
        {
            var total = 0.0;
            foreach (var t in _currentSectors) total += t;
            return total;
        }

        private CompletedLap CompleteLap()
        {
            var sectors = new double[_currentSectors.Count + 1];
            _currentSectors.CopyTo(sectors, 0);
            sectors[sectors.Length - 1] = LapTime - Banked();

            var lap = new CompletedLap
            {
                Number = Lap,
                Time = LapTime,
                Sectors = sectors,
                Valid = _lapValid
            };

            if (lap.Valid)
            {
                for (var i = 0; i < sectors.Length && i < _bestSectors.Length; i++)
                {
                    if (sectors[i] < _bestSectors[i]) _bestSectors[i] = sectors[i];
                }
                if (BestLap == null || lap.Time < BestLap.Time) BestLap = lap;
            }

            LastLap = lap;
            _history.Add(lap);
            BeginLap();
            return lap;
        }

        private void BeginLap()
        {
            Lap++;
            LapTime = 0;
            Sector = 0;
            _currentSectors.Clear();
            _lapValid = true;
            _travelled = 0;
        }

        /// <summary>Restart timing from scratch, keeping the records.</summary>
        public void ResetLap()
        {
            BeginLap();
            _started = false;
        }

        /// <summary>
        /// Best sector times added together — the theoretical best lap.
        /// </summary>
        /// <returns>null until every sector has been driven cleanly once.</returns>
        public double? OptimalLap()
        {
            var total = 0.0;
            foreach (var t in _bestSectors)
            {
                if (double.IsInfinity(t) || double.IsNaN(t)) return null;
                total += t;
            }
            return total;
        }
    }
}
