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

## `track/` is the next load-bearing piece

`track/spline.ts` already carries the important part: `project()` turns a
world position into `(s, t)` — distance along the centreline and lateral
offset from it. Once a circuit is a spline, lap counting, sector timing,
off-track detection, race position and the AI's target all reduce to
arithmetic on `(s, t)`.

Stage one runs on a flat pad. Swapping it for a real circuit touches one
line in `sim/world.ts`: replace the cuboid ground collider with a
trimesh generated by extruding the road surface along the spline.

## Stages

1. **Vehicle model on a flat pad** — where this repository is. Skid pad
   for steady-state cornering, distance boards for braking tests, live
   tuning for everything that matters.
2. **Spline tracks** — mesh generation, surface types, `(s, t)` lap and
   sector timing.
3. **AI** — precompute a speed profile from the racing line's curvature
   (`v = √(μ·g·r)`, then a forward pass for acceleration limits and a
   backward pass for braking), then pure-pursuit steering and a PID on
   target speed. Overtaking is a lateral offset from the racing line.
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
