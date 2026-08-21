# What this project depends on, and what it does not

`com.unity.inputsystem` is deliberately absent, and it is worth writing
down why, because adding it back looks harmless and is not.

Every script here reads the keyboard through the legacy `Input` class —
`Input.GetKey`, `Input.GetKeyDown` — and nothing anywhere references
`UnityEngine.InputSystem`. So the package was dead weight. It was also,
almost certainly, why two CI runs sat for an hour each with no output:
installing it while the active input handler is still the old one makes
the editor ask whether to restart, and in batch mode it asks nobody. The
run does not fail. It waits.

If the new Input System is ever wanted, it needs
`ProjectSettings/ProjectSettings.asset` to declare `activeInputHandler`
first — which this project does not have either, because everything but
`ProjectVersion.txt` is left for Unity to generate on first import.

Everything else here is either used or is a module the engine expects:

| package | why |
| --- | --- |
| `com.mumu.f1core` | the simulation, as a local package |
| `com.unity.render-pipelines.universal` | the toon shader targets URP |
| `com.unity.ugui`, `com.unity.modules.ui*` | engine modules other packages expect |
| `com.unity.modules.physics` | the car is four raycasts and a rigidbody |
| `com.unity.modules.audio` | for when the engine note is ported |
