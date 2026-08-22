#if UNITY_EDITOR
using UnityEditor;
using UnityEngine;

namespace MumuF1.Editor
{
    /// <summary>
    /// The WebGL player settings, set from code because there is nowhere else
    /// to put them.
    /// </summary>
    /// <remarks>
    /// <c>unity/ProjectSettings</c> holds only <c>ProjectVersion.txt</c> —
    /// everything else is left for Unity to generate, because this project is
    /// authored on a machine with no editor and a generated settings file full
    /// of defaults is a large diff nobody can review. That is fine until a
    /// setting actually matters, and one does.
    ///
    /// Compression is turned <em>off</em>, which is the opposite of what it
    /// looks like it should be. Unity's default is Brotli, which writes
    /// <c>.wasm.br</c> and <c>.data.br</c> and needs the server to answer with
    /// <c>Content-Encoding: br</c> — get that wrong and the browser downloads
    /// the compressed bytes and hands them to the WebAssembly loader, which
    /// fails with a magic-word error that says nothing about compression. It
    /// is the single most common way a Unity WebGL build is broken on a static
    /// host.
    ///
    /// Uncompressed files need no such agreement: the host compresses them at
    /// the edge like any other asset, by content type, and the browser
    /// decompresses them the ordinary way. The build is larger on disk and the
    /// same size on the wire.
    ///
    /// <c>InitializeOnLoad</c> rather than a build callback so it is already
    /// true by the time anything reads it, including a batch-mode build that
    /// never opens a build window.
    /// </remarks>
    [InitializeOnLoad]
    public static class WebGlSettings
    {
        static WebGlSettings()
        {
            PlayerSettings.WebGL.compressionFormat = WebGLCompressionFormat.Disabled;

            /* With nothing compressed there is nothing to fall back to, and
               the fallback costs a megabyte of JavaScript decompressor. */
            PlayerSettings.WebGL.decompressionFallback = false;

            /* The template's page is replaced by the site build, but the
               loader still reads these. A canvas that resizes to its container
               is what lets the same build fill a phone held sideways and a
               desktop window. */
            PlayerSettings.runInBackground = true;

            /* Exceptions cost performance and this build has no error
               reporting to send them to; a stack trace nobody reads is not
               worth a third of the frame budget. */
            PlayerSettings.SetStackTraceLogType(LogType.Log, StackTraceLogType.None);
            PlayerSettings.SetStackTraceLogType(LogType.Warning, StackTraceLogType.None);
        }
    }
}
#endif
