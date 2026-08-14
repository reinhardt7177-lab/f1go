# f1go

A first-person cockpit F1 racer that runs in the browser. No build step, no
dependencies, no image or audio assets — every pixel is drawn procedurally
onto a single `<canvas>`.

Three circuits, nine AI rivals, lap timing, DRS, and a halo you look through.

## Running it

```
git clone https://github.com/reinhardt7177-lab/f1go.git
cd f1go
python3 -m http.server 8000
```

Then open <http://localhost:8000>.

Opening `index.html` straight off disk works too — the scripts are classic
`<script src>` tags rather than ES modules, so there is no CORS problem with
`file://`. It also deploys as-is to GitHub Pages: push the branch, then set
Pages to serve from the repository root.

## Controls

| Action   | Keyboard                    | Touch                       |
| -------- | --------------------------- | --------------------------- |
| Throttle | `↑` / `W`                   | bottom half of right screen |
| Brake    | `↓` / `S` / `Space`         | top half of right screen    |
| Steer    | `←` `→` / `A` `D`           | left screen, tap a side     |
| Restart  | `R`                         | —                           |

DRS opens automatically when you are within about a second of the car ahead
and the road is straight; the wheel display and the HUD tag both light up.

## How it works

The renderer is pseudo-3D, in the tradition of *Pole Position* and *OutRun*
rather than a polygon engine. A circuit is a flat list of segments, each
carrying a curve and a world height, and the road is drawn as a stack of
trapezoids projected from the driver's eye point:

```
scale   = cameraDepth / distanceToSegment
screenX = centre  + scale * relativeX * halfWidth
screenY = horizon - scale * relativeY * halfHeight
screenW = scale * roadWidth * halfWidth
```

Segments are painted front to back so each one clips the scenery behind it,
then cars and trackside objects are painted back to front inside those clip
bounds. Cornering is faked honestly: the accumulated curve shifts the road
sideways under a fixed camera, and centrifugal force pushes the car towards
the outside of the bend in proportion to speed.

Because the world is a 1D ribbon, you cannot see across the infield and there
is no free camera — which costs nothing here, since the view never leaves the
cockpit.

## Layout

| File            | What it holds                                                            |
| --------------- | ------------------------------------------------------------------------ |
| `index.html`    | canvas, HUD, menu and results markup, all styling                        |
| `js/util.js`    | maths helpers and the projection above                                   |
| `js/tracks.js`  | the segment builder, circuit definitions, colour themes                  |
| `js/render.js`  | road painter, procedural scenery, rival cars, the cockpit                |
| `js/game.js`    | physics, AI, timing, input, audio, main loop                             |

Physics run on a fixed 1/60 s timestep independent of the display refresh
rate, so a 144 Hz monitor drives exactly the same car as a 60 Hz one.

The engine note is synthesised with two oscillators through a low-pass filter
whose cutoff tracks speed — that is the entire audio pipeline.

## Circuits

`monaco`, `silverstone` and `suzuka`. Corner sequences and names follow the
real layouts; radii, elevations and lap lengths are hand-tuned approximations
tuned for how they drive, not survey data.

Adding one means adding a builder to `js/tracks.js` and a card to the menu:

```js
function buildInterlagos() {
  var b = new TrackBuilder(THEMES.silverstone);
  b.straight('START / FINISH', LEN.MEDIUM);
  b.at('T1 SENNA S', LEN.SHORT, LEN.SHORT, LEN.SHORT, -CRV.HARD, -HIL.MEDIUM);
  b.esses('T3 CURVA DO SOL', LEN.TINY, CRV.MEDIUM);
  // ...
  return b.finish();
}
```

`at(name, enter, hold, leave, curve, height)` builds one named corner, easing
in and out of the given curve. Positive curves bend right, negative left.
Positive heights climb. The name is what appears on the HUD as you drive
through it.

## Note on names

"F1" and "Formula 1" are trademarks of Formula One Licensing BV. This project
uses no team names, driver names, liveries or car models — the rivals are
invented and the cars are generic open-wheelers. Circuit and corner names are
used descriptively, as place names. Keep it that way if you fork it.

## f1sim — the simulation track

`f1sim/` is a separate, unrelated codebase in the same repository: a
vehicle-dynamics simulation built with TypeScript, three.js and the
Rapier physics engine, running on Spa-Francorchamps.

It shares no code with the arcade racer above. Where this game fakes a
road as a one-dimensional ribbon, that one models a rigid chassis on four
raycast wheels — a Pacejka tyre model with temperature and wear,
ground-effect aerodynamics that depend on ride height, per-surface grip,
a full drivetrain, and lap and sector timing derived entirely from the
car's position along the centreline spline.

See [f1sim/README.md](f1sim/README.md) to run it, and
[f1sim/ARCHITECTURE.md](f1sim/ARCHITECTURE.md) for the design and the
road from here to circuits, AI and multiplayer.
