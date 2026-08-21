# f1go

A Formula 1 simulator that runs in the browser: a rigid chassis on four
raycast wheels, a Pacejka tyre model with temperature and wear,
ground-effect aerodynamics that depend on ride height, a full
drivetrain, and lap timing derived from the car's position along the
centreline spline.

Race nine rivals over the Red Bull Ring, Interlagos or Monza, with F1 points
carried across a season — or run a time trial against a ghost of your own
best lap.

```
cd f1sim
npm install
npm run dev
```

Then open <http://localhost:5173>.

## Controls

| Action        | Keyboard              | Touch                        |
| ------------- | --------------------- | ---------------------------- |
| Throttle      | `↑` / `W`             | right thumb, drag up         |
| Brake         | `↓` / `S`             | right thumb, drag down       |
| Steer         | `←` `→` / `A` `D`     | left thumb, drag across      |
| Gears         | `Q` `E`               | automatic                    |
| Straight-line | `F`                   | AERO                         |
| Overtake mode | `Shift`               | BOOST                        |
| Camera        | `C`                   | on-screen                    |
| Pit           | `P`                   | PIT                          |
| Recover       | `R`                   | RESET                        |

`RESET` puts the car back on the racing line where it stands. A rigid
body can finish up on its roof or a long way off the map, and the
simulation is not wrong about either — but a session should not end
there.

## Time trial, and the ghost

`?session=timetrial`, or the mode picker on the title card. No field, no
contact, no end: you, the clock, and a ghost of your own best lap round
this circuit.

The ghost is a *path*, not a replay. A replay would store the inputs and
re-run the simulation, which is what determinism buys and what
`tests/vehicle.test.ts` guards — but a ghost is drawn and never
simulated, so storing the answer is strictly better than storing the
question. It costs no second physics world, and a lap recorded today
still plays back after a change that would invalidate an input replay.

A sample is five floats — x, y, z, heading, and distance along the
centreline — taken at 20 Hz. That last one is what earns the feature its
readout: position says where to draw the ghost, distance says *when the
ghost was here*, and only the second can answer the question a time trial
is about. The delta under the lap clock is your lap time minus the time
the ghost took to reach the same point, so it compares two laps at a
place rather than at an instant.

20 Hz is chosen rather than inherited. At 85 m/s that is a sample every
4.25 m, and through a 100 m radius corner the straight line between two
samples departs from the arc by about 2.3 cm. A 90-second lap is 28 KB
in `localStorage`, per circuit.

The ghost is a `Rival` and nothing more, which is why it needed no new
drawing code: made to fit that shape it inherits the car model, the name
label and the minimap. It never joins `world.traffic` — a ghost is a
record of a lap, and driving through it is correct. It hides itself when
it is within four and a half metres of the *camera*, which in the cockpit
means whenever you are level with it and from the chase camera means
almost never; running level with your own best lap is the point of the
mode, and from the driver's seat a car half a metre away is not a rival
but a wall across the windscreen.

## On a phone

Both touch controls are *relative*: wherever your thumb goes down
becomes the centre, because a phone is held differently every time and a
fixed centre means fighting the controls. Both are analogue by travel —
how far up the pad your thumb is sets how much throttle — because an
on-off pedal makes a 1000 bhp car undriveable on glass. Both draw
themselves under your thumb, so full lock is a distance you can see
rather than a number you have to have learnt.

The pedals stop at the on-screen buttons, whose footprint is measured
from the elements themselves rather than written down twice, so moving
a button in the stylesheet moves its dead zone with it
(`src/input/zones.ts`).

Landscape, and the game asks for it. Android is put into fullscreen and
locked to landscape on START. **iOS Safari has no Fullscreen API at
all**, so there the honest instruction is the other one — *공유 → 홈
화면에 추가* — and the title card says so instead of drawing a
fullscreen button that cannot work. A home-screen app runs chrome-free
in the orientation `public/manifest.webmanifest` asks for, which is
everything the fullscreen button was for.

`src/render/quality.ts` decides what the device can afford before
anything is built — the forest, the shadow map, the multisample buffer —
and errs downward on touch, because a phone that guesses high runs at
twelve frames a second and a scaler cannot un-place a forest. Resolution
is the exception: it is the one dial that can move mid-race, so a closed
loop moves it from measured frame times. `?quality=low|medium|high`
pins the tier, which is how a bug report is made.

## What is simulated

The car is a rigid body with four raycast wheels. Each wheel carries a
suspension spring and damper, and a tyre with its own slip angle, slip
ratio, load sensitivity, tread temperature and wear. Longitudinal and
lateral forces come from a Pacejka fit combined through a friction
ellipse, so a locked wheel really does stop steering.

Aerodynamics are ride-height dependent: the floor makes most of the
downforce, gains it as the car settles, and stalls if it settles too
far. Drag scales with the same wing settings that produce the
downforce, which is what makes the Monza and Monaco trims genuinely
different cars rather than a slider.

Almost nothing here is left to the contact solver. The wheels are
raycasts, the wall is a force, the other cars are pairs of circles —
the only rigid contact in the whole simulation is one box around the
chassis, and it is a backstop for a car that has ended up on its roof
rather than a part of the car. It has to keep clear of the road
through the whole of suspension travel and through the roll a corner
actually asks for, because a 798 kg box overlapping a static triangle
mesh gets pushed out at whatever speed that takes, and that speed is
not a number this simulation chose. It used to touch, and running wide
at a corner threw the car sixteen metres into the air;
`tests/vehicle.test.ts` now holds both halves of that shut — the
clearance as arithmetic, and a sweep of the corner it happened on.

## Sound

Nothing here is a recording. Six sound files would be six downloads and
a lot of megabytes, and a sample pitched up and down does not answer to
a throttle — so the car is synthesised from the same state the renderer
draws. The note is the firing rate of a V6: a four-stroke fires each
cylinder once every two revolutions, so `rpm / 60 * 3`, which over this
engine's 4,000 to 15,000 rpm is 200 Hz to 750 Hz. Lifting off is
audible because the harmonic series flattens with load rather than
because the volume drops. Tyre scrub uses the same thresholds the smoke
does, so a tyre that is heard sliding is the tyre that is seen sliding,
and the kerbs are read from the grip under each wheel rather than from
a surface name.

`tests/` holds 316 tests over the tyre model, the thermal model, the
2026 power unit rules, the circuit geometry, the racing line and the
field.

## Circuits

The Red Bull Ring, Interlagos and Monza, plus a flat proving ground used by the
vehicle-dynamics tests, where a measurement of braking distance means
something because the surface is uniform.

A circuit is a list of sections with a real length, radius, gradient,
banking and half-width. `tests/circuit.test.ts` requires the lap to
close in both position and heading, because a layout that does not
close has a kink in its tangent at the timing line, and a car crossing
that at speed leaves the circuit.

Two tools help author one:

```
npx tsx tools/check-layout.ts [id...]     # is it driveable?
npx tsx tools/fit-layout.ts <id> <metres> # solve it so it closes
```

The fitter optimises for closure *and* against the road crossing over
itself, which the first version of Spa did — leaving one sheet of
tarmac lying two metres above another. Spa has since been removed: its
start/finish straight and its descent to Eau Rouge passed within a
metre of each other, and no amount of care in the mesh builder can
separate two roads that are on the same ground. `tests/overlap.test.ts`
now asserts that no circuit does this.

## The field

Rivals run along the racing line at a fraction of the speed profile
rather than as nine more rigid bodies. The profile already knows what
every corner is worth — it is the one the autopilot drives to — so a
rival is driving the same solution slightly less well, not following a
script laid beside it. They do not collide: they are traffic to judge
and pass.

## History

This repository used to hold two games: an arcade racer at the root
and the simulator under `f1sim/`. The arcade modelled the car as a
point on a one-dimensional ribbon — a distance and a lateral offset —
which made every handling question a matter of tuning constants that
stood in for physics rather than physics. Keeping both meant authoring
every circuit and building every feature twice.

It was removed once the simulator gained the one thing it was missing:
opponents. Its championship, its best-lap records and its car model
live on here, and it remains in the history if any of it is wanted
back.

## Note on names

"F1" and "Formula 1" are trademarks of Formula One Licensing BV. This
project uses no team names, driver names, liveries or car models — the
rivals are invented and the car is a generic open-wheeler. Circuit and
corner names are used descriptively, as place names. Keep it that way
if you fork it.

## Deploying

`vercel.json` builds the site with `tools/build-site.js`. Import the
repository at [vercel.com/new](https://vercel.com/new); the build
command, install command and output directory all come from
`vercel.json`, so there is nothing to fill in.

The import screen will not ask you which branch, and silently takes the
repository's default. If the work is on another branch the build
succeeds, reports **Ready**, and serves 404s. Set **Settings → Git →
Production Branch** afterwards.

Any static host works the same way:

```
npm --prefix f1sim install
node tools/build-site.js     # -> dist-site/
```
