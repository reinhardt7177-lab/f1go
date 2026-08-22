using UnityEngine;

namespace MumuF1.Game
{
    /// <summary>
    /// Keys to controls, with the same bindings the web version uses.
    /// </summary>
    /// <remarks>
    /// Steering is ramped rather than switched. A key is on or off, but a
    /// steering rack is not, and feeding a step into a tyre model with a
    /// relaxation length produces a snap the car cannot recover from —
    /// which is what makes a keyboard car feel like it is on ice.
    /// </remarks>
    [RequireComponent(typeof(CarController))]
    public class KeyboardDriver : MonoBehaviour
    {
        /// <summary>Seconds from centre to full lock.</summary>
        public float SteerTime = 0.28f;

        /// <summary>Seconds from full lock back to centre. Faster: letting
        /// go of a wheel is not the same gesture as turning it.</summary>
        public float ReturnTime = 0.14f;

        private CarController _car;
        private TouchDriver _touch;
        private float _steer;
        private bool _shiftArmed = true;

        private void Awake()
        {
            _car = GetComponent<CarController>();
            _touch = GetComponent<TouchDriver>();
        }

        private void Update()
        {
            /* Stand aside once a finger has touched the screen. Both of these
               write the same field in Update and Unity does not promise an
               order between them, so without this the controls would be
               whichever component ran second — and on a phone that is a
               coin toss taken every frame. A player who has picked the car up
               with their hands is not also on a keyboard. */
            if (_touch != null && _touch.Active) return;

            float dt = Time.deltaTime;
            float want = 0f;
            if (Key(KeyCode.A) || Key(KeyCode.LeftArrow)) want -= 1f;
            if (Key(KeyCode.D) || Key(KeyCode.RightArrow)) want += 1f;

            float rate = Mathf.Abs(want) > 0.01f ? dt / SteerTime : dt / ReturnTime;
            _steer = Mathf.MoveTowards(_steer, want, rate);

            bool throttle = Key(KeyCode.W) || Key(KeyCode.UpArrow);
            bool brake = Key(KeyCode.S) || Key(KeyCode.DownArrow);

            /* Automatic upshifts on road speed rather than on rpm: during
               wheelspin the engine sits on the limiter while the car is
               barely moving, and an rpm-triggered shift would run through
               all eight gears in the first half second. */
            double kmh = System.Math.Abs(_car.SpeedMs) * MumuF1.MathUtil.Kmh;
            bool wantShift = kmh > _car.Gear * 42;

            _car.Controls = new Controls
            {
                Throttle = throttle ? 1.0 : 0.0,
                Brake = brake ? 1.0 : 0.0,
                Steer = _steer,
                ShiftUp = (wantShift && _shiftArmed) || KeyDown(KeyCode.E),
                ShiftDown = KeyDown(KeyCode.Q),
                StraightMode = Key(KeyCode.F),
                Overtake = Key(KeyCode.LeftShift) || Key(KeyCode.RightShift)
            };
            _shiftArmed = !wantShift;

            /* One key for the aids, because a driver who wants the car to
               bite has to be able to switch them off, and one who does not
               should never have to find out they exist. */
            if (KeyDown(KeyCode.T)) _car.Aids = !_car.Aids;

            /* R is handled by Recovery, which knows where the circuit is.
               It used to be here, and it lifted the car a metre and a half
               from wherever it stood — which, a hundred metres below a track
               it had fallen off, is a hundred metres below the track. */
        }

        private static bool Key(KeyCode k) => Input.GetKey(k);
        private static bool KeyDown(KeyCode k) => Input.GetKeyDown(k);
    }
}
