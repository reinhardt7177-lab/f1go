# f1sim

A vehicle-dynamics test bench: one open-wheel car on a flat pad, with
every parameter that matters exposed on a slider and the telemetry you
need to tell whether a change helped.

This is stage one of a proper racing simulation — the physics, none of
the game. The arcade racer in the parent directory shares nothing with
it but a repository.

```
npm install
npm run dev        # http://localhost:5173
npm test           # 32 headless simulation tests
npm run build      # typecheck + production bundle
```

## Controls

| | |
| --- | --- |
| `W` / `↑` | throttle |
| `S` / `↓` / `Space` | brake |
| `A` `D` / `←` `→` | steer |
| `Q` `E` | downshift / upshift |
| `F` | DRS |
| `Shift` | ERS deployment |
| `C` | cycle camera — chase, cockpit, trackside |
| `R` | reset to the start |

A gamepad is picked up automatically when one is connected: triggers for
throttle and brake, left stick to steer, shoulder buttons for gears.

## What is on the pad

A 50 m skid-pad circle for steady-state cornering — hold a constant
radius and read peak lateral g off the traction circle — and distance
boards every 100 m down the straight for braking tests. The grid is 10 m.

## Reading the telemetry

Speed is the least useful number on the panel. The ones that tell you
what the car is doing:

- **Load bars** — vertical force through each contact patch. Watch the
  front pair grow under braking and the outside pair grow in a corner.
  That is weight transfer, and because grip per newton falls as load
  rises, transfer always costs total grip.
- **Grip bars** — how much of each tyre's friction circle is spent.
  Yellow is close to the limit, red is past it and sliding.
- **Slip readout** — slip angle in degrees, then slip ratio. The tyres
  peak near 7° and 0.12. More than that is not more grip.
- **Traction circle** — combined longitudinal and lateral g with a
  fading trail. A quick lap fills the ring; a scrappy one stays inside
  it and hops between the axes.

## Tuning

Every slider is bound to the live parameter object, so a change takes
effect on the next tick.

The presets are the useful part — they are the ends of each range, so
you can feel what a parameter does rather than guess from a number.
**Monza trim** against **Monaco trim** shows the whole aero trade in two
clicks. **No aero** shows how much of an F1 car's grip is not mechanical
at all. **Understeer** and **Oversteer** move the balance purely by
anti-roll bar stiffness, which only works because the tyre model has
load sensitivity.

Three derived numbers sit under the presets — peak power, drag-limited
top speed, and downforce at 250 km/h as a multiple of car weight. They
are how you tell whether a setup is physically sensible at all.

Traction control is on by default and can be switched off under **Driver
aids**. Switch it off and hold full throttle from rest to see why it is
there: first gear puts about 26 kN of thrust through rear tyres that can
carry roughly 7.5 kN, so the wheels spin, and spinning tyres have almost
no lateral grip left.

## Layout

| Directory | |
| --- | --- |
| `core/` | fixed-timestep loop, maths |
| `sim/` | tyres, aero, drivetrain, suspension, vehicle, world, driver aids |
| `track/` | centreline spline and world-position projection |
| `render/` | three.js scene, cameras, interpolation |
| `input/` | keyboard and gamepad → `ControlState` |
| `ui/` | telemetry and tuning panels |
| `tests/` | headless simulation tests |

`sim/` imports no rendering code, which is what makes the tests possible
and what will later allow a server, an AI training loop and replays to
run the identical model. See [ARCHITECTURE.md](ARCHITECTURE.md) for why
the vehicle model is shaped the way it is, and what stages two through
five look like.

## Where the numbers come from

Mass, wheelbase, track and tyre radius are close to a current-regulation
car. `ClA` of 4.2 and `CdA` of 1.3 put peak downforce and drag-limited
top speed in the right places (about 3.5× car weight at 300 km/h, and
360 km/h flat out). The magic-formula coefficients are solved so grip
peaks near 7° of slip angle and 0.12 slip ratio.

None of it is manufacturer data, and none of it is claimed to match any
particular car. It is a plausible starting point that behaves correctly,
which is what a bench is for — change it and watch what happens.
