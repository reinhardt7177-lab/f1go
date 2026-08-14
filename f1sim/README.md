# f1sim

An open-wheel car on Spa-Francorchamps, with every parameter that shapes
the handling on a live slider and the telemetry to read what it did.

Stages one to four of a racing simulation — the physics, the circuit,
an AI driver and the session rules. The arcade racer in the parent directory
shares nothing with it but a repository.

```
npm install
npm run dev        # http://localhost:5173
npm test           # 105 headless simulation tests
npm run build      # typecheck + production bundle
```

There is one car, so a race is still a timed run against yourself.

## The AI

Tick **AI 주행** under 주행 보조 and it drives. It builds a racing line
from the circuit, works out a speed for every point on it from curvature
and the grip available at that speed, and follows both. It picks itself
up when it spins.

It is honest about what it is: it laps Spa continuously and holds the
line within a few metres for most of it, but it still runs wide often
enough that its laps are usually deleted for track limits. The racing
line is a shortest path rather than a minimum-curvature one, and the
controller models the car's steady state rather than its transient
response. Both of those are what stands between this and a quick lap.

The pieces are worth reading even so — `speedprofile.ts` derives which
corners are flat from the physics rather than from a table, which is why
Blanchimont comes out flat and La Source comes out at 80 km/h.

## Sessions

Pick one with a query string — `?session=practice` (default),
`?session=qualifying`, `?session=race`.

| | ends when | judged on |
| --- | --- | --- |
| Practice | never | best lap |
| Qualifying | 12 minutes, then the lap in progress finishes | best lap |
| Race | 5 laps | elapsed time plus penalties |

Two excursions beyond the white lines are tolerated; every one after
that is five seconds on the result. The lap itself is deleted regardless
— that part is the timer's job, not the session's.

`P` calls a pit stop. It is refused unless the car is nearly stationary,
which stands in for a pit lane until there is one. The stop holds the
car for twenty-two seconds while the session clock keeps running, and
you get a fresh set of tyres out of it — cold ones, so there is an
out-lap to serve as well. Whether that trade is worth it is the whole
question a strategy is answering.

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

## The circuit

Spa-Francorchamps: 7.011 km against the real 7.004, nineteen named
corners, and 67 m of elevation. Corner sequence and gradients are read
off track maps rather than survey data — the intent is that Eau Rouge is
genuinely committed and Pouhon genuinely long, not that the geometry
would survive a tape measure.

A circuit is a list of straights and constant-radius corners with
lengths, gradients and banking. Everything else — the road mesh, the
physics collider, which surface is under each wheel, lap and sector
timing — is derived from integrating that list into a centreline spline.

There is a second circuit, `proving`, selectable in code: two long flat
straights joined by 150 m bends. Every vehicle-dynamics test runs there,
because a braking-distance measurement taken on Spa would be measuring
Eau Rouge.

## Timing

The tower on the left runs off `(s, t)` — how far round the lap the car
is, and how far it is from the centreline. Sector splits go purple when
they are your best. A lap with a wheel beyond the white line is struck
through and does not count. **Optimal** is your best sectors added
together.

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
- **Tread temperature** — blue is too cold to key into the road, green
  is in the window, red is greasing. Tyres start out of the blankets
  below the window, so the first lap is a real out-lap.
- **Wear** — grip falls as rubber goes, and a worn tyre wants to run
  cooler, so the window moves with it.

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
| `track/` | circuit definitions, centreline spline, mesh generation |
| `race/` | lap and sector timing, session rules |
| `ai/` | racing line, speed profile, driver |
| `render/` | three.js scene, cameras, interpolation |
| `input/` | keyboard and gamepad → `ControlState` |
| `ui/` | telemetry and tuning panels |
| `tests/` | headless simulation tests |

`sim/` imports no rendering code, which is what makes the tests possible
and what will later allow a server, an AI training loop and replays to
run the identical model. See [ARCHITECTURE.md](ARCHITECTURE.md) for why
the vehicle model is shaped the way it is, and what stages three
through five look like.

## Where the numbers come from

Mass, wheelbase, track and tyre radius are close to a current-regulation
car. `ClA` of 4.2 and `CdA` of 1.3 put peak downforce and drag-limited
top speed in the right places (about 3.5× car weight at 300 km/h, and
360 km/h flat out). The magic-formula coefficients are solved so grip
peaks near 7° of slip angle and 0.12 slip ratio. The thermal
coefficients are sized from the equilibrium a tyre has to hold: about
8 kW dissipated should settle near 100 °C in a 60 m/s airstream.

Downforce also depends on ride height. A modern floor is a venturi that
pulls harder the closer it runs to the road, until the flow separates
and it stalls — which re-extends the springs, lifts the floor,
reattaches the flow, and slams the car back down. Porpoising is not
scripted anywhere; it falls out of three numbers in `aero.ts`.

None of it is manufacturer data, and none of it is claimed to match any
particular car. It is a plausible starting point that behaves correctly,
which is what a bench is for — change it and watch what happens.
