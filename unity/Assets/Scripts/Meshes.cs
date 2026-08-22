using UnityEngine;

namespace MumuF1.Game
{
    /// <summary>
    /// Turns a generated mesh into one Unity can draw.
    /// </summary>
    /// <remarks>
    /// The shapes are built in the engine-free package, as flat arrays of
    /// floats, so that they can be checked without an editor and without a
    /// player — the winding tests measure a prop's volume and a negative one
    /// means it is inside out, which is the one modelling mistake that cannot
    /// be seen by reading the code. This is the seam where those arrays
    /// become an object.
    ///
    /// It lived inside the roadside builder until the car needed it too.
    /// </remarks>
    public static class Meshes
    {
        /// <summary>One generated mesh, as a Unity mesh.</summary>
        /// <remarks>
        /// Thirty-two bit indices, always. Nothing here is near the
        /// sixteen-bit limit today, and a shape getting more detailed is all
        /// it would take to wrap the buffer into confetti.
        /// </remarks>
        public static Mesh From(Mesh3 source, string name)
        {
            var vertices = new Vector3[source.VertexCount];
            var normals = new Vector3[source.VertexCount];
            var colours = new Color[source.VertexCount];

            for (int v = 0; v < source.VertexCount; v++)
            {
                vertices[v] = new Vector3(
                    source.Positions[v * 3], source.Positions[v * 3 + 1], source.Positions[v * 3 + 2]);
                normals[v] = new Vector3(
                    source.Normals[v * 3], source.Normals[v * 3 + 1], source.Normals[v * 3 + 2]);
                colours[v] = new Color(
                    source.Colors[v * 3], source.Colors[v * 3 + 1], source.Colors[v * 3 + 2]);
            }

            var mesh = new Mesh
            {
                name = name,
                indexFormat = UnityEngine.Rendering.IndexFormat.UInt32
            };
            mesh.SetVertices(vertices);
            mesh.SetTriangles(source.Indices, 0);
            mesh.SetNormals(normals);
            mesh.SetColors(colours);
            mesh.RecalculateBounds();
            return mesh;
        }

        /// <summary>A colour, as the core's own.</summary>
        /// <remarks>
        /// Not named <c>Rgb</c>, which would read better and would be a
        /// method with the same name as the type it returns.
        /// </remarks>
        public static Rgb Tint(Color c) => new Rgb(c.r, c.g, c.b);
    }
}
