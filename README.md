# f1go

A Formula 1 simulator, built in Unity and played in a browser.

A rigid chassis on four raycast wheels, a Pacejka tyre model with
temperature and wear, ground-effect aerodynamics that depend on ride
height, a full drivetrain, and lap timing derived from the car's
position along the centreline spline. Race nine rivals over the Red Bull
Ring, Interlagos or Monza with F1 points carried across a season, or run
a time trial against a ghost of your own best lap.

## How it is put together

Two halves, and the split is the most important thing about this
repository.

**`unity/Packages/com.mumu.f1core`** is the simulation, and it has no
`UnityEngine` in it anywhere. Tyres, thermal, aerodynamics, suspension,
drivetrain, the centreline spline, circuit geometry, the track mesh,
trackside placement, the racing line, the speed profile, the driver
aids, the AI driver, lap timing, sessions, ghosts, the field, the
championship. A plain .NET SDK compiles and tests all of it in twenty
seconds:

```
dotnet test dotnet/MumuF1.Core.Tests
```

Neither project under `dotnet/` owns a source file. Both compile the
files the Unity package keeps, from where it keeps them, so there is one
copy of the code and no chance of the two drifting. `LangVersion` is
pinned to the C# version Unity 6 accepts and NUnit to the 3.x line Unity
ships, so a green run there means the editor will take it too.

**`unity/Assets`** is everything that does need Unity: the bootstrap,
the track and trackside builders, the car, the camera, the input, the
HUD, the title card, the toon shader. It needs the editor, and the
editor needs a licence, so it is checked by `unity.yml` rather than by
`ci.yml`.

There is no scene to speak of. `Bootstrap` builds the entire world in
`RuntimeInitializeOnLoadMethod` — the circuit is swept from a spline,
the land under it blended from the circuit's own elevation, the scenery
placed from a hash and then dropped onto whatever is beneath it, the car
lofted from a table of cross-sections — so the one scene file is
deliberately empty. A scene
would be a list of objects that code creates anyway, plus a hundred GUID
references that can silently rot, and the machine this was written on
has no editor to click in.

It runs *after* that scene loads, and the difference is not cosmetic. It
ran before, and nothing built there was ever registered with the physics
engine: a collider belongs to the scene it is created in, and at
`BeforeSceneLoad` there is no scene to belong to. The car hung motionless
at exactly its spawn height with every suspension ray coming back empty,
and both workflows stayed green throughout.

## Where the numbers came from

This was a TypeScript game first, rendered with three.js, and every
number in the C# was measured against that implementation before it was
written down. The comments on the ported files still say which
TypeScript file each one came from, because that is where they came
from; the originals lived under `f1sim/` and are in the history.

Keeping both meant a second renderer, a second input stack and a second
set of circuits, and building every feature twice. The port had
overtaken the original, so the original went.

## The build

`unity.yml` builds the player on a runner with a licence and publishes
it as an asset on a rolling `webgl` release. The host builds the site on
every push and has no Unity in it, so `tools/build-site.js` fetches that
asset and lays it out. A release asset rather than an Actions artifact
because an artifact needs a token and this repository is public; a
release asset rather than a commit because it is twelve megabytes that
would otherwise land in the git history on every Unity change.

To see the site as it will be served:

```
npm run site
```

## Controls

| Action        | Keyboard          | Touch                   |
| ------------- | ----------------- | ----------------------- |
| Throttle      | `↑` / `W`         | right thumb, drag up    |
| Brake         | `↓` / `S`         | right thumb, drag down  |
| Steer         | `←` `→` / `A` `D` | left thumb, drag across |
| Gears         | `Q` `E`           | automatic               |
| Driver aids   | `T`               | always on               |
| Straight-line | `F`               | —                       |
| Overtake mode | `Shift`           | —                       |
| Reset         | `R`               | —                       |
| Drive itself  | `P`               | —                       |
| Instrument    | `F3`              | —                       |

The aids are on to begin with, and it is not a concession. First gear
asks the road for 29,281 N and the rear tyres can take 7,708 — the engine
can out-torque the grip nearly four times over, so full throttle from a
standstill lights the rears and holds them lit, and a keyboard pedal has
no quarter-throttle to hold instead. `T` turns all of them off together:
traction control, the steering limiter, the yaw assist and the stability
moment.

`P` hands the car to a pure-pursuit driver that follows the racing line.
It is an attract mode, and it is also the only way anything here has ever
completed a lap under test — a harness can hold the throttle down but
cannot steer, because it cannot see where the car is. `F3` puts the
numbers behind the car on screen: input, revs, gear, how many wheels are
touching the road, what they are carrying, and what a probe straight down
finds. Three builds went out guessing at things that instrument answers
in one reading.

Steering is a relative drag: put your thumb down wherever is
comfortable and that becomes centre. The pedals are analogue by travel,
because on-off pedals make an eight-hundred-kilo car with a thousand
horsepower undriveable on a touchscreen.

## Assets

The models under `unity/Assets/Resources/Kit` are from Kenney's CC0
kits. Every one is optional — delete a file and that prop reverts to the
generated shape, because `Resources.Load` returns null rather than
throwing. `unity/Assets/Resources/Kit/CREDITS.md` says which pack each
came from.
