# Architecture

## The one rule

**`sim/` and `core/` never import from `render/`, `ui/` or `input/`.**

Everything else here is a consequence of that rule. Because the
simulation has no rendering dependency, the same code that runs in the
browser runs headlessly in node — which is how `tests/vehicle.test.ts`
can accelerate a car, brake it, and assert on the load through each
contact patch without a canvas existing. Later it is also what lets the
same model run on a server for multiplayer authority, inside a training
loop for the AI, and against a recorded input file for replays.

The dependency direction is one-way:

```
input/ ──┐
         ├──> main.ts ──> sim/ ──> core/
ui/    ──┤                 ▲
render/ ─┘                 │
                        track/
```

`main.ts` is the only file allowed to know about all of them.

## Fixed timestep

The simulation advances in constant 1/120 s slices; rendering happens
per animation frame and interpolates between the last two states
(`core/loop.ts`). A 144 Hz monitor therefore drives exactly the same car
as a 60 Hz one, and an input sequence always replays identically.

Determinism is a decision that has to be made on day one — retrofitting
it is painful — so there is a test for it (`determinism > produces
bit-identical state from identical inputs`) from the start. Once it
holds, replays, ghost laps and rollback netcode all become available
without further architectural work.

## How a tick flows

```
InputManager          hardware -> ControlState
      │
assists.ts            ControlState -> ControlState   (optional aids)
      │
Vehicle.step()        ┌─ aerodynamics: downforce at each axle, drag at the CG
                      ├─ raycast each wheel -> suspension compression
                      ├─ anti-roll bars couple left and right
                      ├─ drivetrain: engine -> gearbox -> differential
                      ├─ per wheel: slip -> tyre forces -> apply at contact
                      └─ integrate wheel spin (sub-stepped, semi-implicit)
      │
RAPIER.World.step()   one rigid-body solve
      │
Vehicle.getState()    VehicleState snapshot
      │
SceneRenderer         interpolate and draw
```

Nothing except aerodynamics applies force to the chassis directly.
Everything else reaches it through a contact patch, which is what makes
the handling emerge rather than being scripted.

## Why the vehicle model is shaped this way

Four decisions carry most of the behaviour, and each has a test.

**Load sensitivity** (`tire.ts`). A tyre's friction coefficient falls as
vertical load rises, so doubling the load gives less than double the
grip. Without it, weight transfer would be free and anti-roll bars would
do nothing — the entire balance-tuning vocabulary of the sport stops
working.

**One grip budget** (`tire.ts`). Longitudinal and lateral force share a
friction circle. The combined-slip blend weights are *squared* direction
cosines specifically because those sum to one; using the cosines
themselves lets the resultant reach √2 times the available grip, and the
car gains traction out of nowhere when braking into a corner.

**Aerodynamics applied at the axles** (`vehicle.ts`). Downforce is split
front/rear by `aero.frontBalance` and applied at each axle rather than
at the centre of mass, so aero balance produces a real pitching moment.
This is what makes an F1 car an F1 car: at 300 km/h the tyres carry
roughly 27 kN — three and a half times the car's own weight — so grip
grows with speed and fast corners become flat.

**Semi-implicit, sub-stepped wheel spin** (`vehicle.ts`). A wheel
carries about 1.8 kg·m² against several thousand newton-metres of drive
torque. Integrated explicitly at the outer timestep, its slip ratio
jumps clean past the grip peak in a single step; past the peak the tyre
gives up force as slip grows, so the error compounds and the wheel runs
away into permanent wheelspin. That is a numerical artefact, not
physics. The wheel therefore runs on its own finer clock, and each
sub-step evaluates the tyre's resistance at the end of the step, which
damps the wheel exactly as hard as the force curve is steep.

## Spring rates are set by downforce, not weight

At 300 km/h each corner carries about 6.6 kN. Rates sized for the car's
7.8 kN static weight bottom the suspension out on every straight, and
once it bottoms, the chassis sinks until its collider punches through
the road. Hence 160–180 kN/m and a near-rigid bump stop.

For the same reason the chassis collider must clear the road across the
whole of suspension travel. If its underside can touch, the car rests on
the box instead of the springs and downforce never reaches the tyres at
all — the tell-tale is total tyre load sitting at exactly the static
weight no matter how fast you go.

## Driver aids sit outside the sim

`sim/assists.ts` reads telemetry and shapes controls; it never touches
physics. It exists because first gear delivers roughly 26 kN of thrust
to rear tyres that can carry about 7.5 kN at rest, so full throttle from
a standstill is a burnout — and spinning tyres have almost no lateral
grip left, so the car turns around. That behaviour is correct, and it is
why a real driver feeds the throttle in. The traction control is a stand-in
for a right foot, used by the player, the tests, and later the AI.

## `(s, t)` is what the circuit is for

`track/spline.ts` carries the important part: `project()` turns a world
position into `(s, t)` — distance along the centreline and lateral
offset from it. Everything the race layer needs is arithmetic on that
pair. Crossing the timing line is a wrap in `s`. A sector split is `s`
passing a threshold. Running wide is `|t|` exceeding the road
half-width. The surface under a wheel is a lookup on `|t|` against the
lateral profile. There is not a single trigger volume anywhere on the
circuit.

A circuit is described the way a track map describes it — a list of
straights and constant-radius corners with lengths, gradients and
banking — and integrated into a centreline. That format is readable,
editable by someone holding a track map, and states corner radii
directly instead of implying them from point spacing.

Three things about that integration are not obvious, and each cost a
debugging session:

**The lap must close in heading, not just in position.** Radii read off
a map sum to whatever they sum to; Spa's first draft turned 5.18 radians
where a closed lap needs 2π. Closing only the position leaves a kink in
the tangent at the seam, so a car driving straight across the timing
line finds the road at twenty degrees to it and is off the circuit
within two hundred metres. `buildCircuit` normalises the total turn.

**A swept ribbon can fold through itself.** Its width has to stay under
the local radius of curvature, or the inside edge wraps past the centre
of the corner and comes back out over the racing line.

**A swept ribbon also has no idea the rest of the circuit exists.** If
the plan view crosses itself where the two parts are at similar height,
two sheets of road interpenetrate, and a car meeting that seam at
250 km/h is launched off the map. Spa's first layout did this in three
places. Pouhon's and Stavelot's radii are wider than a track map
suggests because that is what opens the shape out; a test holds it open.

`track/mesh.ts` emits plain typed arrays, which become both the physics
trimesh and the render geometry. What you drive on and what you see
cannot drift apart, because they are the same numbers.

## What tyres carry beyond grip

Temperature and wear are tracked per corner, and both feed the same
`gripScale` that the surface lookup does. Two temperatures: the tread
responds within a corner and sets grip right now, the carcass responds
over a lap and is what the tread relaxes towards. Heat in and rubber off
come from the same quantity — the power dissipated by the contact patch
sliding, force times sliding speed.

The coefficients are sized from the equilibrium they have to hold, not
picked by feel: a tyre worked hard dissipates on the order of 8 kW and
should settle near 100 °C in a 60 m/s airstream, which fixes the cooling
conductance near 110 W/K. A first pass sized them by intuition and
cooling swamped the heat input, so the tyres never came in at all.

Tyres start out of the blankets, below the window. The first lap is a
real out-lap.

## Stages

1. **Vehicle model on a flat pad** — done. Skid pad for steady-state
   cornering, distance boards for braking, live tuning throughout.
2. **Circuits** — done. Spa integrated from corner radii, mesh
   generation, per-surface friction, `(s, t)` lap and sector timing,
   ground-effect aero, tyre temperature and wear.
3. **AI** — next, and the missing piece that stage two exposed. A car
   cannot get round Spa unaided yet: the stand-in driver in
   `circuit.test.ts` is a pursuit controller with a `v = √(a/k)` speed
   target, which is enough for the proving ground's 150 m bends and
   nowhere near enough for La Source or Eau Rouge. What is needed is a
   racing line spline separate from the centreline, and a proper speed
   profile over it — the limit speed from curvature and grip, then a
   forward pass for acceleration limits and a backward pass for braking.
   Steering is then pure pursuit and throttle a PID on the profile.
4. **Sessions** — practice, qualifying, race; penalties, pit lane.
5. **Replays, ghosts, multiplayer** — all of which the determinism
   guarantee has already paid for.

## Conventions

Right-handed, +Y up, **−Z forward**, +X right — the glTF and three.js
convention, so imported assets need no axis fixing. Wheel order is
always `[FL, FR, RL, RR]`, exported as constants from `sim/types.ts`.

SI units everywhere inside the sim: metres, kilograms, seconds, newtons,
radians. Conversion to km/h or degrees happens in the UI and nowhere
else.
