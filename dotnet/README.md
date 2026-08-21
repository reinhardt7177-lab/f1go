# The simulation, without Unity

Neither project here owns any source. Both compile the files that live
in `unity/Packages/com.mumu.f1core/`, from where the Unity package keeps
them, so there is exactly one copy of the code.

The point is verification. The simulation half of this game — tyres,
aerodynamics, suspension, drivetrain, circuit geometry, the racing line,
timing, ghosts — has no `UnityEngine` in it and does not need any, so it
can be compiled and tested by a plain SDK on a CI runner with no editor
and no licence:

    dotnet test dotnet/MumuF1.Core.Tests

`LangVersion` is pinned to the C# version Unity 6 accepts, and NUnit to
the 3.x line Unity ships, so a green run here means the editor will take
it too.

What is *not* covered: anything that touches `UnityEngine` — the
MonoBehaviour glue, the scene, shaders, prefabs, input. That half needs
the editor, and needs a licence to build in CI.
