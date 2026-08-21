# Where these models came from

Everything in this folder is by **Kenney** (<https://kenney.nl>) and is
released into the public domain under **CC0 1.0**. No attribution is
required and none is owed; this file exists because it is worth knowing
where a thing came from, not because a licence demands it.

| Installed as   | Model               | Pack        |
| -------------- | ------------------- | ----------- |
| `Conifer`      | `tree_pineTallA`    | Nature Kit  |
| `Broadleaf`    | `tree_oak`          | Nature Kit  |
| `MarshalPost`  | `sign`              | Nature Kit  |
| `Grandstand`   | `grandStandCovered` | Racing Kit  |
| `AdBoard`      | `billboard`         | Racing Kit  |
| `Flag`         | `flagCheckers`      | Racing Kit  |
| `StartGantry`  | `overheadLights`    | Racing Kit  |
| `Car`          | `race`              | Car Kit     |
| `Wheel`        | `wheel-racing`      | Car Kit     |

Installed by `tools/install-kit.py`, which chose each of these by name out
of the three archives. To change any of them, put a `mapping.txt` in
`vendor/kit-drop/` and run it again — see the README there.

## What the game does with them

Nothing is used as it arrives. Each model is measured as it loads and
scaled and seated into the space the generated shape occupied, so the
pack's units and pivots do not matter, and every clearance the placement
tests assert still holds.

Materials are replaced with the house shader. Where a model's own
materials carry real colours — the nature models name theirs, so bark is
brown and leaves are green — those colours are kept. Where the colour
lives in a palette texture instead and the material is left white, which
is how the racing and car models are built, the house colour for that kind
is used. The textures are here and imported, but the toon shader does not
sample one: this game is flat colour inside a black line, and that is the
same reason the circuit itself has no textures at all.
