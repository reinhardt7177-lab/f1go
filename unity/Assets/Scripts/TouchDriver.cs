using UnityEngine;

namespace MumuF1.Game
{
    /// <summary>
    /// Touch controls, ported from <c>f1sim/src/input/touch.ts</c>.
    /// </summary>
    /// <remarks>
    /// Produces the same three analogue values a wheel and pedals would, so
    /// nothing downstream knows the difference — which is the same boundary
    /// the keyboard and the AI driver already sit behind.
    ///
    /// Two decisions carried across, both of which were arrived at on a real
    /// phone rather than at a desk.
    ///
    /// Steering is a <em>relative</em> drag rather than an absolute pad: you
    /// put your thumb down wherever is comfortable and that becomes centre. A
    /// phone is held differently every time, and a fixed centre means fighting
    /// the controls before you have turned anything.
    ///
    /// And the pedals are analogue by travel — how far up the pad your thumb
    /// is sets how much throttle. On-off pedals make an eight-hundred-kilo car
    /// with a thousand horsepower undriveable on a touchscreen; there is no
    /// way to feed the throttle in, and feeding it in is the entire skill.
    ///
    /// Two of the web version's hard-won details do not need porting, and it
    /// is worth saying which and why. <c>pointerleave</c> is not a release
    /// there, because a steering thumb reaches the bottom edge of the screen
    /// in any long corner and the car would straighten mid-apex; Unity's touch
    /// phases have no equivalent event, so the bug cannot occur. And the web
    /// version reserves the footprints of its on-screen buttons so a thumb
    /// reaching for full throttle does not select the pit lane — this build's
    /// HUD is drawn rather than built from elements and takes no input at all,
    /// so there is nothing to reserve.
    /// </remarks>
    [RequireComponent(typeof(CarController))]
    public class TouchDriver : MonoBehaviour
    {
        /// <summary>Fraction of the width given to steering; the rest is pedals.</summary>
        public float Split = 0.5f;

        /// <summary>
        /// Dead margin at the left and right edges, in pixels.
        /// </summary>
        /// <remarks>
        /// A phone's left thumb naturally rests within a few millimetres of
        /// the bezel, and both iOS and Android read a drag starting there as a
        /// system back-gesture. Twenty-two pixels clears iOS's sixteen and
        /// Android's twenty without being noticeable in a zone four hundred
        /// wide.
        /// </remarks>
        public float EdgeMargin = 22f;

        /// <summary>
        /// Drag for full lock, as a fraction of the shorter screen edge.
        /// </summary>
        /// <remarks>
        /// A fifth. 0.16 was too short to aim inside; 0.26 was so long that,
        /// stacked on the chassis' own speed falloff, the car stopped
        /// responding at all.
        /// </remarks>
        public float SteerTravel = 0.2f;

        /// <summary>Dead zone around the origin, in the same units.</summary>
        public float SteerDeadzone = 0.014f;

        /// <summary>Seconds for steering to spring back when the thumb lifts.</summary>
        public float ReturnTime = 0.14f;

        /// <summary>Throttle held by a thumb that is down but has not moved.</summary>
        public float RestingThrottle = 0.45f;

        /// <summary>True once any touch has been seen, so the pads can appear.</summary>
        public bool Active { get; private set; }

        private enum Role { None, Steer, Pedals }

        private struct Finger
        {
            public int Id;
            public Vector2 Origin;
            public Vector2 At;
            public Role Role;

            /// <summary>Set once it has travelled past the dead zone.</summary>
            public bool Moved;

            /// <summary>Order of arrival, so the earliest holder of a role keeps it.</summary>
            public int Seq;
        }

        /* Four is more fingers than anyone drives with, and a fixed array
           means no allocation a frame on a device that is already asking a
           lot of its garbage collector. */
        private readonly Finger[] _fingers = new Finger[4];
        private int _count;

        /* Last frame's set, to carry origins and roles across. Searching the
           live array while rebuilding it in place would match a finger
           against an entry already overwritten this frame — and the symptom
           of that is a thumb silently inheriting the other thumb's origin,
           which reads as the steering jumping to full lock. */
        private readonly Finger[] _previous = new Finger[4];
        private int _previousCount;

        private int _arrivals;

        private CarController _car;

        /// <summary>
        /// The session, for the boost it hands out.
        /// </summary>
        /// <remarks>
        /// Fetched every frame until it appears rather than once in
        /// <c>Awake</c>: the bootstrap adds the director after the drivers,
        /// so it is not there yet when this wakes up. Null is survivable and
        /// simply means no boost, which is the right answer during the moment
        /// before a session exists.
        /// </remarks>
        private RaceDirector _race;
        private float _steer;
        private bool _shiftArmed = true;
        private Texture2D _ring;

        private void Awake() => _car = GetComponent<CarController>();

        private float ShortEdge => Mathf.Max(1f, Mathf.Min(Screen.width, Screen.height));

        private void Update()
        {
            Collect();

            if (!Active) return;

            float dt = Time.deltaTime;
            float travel = SteerTravel * ShortEdge;
            float dead = SteerDeadzone * ShortEdge;

            int steering = Holder(Role.Steer);
            int pedals = Holder(Role.Pedals);

            if (steering >= 0)
            {
                float dx = _fingers[steering].At.x - _fingers[steering].Origin.x;
                float magnitude = Mathf.Max(0f, Mathf.Abs(dx) - dead);
                _steer = Mathf.Clamp(Mathf.Sign(dx) * magnitude / travel, -1f, 1f);
            }
            else
            {
                /* Spring back to centre rather than snapping, so lifting a
                   thumb mid-corner does not throw the car. */
                _steer = Mathf.MoveTowards(_steer, 0f, dt / Mathf.Max(1e-4f, ReturnTime));
                if (Mathf.Abs(_steer) < 0.01f) _steer = 0f;
            }

            float throttle = 0f;
            float brake = 0f;

            if (pedals >= 0)
            {
                /* Up from the landing point is throttle, down is brake, and
                   how far sets how much. Unity's screen origin is the bottom
                   left, so up is a *positive* dy — the opposite sign to the
                   web version, where it is measured against a CSS viewport. */
                float dy = _fingers[pedals].At.y - _fingers[pedals].Origin.y;
                float magnitude = Mathf.Max(0f, Mathf.Abs(dy) - dead) / travel;

                if (dy >= 0f) throttle = Mathf.Clamp01(magnitude);
                else brake = Mathf.Clamp01(magnitude);

                /* A thumb resting on the pad without ever having moved still
                   means "go" — that is how a player who has read nothing
                   discovers the car drives. But once the thumb *has* moved it
                   is driving, and a two-millimetre pull towards the bottom of
                   the screen is a request for a light brake, not for half
                   throttle. Conflating the two is what made the car impossible
                   to trail-brake. */
                if (!_fingers[pedals].Moved && throttle == 0f && brake == 0f)
                {
                    throttle = RestingThrottle;
                }
            }

            /* Shift on road speed, as the keyboard does. The same reasoning:
               during wheelspin the engine sits on the limiter while the car is
               barely moving, and an rpm-triggered shift would run through the
               whole gearbox in half a second.

               Both ways, now. This upshifted and nothing else, so a gearbox
               that was automatic going up the straight was a manual with no
               lever coming out of the corner: brake from top gear for a
               hairpin and the car pulls away from it in eighth, at nine
               hundred rpm, with no way to ask for anything better. On a phone
               there is no lever to reach for — that is the entire premise of
               the layout — so a gearbox that only goes one way is not an
               automatic, it is half of one.

               The band below the upshift point is deliberately not the
               upshift point itself. Downshifting the moment you drop under
               the speed you shifted up at leaves the box hunting between two
               gears for the whole of a long corner; fifteen per cent of
               margin is enough that it picks one and stays there. */
            if (_race == null) _race = GetComponent<RaceDirector>();

            double kmh = System.Math.Abs(_car.SpeedMs) * MathUtil.Kmh;
            bool wantUp = kmh > _car.Gear * 42;
            bool wantDown = _car.Gear > 1 && kmh < (_car.Gear - 1) * 42 * 0.85;

            _car.Controls = new Controls
            {
                Throttle = throttle,
                Brake = brake,
                Steer = _steer,
                ShiftUp = wantUp && _shiftArmed,
                ShiftDown = wantDown && _shiftArmed,
                StraightMode = false,

                /* No button, and there is not going to be one. The layout is
                   a thumb each side and the moment a third thing needs
                   pressing none of it works, so the boost is something the
                   driving earns and the throttle spends. See MumuF1.Booster. */
                Overtake = _race != null && _race.Booster.Deploying
            };

            _shiftArmed = !(wantUp || wantDown);
        }

        /// <summary>Take this frame's touches, claiming and releasing roles.</summary>
        private void Collect()
        {
            int touches = Input.touchCount;
            if (touches > 0) Active = true;

            System.Array.Copy(_fingers, _previous, _fingers.Length);
            _previousCount = _count;

            /* Rebuilt from scratch each frame rather than tracked by phase.
               Unity hands the full set of live touches every frame, so a
               touch that ended is simply absent — which removes the whole
               class of bug where a release event is missed and a finger is
               held down forever. What has to be carried across is the origin
               and the role, which is what the search below is for. */
            int kept = 0;
            for (int t = 0; t < touches && kept < _fingers.Length; t++)
            {
                Touch touch = Input.GetTouch(t);
                if (touch.phase == TouchPhase.Ended || touch.phase == TouchPhase.Canceled) continue;

                int known = Find(touch.fingerId);
                Finger finger;

                if (known >= 0)
                {
                    finger = _previous[known];
                    finger.At = touch.position;

                    if (!finger.Moved)
                    {
                        float dead = SteerDeadzone * ShortEdge;
                        if (Vector2.Distance(finger.At, finger.Origin) > dead) finger.Moved = true;
                    }
                }
                else
                {
                    Role role = RoleAt(touch.position);
                    if (role == Role.None) continue;

                    finger = new Finger
                    {
                        Id = touch.fingerId,
                        Origin = touch.position,
                        At = touch.position,
                        Role = role,
                        Moved = false,
                        Seq = _arrivals++
                    };
                }

                _fingers[kept++] = finger;
            }

            _count = kept;
        }

        /// <summary>Where this finger was last frame, or −1 if it is new.</summary>
        private int Find(int id)
        {
            for (int i = 0; i < _previousCount; i++)
            {
                if (_previous[i].Id == id) return i;
            }

            return -1;
        }

        /// <summary>
        /// Which control a touch at this point claims, or none.
        /// </summary>
        /// <remarks>
        /// Geometry and nothing else, which is what makes it checkable at a
        /// hundred points across a phone-sized rectangle rather than by
        /// holding one.
        /// </remarks>
        private Role RoleAt(Vector2 at)
        {
            if (Screen.width <= 0 || Screen.height <= 0) return Role.None;

            // The system gesture strips, on both sides.
            if (at.x < EdgeMargin || at.x > Screen.width - EdgeMargin) return Role.None;

            return at.x < Screen.width * Split ? Role.Steer : Role.Pedals;
        }

        /// <summary>
        /// The finger holding a role, or −1. Earliest arrival wins.
        /// </summary>
        /// <remarks>
        /// Not simply the first match found. Roles used to be resolved by
        /// iterating whatever order the touches arrived in, so a second finger
        /// landing in the same half silently took over — and a palm resting on
        /// the glass took over from the thumb. The finger that claimed a role
        /// keeps it until it lifts.
        /// </remarks>
        private int Holder(Role role)
        {
            int best = -1;
            for (int i = 0; i < _count; i++)
            {
                if (_fingers[i].Role != role) continue;
                if (best < 0 || _fingers[i].Seq < _fingers[best].Seq) best = i;
            }

            return best;
        }

        // ---- Drawing the pads -------------------------------------------
        //
        // A control you cannot see is a control nobody finds. The web version
        // draws these for the same reason, and they appear only once a touch
        // has been seen so a desktop player never sees them at all.

        private void OnGUI()
        {
            if (!Active) return;

            EnsureRing();

            float travel = SteerTravel * ShortEdge;
            DrawPad(Holder(Role.Steer), travel, true);
            DrawPad(Holder(Role.Pedals), travel, false);
        }

        private void DrawPad(int finger, float travel, bool horizontal)
        {
            if (finger < 0) return;

            /* Unity's GUI has the origin at the top left and touches at the
               bottom left, so every y is flipped on the way to the screen. */
            Vector2 origin = _fingers[finger].Origin;
            Vector2 at = _fingers[finger].At;
            float oy = Screen.height - origin.y;
            float ay = Screen.height - at.y;

            Color was = GUI.color;

            // Where the thumb landed: the centre it is being measured from.
            GUI.color = new Color(0.93f, 0.95f, 0.97f, 0.16f);
            GUI.DrawTexture(new Rect(origin.x - travel, oy - travel, travel * 2f, travel * 2f), _ring);

            // And where it is now, on the axis that control reads.
            float x = horizontal ? at.x : origin.x;
            float y = horizontal ? oy : ay;
            float knob = travel * 0.28f;

            GUI.color = new Color(0.93f, 0.95f, 0.97f, 0.5f);
            GUI.DrawTexture(new Rect(x - knob, y - knob, knob * 2f, knob * 2f), _ring);

            GUI.color = was;
        }

        /// <summary>
        /// A soft disc, generated once.
        /// </summary>
        /// <remarks>
        /// Drawn into a texture rather than shipped as one, because a sprite
        /// is a file that has to be imported, given a GUID and referenced —
        /// and this project is authored as text with no editor to do any of
        /// that in. Sixty-four pixels is plenty for something drawn at a
        /// fifth of the screen and blurred by the alpha ramp anyway.
        /// </remarks>
        private void EnsureRing()
        {
            if (_ring != null) return;

            const int size = 64;
            _ring = new Texture2D(size, size, TextureFormat.RGBA32, false)
            {
                hideFlags = HideFlags.HideAndDontSave,
                wrapMode = TextureWrapMode.Clamp
            };

            var pixels = new Color32[size * size];
            float centre = (size - 1) * 0.5f;

            for (int y = 0; y < size; y++)
            {
                for (int x = 0; x < size; x++)
                {
                    float d = Mathf.Sqrt((x - centre) * (x - centre) + (y - centre) * (y - centre));
                    /* One pixel of ramp at the rim, so the edge is smooth
                       without a mip chain or an import setting. */
                    float a = Mathf.Clamp01(centre - d);
                    pixels[y * size + x] = new Color32(255, 255, 255, (byte)(a * 255));
                }
            }

            _ring.SetPixels32(pixels);
            _ring.Apply();
        }
    }
}
