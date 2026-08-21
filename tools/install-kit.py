#!/usr/bin/env python3
"""
Unpack a downloaded asset pack into the folder the game reads.

Drop any number of .zip files into `vendor/kit-drop/` and run this. It
looks inside each one, works out which model is meant to be which prop,
copies the winners into `unity/Assets/Resources/Kit/` under the names
`TracksideBuilder` looks up, and tells you how big each one turned out.

    python3 tools/install-kit.py

Nothing here is required to play. The game generates its own roadside and
looks right without any of this; a pack replaces the generated shapes with
modelled ones. Re-running is safe and overwrites what it wrote before.

Why a script rather than instructions: a pack names its files for people, in
folders arranged for people, and nothing in it says which model is meant to
be a marshal post. Working that out by hand for every pack is the work you
were trying to avoid.

You do not have to care what units the pack was exported in or where its
pivots sit. The game measures each model as it loads and scales and seats it
against the shape it is replacing — see `KitFit`. The sizes printed here are
so you can see what arrived, not because anything depends on them.
"""

import os
import re
import shutil
import sys
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DROP = os.path.join(ROOT, 'vendor', 'kit-drop')
KIT = os.path.join(ROOT, 'unity', 'Assets', 'Resources', 'Kit')

# Formats Unity imports on its own. glTF is deliberately absent: it needs a
# package installed, and a model that silently does not import is worse than
# one that is obviously missing.
MODELS = ('.obj', '.fbx')

# OBJ is preferred over FBX even though both import, because OBJ is text and
# its vertices can be read here — which is the only way to know how big the
# model is and where its pivot sits without an editor.
PREFERENCE = {'.obj': 0, '.fbx': 1}

# Which names mean which prop, most specific first. A pack names its files
# for people rather than for this, so matching is by keyword and the result
# is printed for you to disagree with.
RULES = [
    ('Conifer',     ['tree_pinetall', 'tree_pine', 'pine', 'conifer', 'fir', 'spruce', 'treelarge']),
    ('Broadleaf',   ['tree_oak', 'oak', 'tree_default', 'tree_round', 'tree_fat',
                     'tree_blocks', 'tree_simple', 'tree_thin', 'treesmall', 'tree']),
    ('Grandstand',  ['grandstandcovered', 'grandstand', 'tribune', 'bleacher', 'stadium']),
    ('AdBoard',     ['billboard', 'bannertower', 'banner', 'advert', 'sponsor', 'hoarding']),
    ('Flag',        ['flagcheckers', 'flag']),
    # `overheadLights` is the start-light gantry, which is exactly the thing.
    # Nothing here matches "bridge" on purpose: a racing kit's bridges are
    # road pieces — roadCornerBridgeLarge and friends — and a keyword that
    # picked one would put a section of tarmac over the timing line.
    ('StartGantry', ['overheadlights', 'overhead', 'gantry', 'gatelarge', 'archway', 'startline']),
    # No marshal post in the racing kit, and a light post does the same job:
    # something close to the road for the eye to judge distance against.
    ('MarshalPost', ['signdirection', 'sign', 'marshal', 'marker',
                     'lightpostmodern', 'lightpost', 'pylon', 'post']),

    # The car. Kenney's car kit keeps bodies and wheels apart, which is what
    # makes it usable here: the wheels have to steer and spin, so a car
    # modelled as one lump would have to stand still from the axles out.
    ('Car',         ['race', 'racecarred', 'racecar']),
    ('Wheel',       ['wheel-racing', 'wheel-default', 'wheel']),
]


# Everything a matched model might need beside it. Textures are copied even
# though the game repaints every kit model into its own style, because Unity
# logs an import error for a missing one and an error nobody needs is still
# an error somebody has to read.
SIBLINGS = ('.mtl', '.png', '.jpg', '.jpeg', '.tga')


def zips():
    if not os.path.isdir(DROP):
        return []
    return sorted(
        os.path.join(DROP, n) for n in os.listdir(DROP)
        if n.lower().endswith('.zip')
    )


def overrides():
    """`Kind = some/path/in/the/zip.obj` lines, when the guess is wrong."""
    path = os.path.join(DROP, 'mapping.txt')
    chosen = {}
    if not os.path.isfile(path):
        return chosen
    with open(path, encoding='utf-8') as handle:
        for line in handle:
            line = line.split('#', 1)[0].strip()
            if not line or '=' not in line:
                continue
            kind, name = (part.strip() for part in line.split('=', 1))
            chosen[kind] = name
    return chosen


def score(entry, patterns):
    """Lower is better. None means this file is not a candidate at all."""
    base = os.path.basename(entry).lower()
    stem, ext = os.path.splitext(base)
    if ext not in MODELS:
        return None

    for rank, pattern in enumerate(patterns):
        if pattern in stem:
            # Rank by how specific the matched keyword was, then prefer a
            # readable format, then the least decorated name — `tree.obj`
            # over `tree_detailed_variantB.obj`, which is usually the plain
            # one somebody would have picked by hand.
            return (rank, PREFERENCE[ext], len(stem))
    return None


def pick(entries, patterns):
    best, best_score = None, None
    for entry in entries:
        s = score(entry, patterns)
        if s is None:
            continue
        if best_score is None or s < best_score:
            best, best_score = entry, s
    return best


def obj_bounds(data):
    """The box around an OBJ's vertices, read straight out of the text."""
    lo = [float('inf')] * 3
    hi = [float('-inf')] * 3
    found = False

    for line in data.splitlines():
        if not line.startswith('v '):
            continue
        parts = line.split()
        if len(parts) < 4:
            continue
        try:
            xyz = [float(parts[1]), float(parts[2]), float(parts[3])]
        except ValueError:
            continue
        found = True
        for i in range(3):
            lo[i] = min(lo[i], xyz[i])
            hi[i] = max(hi[i], xyz[i])

    return (lo, hi) if found else None


def install():
    archives = zips()
    if not archives:
        print(f'nothing to unpack: put a .zip in {os.path.relpath(DROP, ROOT)}')
        return 0

    os.makedirs(KIT, exist_ok=True)
    forced = overrides()
    installed = []
    missing = []

    # Every model file in every archive, remembered with the zip it came from.
    catalogue = []
    for path in archives:
        with zipfile.ZipFile(path) as archive:
            for name in archive.namelist():
                if name.endswith('/'):
                    continue
                if os.path.splitext(name)[1].lower() in MODELS:
                    catalogue.append((path, name))
        print(f'read {os.path.basename(path)}')

    if not catalogue:
        print('  no .obj or .fbx anywhere in it — is this a 2D pack?')
        return 1

    for kind, patterns in RULES:
        if kind in forced:
            wanted = forced[kind].lower()
            hit = next(((z, n) for z, n in catalogue if n.lower().endswith(wanted)), None)
            if hit is None:
                print(f'  {kind:<12} override "{forced[kind]}" is not in any archive')
                missing.append(kind)
                continue
        else:
            names = [n for _, n in catalogue]
            chosen = pick(names, patterns)
            if chosen is None:
                missing.append(kind)
                continue
            hit = next((z, n) for z, n in catalogue if n == chosen)

        source_zip, entry = hit
        ext = os.path.splitext(entry)[1].lower()
        target = os.path.join(KIT, kind + ext)

        with zipfile.ZipFile(source_zip) as archive:
            payload = archive.read(entry)
            with open(target, 'wb') as out:
                out.write(payload)

            # The material file, which is where a pack keeps the colours
            # that are not in a texture — a tree's bark and its leaves are
            # two named materials with real diffuse values, and that is
            # worth keeping.
            folder = os.path.dirname(entry)
            stem = os.path.splitext(os.path.basename(entry))[0]
            mtl = f'{folder}/{stem}.mtl' if folder else f'{stem}.mtl'
            if mtl in archive.namelist():
                material = archive.read(mtl)
                with open(os.path.join(KIT, os.path.basename(mtl)), 'wb') as out:
                    out.write(material)

                # And whatever it points at, keeping the folder it points
                # through so the relative path still resolves.
                for ref in set(re.findall(rb'^\s*map_\w+\s+(.+?)\s*$',
                                          material, re.MULTILINE)):
                    rel = ref.decode('utf-8', 'replace').replace('\\', '/')
                    source = os.path.normpath(os.path.join(folder, rel)).replace(os.sep, '/')
                    if source not in archive.namelist():
                        continue
                    target_texture = os.path.join(KIT, *rel.split('/'))
                    os.makedirs(os.path.dirname(target_texture), exist_ok=True)
                    with open(target_texture, 'wb') as out:
                        out.write(archive.read(source))

        note = ''
        if ext == '.obj':
            box = obj_bounds(payload.decode('utf-8', 'replace'))
            if box:
                lo, hi = box
                size = [hi[i] - lo[i] for i in range(3)]
                note = f'  {size[0]:.2f} x {size[1]:.2f} x {size[2]:.2f} m'
                if max(size) > 60 or max(size) < 0.2:
                    note += '  (odd units — the game will rescale it)'
        else:
            note = '  (fbx: not readable here; the game measures it at load)'

        installed.append(kind)
        print(f'  {kind:<12} <- {entry}{note}')

    print()
    print(f'installed {len(installed)} of {len(RULES)}: {", ".join(installed) or "none"}')
    if missing:
        print(f'not found: {", ".join(missing)}')
        print('  those keep their generated shape, which is fine — or name one')
        print(f'  yourself in {os.path.relpath(DROP, ROOT)}/mapping.txt, e.g.')
        print('    AdBoard = Models/OBJ/billboard.obj')
    print('the game rescales and seats each one against the shape it replaces,')
    print('so units and pivots in the pack do not matter')
    return 0


if __name__ == '__main__':
    sys.exit(install())
