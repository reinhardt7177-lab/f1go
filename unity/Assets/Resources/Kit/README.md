# The models the game uses, when it is not making its own

`CREDITS.md` says what is in here. Seven models out of Kenney's Racing
and Nature kits, all CC0, installed by `tools/install-kit.py` from the
archives.

It did not start full and it does not have to stay that way. Every kind
here is optional: `Resources.Load` returns null rather than throwing when
a name is missing, so deleting any of these files puts that prop back to
the shape the game generates for itself, and the game looks right either
way. Nothing in the project depends on an asset it cannot build without.

## The names

Each file is named for a value of `MumuF1.PropKind`, plus `Car` and
`Wheel`. That is the whole mapping — the enum is the contract and nothing
else has to be kept in step with it.

```
Conifer  Broadleaf  MarshalPost  Grandstand  AdBoard  Flag  StartGantry
Car  Wheel
```

`Car` and `Wheel` have no file here, and that is the point of the
mechanism rather than a gap in it: the game generates a single-seater and
a spoked wheel of its own, and dropping a `Car.obj` in would replace
them.

## Replacing one

Put the new model here under the same name, any format Unity imports —
`.obj` and `.fbx` both work. glTF does not, deliberately: it needs a
package installed, and a model that silently fails to import is worse
than one that is obviously absent.

You do not have to check its units or its pivot. Every model is measured
as it loads and scaled and seated into the space the generated shape
occupied, so a pack exported in centimetres and a pack pivoted on the
middle of its bounding box both come out standing on the ground at the
right size. `KitFit` does that, and its tests carry the real measurements
of the models in this folder.

Two things it cannot fix, because they are not size:

- **Which way it faces.** Boards, flags and posts are turned to look back
  across the road by a yaw about +Y, so a model whose front is not +Z
  will face the wrong way.
- **What it is.** A model much bigger than the shape it replaces will be
  scaled down to fit, which is right, but a grandstand standing in for a
  flag will still be a grandstand.

To change one wholesale, put a `mapping.txt` in `vendor/kit-drop/` and
run the installer again — the README there has the syntax.

## Colour

Materials are replaced with the house shader, and a model's own colours
are kept where it has them. The nature models name their materials and
give them real diffuse values, so bark is brown and leaves are green.
The racing and car models put their colour in a palette texture and
leave the material white, so those get the house colour for their kind.
White, black and grey are the signal that a model's colour lives
somewhere else.

The textures are here and imported, but the toon shader does not sample
one. This game is flat colour inside a black line, which is the same
reason the circuit itself has no textures at all.

## Not from here

The barrier. It is swept from the road's own vertices so it follows every
corner exactly, which a fence prefab repeated along a spline cannot do
without gapping on the outside of a corner or overlapping on the inside.
To change how it looks, change the colours in `TracksideBuilder`.
