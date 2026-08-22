using System.Collections.Generic;
using UnityEngine;

namespace MumuF1.Game
{
    /// <summary>
    /// The rest of the grid, and the ghost, drawn.
    /// </summary>
    /// <remarks>
    /// Nothing here simulates anything. <see cref="Field"/> decides where a
    /// rival is and <see cref="MumuF1.Ghost"/> decides where the ghost was;
    /// this moves a transform to match. They have no colliders for the same
    /// reason — they are traffic to be judged and passed, not objects to lean
    /// on, and a rival driven along a line has no business resisting a shove.
    ///
    /// Banking is ignored on purpose. A rival that rolled with the road needs
    /// the road's normal at its own position every frame to say something
    /// nobody can see from a hundred metres, which is the same call the web
    /// version made.
    /// </remarks>
    public class RivalView : MonoBehaviour
    {
        private readonly List<Transform> _cars = new List<Transform>();
        private Transform _ghost;
        private RaceDirector _race;

        /// <summary>
        /// A ghost is a memory rather than a car, so it is drawn as one.
        /// </summary>
        /// <remarks>
        /// Pale and unsaturated, because the one thing it must never do is be
        /// mistaken for something you can hit. The web version learned that
        /// from a ghost painted in a team colour, which read as a rival and
        /// had players lifting off for it.
        /// </remarks>
        private static readonly Color GhostPaint = new Color(0.62f, 0.78f, 0.92f);

        public static RivalView Build(Transform parent, RaceDirector race)
        {
            var root = new GameObject("Rivals");
            root.transform.SetParent(parent);

            var view = root.AddComponent<RivalView>();
            view._race = race;
            view.Populate();
            return view;
        }

        private void Populate()
        {
            if (_race.Field != null)
            {
                for (int i = 0; i < _race.Field.Rivals.Count; i++)
                {
                    Rival rival = _race.Field.Rivals[i];
                    _cars.Add(MakeCar(rival.Name, Tint(rival.Colour)));
                }
            }

            if (_race.Ghost != null) _ghost = MakeCar("Ghost", GhostPaint);
        }

        private Transform MakeCar(string name, Color paint)
        {
            var car = new GameObject(name);
            car.transform.SetParent(transform);

            /* The same body the player's car gets, so a rival is recognisably
               the same machine rather than a differently-shaped one. */
            CarView.Build(car.transform);
            Repaint(car.transform, paint);

            return car.transform;
        }

        /// <summary>
        /// Recolour everything that was painted the livery red.
        /// </summary>
        /// <remarks>
        /// <see cref="CarView"/> builds one car and knows one colour, and
        /// teaching it to take a livery would mean threading a colour through
        /// the kit loader, the primitives and the wheels for the sake of nine
        /// cars. Repainting afterwards touches only the renderers that came
        /// back with a deliberate colour on them, which leaves the tyres and
        /// the halo black.
        /// </remarks>
        private static void Repaint(Transform car, Color paint)
        {
            foreach (Renderer r in car.GetComponentsInChildren<Renderer>())
            {
                if (r.sharedMaterial == null) continue;
                if (!Paint.Deliberate(r.sharedMaterial.color)) continue;

                r.sharedMaterial = Paint.Shared(paint);
            }
        }

        /// <summary>A `#rrggbb` from the core, as a colour.</summary>
        /// <remarks>
        /// Hand-parsed rather than through <c>ColorUtility.TryParseHtmlString</c>
        /// so that a malformed entry comes back as plain white rather than as
        /// an invisible black car, and so this file does not need the string
        /// to have arrived from anywhere in particular.
        /// </remarks>
        private static Color Tint(string hex)
        {
            if (string.IsNullOrEmpty(hex)) return Color.white;
            if (hex[0] == '#') hex = hex.Substring(1);
            if (hex.Length != 6) return Color.white;

            int value;
            if (!int.TryParse(hex, System.Globalization.NumberStyles.HexNumber,
                    System.Globalization.CultureInfo.InvariantCulture, out value))
            {
                return Color.white;
            }

            return new Color(
                ((value >> 16) & 0xFF) / 255f,
                ((value >> 8) & 0xFF) / 255f,
                (value & 0xFF) / 255f);
        }

        private void LateUpdate()
        {
            if (_race == null) return;

            if (_race.Field != null)
            {
                for (int i = 0; i < _cars.Count && i < _race.Field.Rivals.Count; i++)
                {
                    Rival rival = _race.Field.Rivals[i];

                    /* Half a metre up, because the racing line runs on the
                       road surface and a car sits on its wheels. */
                    _cars[i].position = new Vector3(
                        (float)rival.Position.X,
                        (float)rival.Position.Y + 0.36f,
                        (float)rival.Position.Z);

                    _cars[i].rotation = Quaternion.Euler(0f, (float)(rival.Heading * Mathf.Rad2Deg), 0f);

                    /* A car that has taken the flag stops being drawn, rather
                       than being parked on the racing line for everyone still
                       running to drive through. */
                    if (_cars[i].gameObject.activeSelf == (rival.FinishedAt != null))
                    {
                        _cars[i].gameObject.SetActive(rival.FinishedAt == null);
                    }
                }
            }

            if (_ghost == null) return;

            GhostFrame at = _race.GhostNow;

            /* Once the recorded lap has run out the ghost has taken the flag,
               and a finished ghost parked on the road is worse than no ghost —
               it reads as a stopped car. */
            if (at.Finished)
            {
                if (_ghost.gameObject.activeSelf) _ghost.gameObject.SetActive(false);
                return;
            }

            if (!_ghost.gameObject.activeSelf) _ghost.gameObject.SetActive(true);
            _ghost.position = new Vector3((float)at.X, (float)at.Y, (float)at.Z);
            _ghost.rotation = Quaternion.Euler(0f, (float)(at.Heading * Mathf.Rad2Deg), 0f);
        }
    }
}
