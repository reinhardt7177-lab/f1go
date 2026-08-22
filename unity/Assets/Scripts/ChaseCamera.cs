using UnityEngine;

namespace MumuF1.Game
{
    /// <summary>
    /// The camera, mounted on the car rather than chasing it.
    /// </summary>
    /// <remarks>
    /// This is the arrangement the web version arrived at the hard way,
    /// and the reasoning carries over exactly. A camera that chases a
    /// point in the world with an exponential filter carries a standing
    /// error of speed over follow-rate — at 300 km/h and a rate of 24
    /// that is three and a half metres — and everything about that error
    /// is wrong. It makes the distance to the car a function of how fast
    /// it is going, so the car surges away under acceleration and back
    /// towards you when you lift. And because the error is large and
    /// standing, every wobble in the frame clock moves the camera by a
    /// share of it: measured over a lap, the shot shook four times as
    /// hard on an uneven clock as on a steady one.
    ///
    /// Mounted on the car, the offset's target is a constant, so there is
    /// nothing to lag behind. Only the bearing follows, because that lag
    /// *is* the effect — it swings the camera round behind the car
    /// through a corner — and its error is proportional to yaw rate,
    /// which is small, and moves the shot sideways rather than along the
    /// lens.
    /// </remarks>
    public class ChaseCamera : MonoBehaviour
    {
        public Transform Target;

        /// <summary>Where the camera sits, in the car's own frame.</summary>
        public Vector3 Offset = new Vector3(0f, 2.3f, -7.5f);

        /// <summary>How quickly the bearing follows the car's.</summary>
        public float YawRate = 9f;

        /// <summary>What it looks at, above the car's origin.</summary>
        public float Aim = 0.6f;

        private float _yaw;
        private bool _placed;

        private void LateUpdate()
        {
            if (Target == null) return;

            float yaw = Target.eulerAngles.y;
            if (!_placed)
            {
                _yaw = yaw;
                _placed = true;
            }
            else
            {
                // Shortest way round, or it takes the long way home every
                // time the car crosses due south.
                float d = Mathf.DeltaAngle(_yaw, yaw);
                _yaw += d * (1f - Mathf.Exp(-Time.deltaTime * YawRate));
            }

            /* Bearing only, deliberately: rotating the offset by the whole
               attitude has the camera rise and dip with the car's pitch,
               which under braking and acceleration is the same surge this
               was written to remove, and tilts with roll on a bank. */
            Quaternion bearing = Quaternion.Euler(0f, _yaw, 0f);
            transform.position = Target.position + bearing * Offset;
            transform.LookAt(Target.position + Vector3.up * Aim);
        }
    }
}
