# Drop asset packs here

Put the `.zip` in this folder exactly as it downloaded — no unpacking, no
renaming, no picking out files. Then run:

    python3 tools/install-kit.py

It looks inside, works out which model is meant to be which prop, and puts
the winners in `unity/Assets/Resources/Kit/` under the names the game looks
up. Several archives at once is fine — a racing pack and a nature pack
together is the usual case, since racing packs have no trees.

Nothing here is required. The game generates its own roadside and looks
right with this folder empty; a pack replaces the generated shapes with
modelled ones.

## You do not have to check the models

Units and pivots do not matter. The game measures each model as it loads
and scales and seats it against the shape it is replacing, so a pack
exported in centimetres and a pack whose pivots sit at the middle of the
bounding box both come out standing on the ground at the right size.

## If it picks the wrong one

Packs name files for people, so the matching is by keyword and it prints
what it chose. To overrule it, put a `mapping.txt` next to the zip:

    AdBoard     = Models/OBJ format/billboard.obj
    StartGantry = Models/OBJ format/gateLarge.obj

The left side is a `MumuF1.PropKind`; the right side is any path ending
that appears in one of the archives. Anything not listed is still guessed.

## Formats

`.obj` and `.fbx`, because Unity imports both on its own. glTF is skipped
deliberately: it needs a package installed, and a model that silently
fails to import is worse than one that is obviously absent.
