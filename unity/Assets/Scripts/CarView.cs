using UnityEngine;

namespace MumuF1.Game
{
    /// <summary>
    /// Something to look at while the physics is what matters.
    /// </summary>
    /// <remarks>
    /// Primitives, deliberately. A modelled car is an asset to import,
    /// and an asset is the one kind of change that cannot be written as
    /// text — which is what this whole project is being authored as. It
    /// is also the right order of work: the shape of the car changes
    /// nothing about how it drives, so it can be the last thing done
    /// properly rather than the first.
    /// </remarks>
    public static class CarView
    {
        public static void Build(Transform car)
        {
            Colour(Box(car, "Body", new Vector3(0f, 0.05f, 0f), new Vector3(1.0f, 0.32f, 4.4f)),
                new Color(0.85f, 0.09f, 0.11f));
            Colour(Box(car, "Nose", new Vector3(0f, 0.02f, 2.5f), new Vector3(0.45f, 0.2f, 1.2f)),
                new Color(0.85f, 0.09f, 0.11f));
            Colour(Box(car, "RearWing", new Vector3(0f, 0.72f, -2.2f), new Vector3(1.7f, 0.32f, 0.3f)),
                new Color(0.85f, 0.09f, 0.11f));
            Colour(Box(car, "FrontWing", new Vector3(0f, -0.05f, 3.0f), new Vector3(1.8f, 0.1f, 0.5f)),
                new Color(0.85f, 0.09f, 0.11f));
            Colour(Box(car, "Halo", new Vector3(0f, 0.42f, 0.6f), new Vector3(0.7f, 0.08f, 0.8f)),
                new Color(0.1f, 0.1f, 0.12f));

            float front = 1.98f, rear = -1.62f;
            Wheel(car, "FL", new Vector3(-0.8f, -0.16f, front));
            Wheel(car, "FR", new Vector3(0.8f, -0.16f, front));
            Wheel(car, "RL", new Vector3(-0.78f, -0.16f, rear));
            Wheel(car, "RR", new Vector3(0.78f, -0.16f, rear));
        }

        private static void Wheel(Transform car, string name, Vector3 at)
        {
            GameObject go = GameObject.CreatePrimitive(PrimitiveType.Cylinder);
            go.name = name;
            Object.Destroy(go.GetComponent<Collider>());
            go.transform.SetParent(car, false);
            go.transform.localPosition = at;
            go.transform.localRotation = Quaternion.Euler(0f, 0f, 90f);
            go.transform.localScale = new Vector3(0.72f, 0.18f, 0.72f);
            Colour(go, new Color(0.09f, 0.09f, 0.1f));
        }

        private static GameObject Box(Transform car, string name, Vector3 at, Vector3 size)
        {
            GameObject go = GameObject.CreatePrimitive(PrimitiveType.Cube);
            go.name = name;
            Object.Destroy(go.GetComponent<Collider>());
            go.transform.SetParent(car, false);
            go.transform.localPosition = at;
            go.transform.localScale = size;
            return go;
        }

        private static void Colour(GameObject go, Color colour)
        {
            go.GetComponent<MeshRenderer>().sharedMaterial = Paint.Flat(colour);
        }
    }
}
