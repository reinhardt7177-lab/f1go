# What this project depends on, and what it does not

`com.unity.inputsystem` is deliberately absent, and it is worth writing
down why, because adding it back looks harmless and is not.

Every script here reads the keyboard through the legacy `Input` class —
`Input.GetKey`, `Input.GetKeyDown` — and nothing anywhere references
`UnityEngine.InputSystem`. So the package was dead weight, and that is
the whole reason it is gone.

It was removed on a second reason as well, and that reason was wrong.
CI runs were taking a long time and were said here to be hanging on the
input handler's restart prompt. They were not: the runs were failing to
activate the Unity licence, retrying five times at four-minute
intervals, and being cancelled by the next push before they could
report it. Installing this package while the active input handler is
the old one *can* put up a modal that batch mode cannot answer, so it is
still worth knowing about — but it was not happening here.

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
