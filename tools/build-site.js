#!/usr/bin/env node
/* ------------------------------------------------------------------
   Assemble the site the host serves.

   There used to be two games here and then three. An arcade racer at
   the root, a TypeScript simulator under /sim/, and finally the Unity
   port at /unity/. The arcade went first, because a point on a
   one-dimensional ribbon is a dead end next to a rigid body on four
   raycast wheels. The TypeScript went second, because it had become the
   *reference* for a port that had overtaken it — every number in the C#
   was measured against it before being written down, and once that was
   done, keeping a second renderer, a second input stack and a second
   set of circuits meant building everything twice.

   Nothing was lost by deleting it. It is in the history, and the
   comments on the ported files still say which TypeScript file each one
   came from, because that is where they came from.

   So this script does one thing now: fetch the Unity player and lay it
   out. It builds nothing, because the thing it serves cannot be built
   here — see below.
   ------------------------------------------------------------------ */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const shell = require('./shell.js');

const root = path.resolve(__dirname, '..');
const out = path.join(root, 'dist-site');

/* ------------------------------------------------------------------
   The player, fetched rather than built.

   Vercel builds this site on every push and has no Unity in it — the
   editor is several gigabytes and needs a licence — so the player
   cannot be produced where the site is assembled. It is built by
   `.github/workflows/unity.yml` on a runner that does have one, and
   published as an asset on a rolling `webgl` release.

   A release asset rather than an Actions artifact because an artifact
   needs a token to download and this repository is public, so the asset
   does not. And a release asset rather than a commit because it is
   twelve megabytes that would otherwise land in the git history on
   every Unity change, forever.
   ------------------------------------------------------------------ */
const UNITY_URL =
  'https://github.com/reinhardt7177-lab/f1go/releases/download/webgl/mumuF1-webgl.tar.gz';

/* Extracted by hand, in Node, with nothing installed.

   Shelling out to `tar` or `unzip` would work until the day the build
   image does not have one, and a dependency would need an install step
   this build no longer has. Node has gzip built in, and tar is a
   genuinely simple format: 512-byte headers, the name at offset 0, the
   size in octal at 124, the type at 156, and the contents padded to the
   next 512. */
const untar = (buffer, into) => {
  let at = 0;
  let written = 0;
  /* Set by a long-name record, consumed by the entry after it. */
  let pendingName = null;

  while (at + 512 <= buffer.length) {
    const header = buffer.subarray(at, at + 512);

    /* Two zero blocks mark the end, but one is enough to stop on: a
       real header always starts with a name. */
    if (header[0] === 0) break;

    const field = (from, length) =>
      header.subarray(from, from + length).toString('ascii').replace(/\0.*$/, '').trim();

    /* A path longer than 100 characters is either split across `prefix`
       and `name` (POSIX) or written by the record before this one (GNU).
       Both happen in the wild — BSD tar does the first, GNU tar the
       second — and getting the second wrong is not a truncated name, it
       is a *file* created where a directory should be, which then makes
       every path under it fail to open. That is what the test found. */
    const prefix = field(345, 155);
    const name = field(0, 100);
    const full = pendingName !== null ? pendingName : prefix ? `${prefix}/${name}` : name;

    const size = parseInt(field(124, 12) || '0', 8) || 0;
    const type = String.fromCharCode(header[156] || 48);

    at += 512;
    const body = buffer.subarray(at, at + size);
    at += Math.ceil(size / 512) * 512;

    /* GNU's long name: the real path, as the body of a record whose own
       name is a placeholder. It applies to the next entry and nothing
       else. */
    if (type === 'L') {
      pendingName = body.toString('utf8').replace(/\0.*$/, '');
      continue;
    }

    /* pax carries the same thing as `path=` inside a `len key=value`
       list. Anything else in there is not wanted. */
    if (type === 'x' || type === 'g') {
      const match = /(?:^|\n)\d+ path=([^\n]*)/.exec(body.toString('utf8'));
      if (match) pendingName = match[1];
      continue;
    }

    /* Long link targets, and any other extension. Skipped, but the name
       still has to be released or it would attach to the wrong entry. */
    pendingName = null;

    if (type === 'K') continue;

    /* Never outside the destination, whatever the archive claims its
       paths are. This one is produced by our own CI, and checking anyway
       costs a line. */
    const target = path.resolve(into, full);
    if (target !== path.resolve(into) && !target.startsWith(path.resolve(into) + path.sep)) {
      continue;
    }

    if (type === '5') {
      fs.mkdirSync(target, { recursive: true });
    } else if (type === '0' || type === '\0') {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, body);
      written++;
    }
    /* Anything else — links, devices, whatever a future tar invents — is
       skipped. A player build contains none of them. */
  }

  return written;
};

/* Cleared by walking it. `fs.rmSync(dir, { recursive: true })` is the
   obvious call and it takes node down on some machines with a
   stack-buffer overrun; recursing by hand behaves the same everywhere. */
const clear = (dir) => {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) clear(p);
    else fs.unlinkSync(p);
  }
  fs.rmdirSync(dir);
};

/** Total bytes under a directory. */
const size = (dir) => {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    total += entry.isDirectory() ? size(p) : fs.statSync(p).size;
  }
  return total;
};

const build = async () => {
  clear(out);
  fs.mkdirSync(out, { recursive: true });

  let response;
  try {
    response = await fetch(UNITY_URL, { redirect: 'follow' });
  } catch (err) {
    console.error(`Could not reach the release: ${err.message}`);
    process.exit(1);
  }

  if (!response.ok) {
    console.error(`The release returned ${response.status}.`);
    console.error('Has the Unity workflow published a build yet?');
    process.exit(1);
  }

  const archive = Buffer.from(await response.arrayBuffer());

  /* A stamp for the player, taken from the player itself.
     Unity names its output `mumuF1.wasm` and does not hash it, and the
     host is told to cache everything under /Build/ for a year and treat
     it as immutable — which is correct for a hashed name and a trap for
     a fixed one. A browser that has been to the site once is told never
     to ask again, so it goes on running last week's game after a deploy
     that succeeded in every other respect. Ten hex digits of the archive
     make the URLs change exactly when the build does, which is what
     `immutable` was always promising. */
  const version = crypto.createHash('sha1').update(archive).digest('hex').slice(0, 10);

  const files = untar(zlib.gunzipSync(archive), out);
  if (files === 0) {
    console.error('The archive was empty.');
    process.exit(1);
  }

  /* The page has to be at the top, and an archive can arrive with it one
     level down: GameCI nests its output under the build name, so packing
     the directory above it produces exactly that. The workflow packs
     from the page's own directory now, and this is the belt to that pair
     of braces — the failure it guards against reports success at every
     individual step and then serves a 404. */
  if (!fs.existsSync(path.join(out, 'index.html'))) {
    const entries = fs.readdirSync(out, { withFileTypes: true });
    const only = entries.length === 1 && entries[0].isDirectory() ? entries[0].name : null;

    if (!only || !fs.existsSync(path.join(out, only, 'index.html'))) {
      console.error('No index.html in the archive — there is nothing to serve.');
      process.exit(1);
    }

    /* Lifted rather than re-extracted. Renaming into place would collide
       with the directory it is being lifted out of, so it goes via a
       name nothing else uses. */
    const staging = `${out}.lift`;
    fs.renameSync(path.join(out, only), staging);
    fs.rmdirSync(out);
    fs.renameSync(staging, out);
    console.log(`lifted out of ${only}/ — the archive was nested`);
  }

  /* And the page around it. Unity's own is a demo shell — a 960 by 600
     canvas in a white document under somebody else's logo — and the
     right place to replace it is a WebGL template inside the project,
     which needs a ProjectSettings.asset this project does not have
     because there is no editor here to write one. So it is replaced
     here, from the four build URLs read back out of it. */
  const index = path.join(out, 'index.html');
  fs.writeFileSync(index, shell.page(shell.urls(fs.readFileSync(index, 'utf8')), version));

  /* Unity's template art goes with its template. Leaving it would ship
     a Unity logo, two progress bars and a favicon nothing points at. */
  fs.rmSync(path.join(out, 'TemplateData'), { recursive: true, force: true });

  const kept = fs.readdirSync(out, { recursive: true }).length;
  console.log(`dist-site ready — ${kept} files, ${(size(out) / 1024 / 1024).toFixed(1)} MB` +
    ` (${files - kept} of Unity's template files dropped)`);
  console.log(`  player ${version}`);
  console.log('  /  the game');
};

build();
