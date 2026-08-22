using UnityEngine;

namespace MumuF1.Game
{
    /// <summary>
    /// Makes the wheels turn, steer and move with the suspension.
    /// </summary>
    /// <remarks>
    /// No rigging, no joints, no skinning, and that is not a shortcut. A
    /// wheel is a rigid body rotating about a fixed axle: four separate
    /// transforms say everything a skeleton could, cost nothing per frame,
    /// and need no bones bound to a mesh — which would also mean an asset
    /// that has to be imported and referenced, and there is no editor here
    /// to do that in.
    ///
    /// The rotation is read rather than integrated. <c>CarController</c>
    /// accumulates spin on the physics step, so a wheel turns at the rate the
    /// tyre model says it does whatever the frame rate is; a view integrating
    /// its own would show a wheel turning at half speed at 30 fps, which is
    /// exactly the frame rate a phone settles at.
    ///
    /// The order matters. Steer is a yaw about the hub and spin is a pitch
    /// about the axle, and applying them the other way round steers the axle
    /// instead of the wheel — the front pair would lean over rather than
    /// point.
    /// </remarks>
    [RequireComponent(typeof(CarController))]
    public class WheelView : MonoBehaviour
    {
        private static readonly string[] Names = { "FL", "FR", "RL", "RR" };

        private CarController _car;
        private readonly Transform[] _wheels = new Transform[4];
        private readonly Vector3[] _rest = new Vector3[4];

        /// <summary>
        /// The model is built lying on its side, so the axle is its local up.
        /// </summary>
        /// <remarks>
        /// <c>CarView</c> rotates each wheel 90° about Z to stand a cylinder
        /// on its rim. That rotation is part of the wheel's own pose, so it
        /// has to be the thing everything else is applied on top of rather
        /// than something replaced.
        /// </remarks>
        private static readonly Quaternion Standing = Quaternion.Euler(0f, 0f, 90f);

        private void Awake()
        {
            _car = GetComponent<CarController>();

            for (int i = 0; i < 4; i++)
            {
                Transform t = transform.Find(Names[i]);
                _wheels[i] = t;
                if (t != null) _rest[i] = t.localPosition;
            }
        }

        private void LateUpdate()
        {
            if (_car == null) return;

            for (int i = 0; i < 4; i++)
            {
                Transform t = _wheels[i];
                if (t == null) continue;

                CarController.WheelPose pose = _car.Pose(i);

                /* Steer first, then spin, both about the hub. Degrees rather
                   than radians because that is what Unity's Euler wants, and
                   the wheel's own standing rotation is applied last so the
                   cylinder is still on its rim afterwards. */
                float steer = (float)(pose.Steer * Mathf.Rad2Deg);
                float spin = (float)(pose.Spin * Mathf.Rad2Deg);

                t.localRotation =
                    Quaternion.Euler(0f, steer, 0f) *
                    Quaternion.Euler(spin, 0f, 0f) *
                    Standing;

                /* And up and down with the spring. The hardpoint is fixed to
                   the body and the wheel hangs below it by whatever the
                   suspension is not compressing, so a car that squats under
                   braking has its wheels stay on the road rather than sinking
                   into it with the body. */
                Vector3 at = _rest[i];
                at.y = _rest[i].y + (float)pose.Compression;
                t.localPosition = at;
            }
        }
    }
}
