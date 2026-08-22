#!/usr/bin/env python3
"""
Rebuild the game's font from the characters the game actually draws.

Unity's built-in IMGUI font has no Hangul in it and the failure is silent
— text simply does not appear — so the project ships its own face. Noto
Sans KR is 4.6 MB, which is not a thing to put in a WebGL build, so what
ships is a subset containing exactly the characters the scripts contain.

That subset was cut by hand once, and then the scripts changed. The start
card gained "T 트랙션 · P 자동주행" and six of those syllables had never
been cut, so what a player saw was "T 트 · P · R 리셋" — the label for the
traction-control key missing its noun and the autopilot's missing
entirely. Nothing failed. No warning, no missing asset, no console line:
a glyph that is not in a font is not an error, it is nothing.

So the subset is generated now, from the source of truth, which is the
string literals themselves. Collected rather than listed, because a list
is the thing that went stale.

Usage:

    npm pack @fontsource/noto-sans-kr        # or any Noto Sans KR
    tar xzf fontsource-noto-sans-kr-*.tgz
    pip install fonttools
    python3 tools/subset-font.py --from package/files

The source directory may hold a whole face or a pile of Google's
unicode-range shards; this picks the fewest files that cover everything
and merges those. It refuses to write a font that does not cover every
character, because writing one is what got us here.
"""

import argparse
import glob
import os
import re
import sys
import tempfile

SCRIPTS = 'unity/Assets/Scripts/*.cs'
TARGET = 'unity/Assets/Resources/NotoSansKR-Subset.ttf'

# Everything a format string can put on screen without appearing in one.
BASE = ''.join(chr(c) for c in range(0x20, 0x7f))

LITERAL = re.compile(r'"((?:\\.|[^"\\])*)"')


def mapped(path):
    """Every code point a font maps, read straight out of its cmap.

    Parsed by hand rather than with fontTools so that `--check` — the part
    of this that runs on every push — needs nothing installed. Cutting a
    font is a rare, deliberate act on a machine someone has set up; noticing
    that the cut one has gone stale has to be free, or it will not be done.
    """
    import struct

    d = open(path, 'rb').read()
    tables = {}
    for i in range(struct.unpack('>H', d[4:6])[0]):
        at = 12 + i * 16
        tag = d[at:at + 4].decode('latin1')
        offset, _length = struct.unpack('>II', d[at + 8:at + 16])
        tables[tag] = offset

    if 'cmap' not in tables:
        return set()

    base = tables['cmap']
    have = set()

    for i in range(struct.unpack('>H', d[base + 2:base + 4])[0]):
        _pid, _eid, offset = struct.unpack('>HHI', d[base + 4 + i * 8:base + 12 + i * 8])
        sub = base + offset
        fmt = struct.unpack('>H', d[sub:sub + 2])[0]

        if fmt == 4:
            pairs = struct.unpack('>H', d[sub + 6:sub + 8])[0]
            count = pairs // 2
            ends = struct.unpack(f'>{count}H', d[sub + 14:sub + 14 + pairs])
            starts = struct.unpack(f'>{count}H', d[sub + 16 + pairs:sub + 16 + pairs * 2])
            for lo, hi in zip(starts, ends):
                if lo == 0xFFFF:
                    continue
                have.update(range(lo, min(hi, 0xFFFE) + 1))

        elif fmt == 12:
            groups = struct.unpack('>I', d[sub + 12:sub + 16])[0]
            for g in range(groups):
                lo, hi, _start = struct.unpack('>III', d[sub + 16 + g * 12:sub + 28 + g * 12])
                have.update(range(lo, hi + 1))

    return have


def drawn(root):
    """Every character that appears in a string literal under Assets."""
    wanted = set(BASE)

    for path in sorted(glob.glob(os.path.join(root, SCRIPTS))):
        source = open(path, encoding='utf-8').read()
        # Comments are not drawn, and they are full of em dashes.
        source = re.sub(r'///[^\n]*', '', source)
        source = re.sub(r'/\*.*?\*/', '', source, flags=re.S)
        source = re.sub(r'//[^\n]*', '', source)

        for match in LITERAL.finditer(source):
            body = match.group(1)
            # `°` and friends are the character they name.
            body = re.sub(r'\\u([0-9a-fA-F]{4})',
                          lambda m: chr(int(m.group(1), 16)), body)
            body = re.sub(r'\\.', '', body)
            wanted.update(body)

    return {c for c in wanted if c.isprintable()}


def coverage(paths, weight):
    """What each candidate covers, keeping only the weight asked for.

    Read out of OS/2 rather than off the filename. A pack that splits a
    face into shards names them by unicode range and by weight, and the
    first run of this picked Thin over Regular purely because "100" sorts
    before "400" — a font that covered every character perfectly and drew
    the whole game in hairlines.
    """
    from fontTools.ttLib import TTFont

    have = {}
    for path in paths:
        try:
            font = TTFont(path, lazy=True)
            os2 = font['OS/2'] if 'OS/2' in font else None
            if os2 is not None and os2.usWeightClass != weight:
                font.close()
                continue
            have[path] = set(font.getBestCmap().keys())
            font.close()
        except Exception:
            continue
    return have


def cover(wanted, have):
    """The fewest files that between them hold every character."""
    left = {ord(c) for c in wanted}
    chosen = []

    while left:
        best, gain = None, 0
        for path, chars in have.items():
            if path in chosen:
                continue
            n = len(left & chars)
            if n > gain:
                best, gain = path, n
        if best is None:
            break
        chosen.append(best)
        left -= have[best]

    return chosen, {chr(c) for c in left}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--from', dest='source',
                    help='directory of .ttf/.otf/.woff files to cut from')
    ap.add_argument('--check', action='store_true',
                    help='only verify the shipped font draws everything')
    ap.add_argument('--root', default=os.path.dirname(os.path.dirname(
        os.path.abspath(__file__))))
    ap.add_argument('--out', default=None)
    ap.add_argument('--weight', type=int, default=400,
                    help='OS/2 usWeightClass to cut from (400 is regular)')
    args = ap.parse_args()

    out = args.out or os.path.join(args.root, TARGET)

    wanted = drawn(args.root)
    print(f'{len(wanted)} characters are drawn by the scripts')

    if args.check:
        have = mapped(out)
        gap = sorted((c for c in wanted if ord(c) not in have), key=ord)
        if gap:
            print()
            print('The shipped font cannot draw:')
            for c in gap:
                print(f'  {c!r}  U+{ord(c):04X}')
            print()
            print('Whatever these appear in will be drawn as nothing at all —')
            print('no error, no warning, just a gap where the words were.')
            print('Re-cut the font: see the note at the top of this file.')
            sys.exit(1)
        print(f'{os.path.basename(out)} draws all of them')
        return

    if not args.source:
        sys.exit('--from is required unless you only want --check')

    candidates = []
    for ext in ('ttf', 'otf', 'woff'):
        candidates += glob.glob(os.path.join(args.source, f'*.{ext}'))
    if not candidates:
        sys.exit(f'no fonts in {args.source}')

    have = coverage(sorted(candidates), args.weight)
    if not have:
        sys.exit(f'nothing in {args.source} is weight {args.weight}')
    chosen, missing = cover(wanted, have)

    if missing:
        sys.exit('No font here has: '
                 + ' '.join(f'{c!r} U+{ord(c):04X}' for c in sorted(missing, key=ord))
                 + '\nRefusing to write a font that cannot draw the game.')

    print(f'cut from {len(chosen)} file(s):')
    for path in chosen:
        print(f'  {os.path.basename(path)}')

    from fontTools.ttLib import TTFont
    from fontTools.merge import Merger
    from fontTools import subset

    with tempfile.TemporaryDirectory() as tmp:
        # Merged first and cut second. Cutting first would be faster and is
        # wrong: a merge wants whole faces, and two fonts trimmed to
        # disjoint glyph sets no longer agree about anything.
        if len(chosen) == 1:
            font = TTFont(chosen[0])
        else:
            plain = []
            for i, path in enumerate(chosen):
                one = TTFont(path)
                one.flavor = None
                where = os.path.join(tmp, f'{i}.ttf')
                one.save(where)
                plain.append(where)
            font = Merger().merge(plain)

        options = subset.Options()
        options.layout_features = ['*']
        options.notdef_outline = True
        options.recalc_bounds = True
        options.drop_tables += ['DSIG']

        subsetter = subset.Subsetter(options=options)
        subsetter.populate(text=''.join(sorted(wanted)))
        subsetter.subset(font)

        font.flavor = None
        font.save(out)

    check = TTFont(out)
    cmap = set(check.getBestCmap().keys())
    gap = [c for c in wanted if ord(c) not in cmap]
    check.close()

    if gap:
        sys.exit('The font that came out cannot draw: ' + ' '.join(sorted(gap)))

    print(f'{out} — {os.path.getsize(out) / 1024:.0f} KB, '
          f'{len(cmap)} characters, all of them drawn by the game')


if __name__ == '__main__':
    main()
