# f1go

A Formula 1 simulator that runs in the browser: a rigid chassis on four
raycast wheels, a Pacejka tyre model with temperature and wear,
ground-effect aerodynamics that depend on ride height, a full
drivetrain, and lap timing derived from the car's position along the
centreline spline.

Race nine rivals over Spa-Francorchamps or Monza, with F1 points
carried across a season.

```
cd f1sim
npm install
npm run dev
```

Then open <http://localhost:5173>.

## Controls

| Action        | Keyboard              | Touch                        |
| ------------- | --------------------- | ---------------------------- |
| Throttle      | `↑` / `W`             | right side, lower half       |
| Brake         | `↓` / `S`             | right side, upper half       |
| Steer         | `←` `→` / `A` `D`     | left side                    |
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

`tests/` holds 154 tests over the tyre model, the thermal model, the
2026 power unit rules, the circuit geometry, the racing line and the
field.

## Circuits

Spa-Francorchamps and Monza, plus a flat proving ground used by the
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
tarmac lying two metres above another.

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
