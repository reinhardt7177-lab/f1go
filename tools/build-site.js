#!/usr/bin/env node
/* ------------------------------------------------------------------
   Assemble the built simulator into the directory the host serves.

     /       the simulator
     /sim/   the same build, so links shared earlier keep working

   This script only moves files. It used to run the Vite build itself
   through execSync, which spawns a shell, which spawns npm, which
   spawns vite — a chain that dies with a stack-buffer overrun on some
   Windows setups, before printing anything, so the build looks like it
   never started. The build belongs in the build command; assembling
   belongs here.

     npm --prefix f1sim run build && node tools/build-site.js

   There used to be two games here — an arcade racer at the root and
   the simulator under /sim/. The arcade modelled the car as a point on
   a one-dimensional ribbon, which is a dead end next to a rigid body
   on four raycast wheels, and keeping both meant building every
   circuit and every feature twice.
   ------------------------------------------------------------------ */
'use strict';

const fs = require('node:fs');
const zlib = require('node:zlib');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const out = path.join(root, 'dist-site');
const dist = path.join(root, 'f1sim', 'dist');

if (!fs.existsSync(dist)) {
  console.error('f1sim/dist is missing — run the build first:');
  console.error('  npm --prefix f1sim run build');
  process.exit(1);
}

/* Clear the output by walking it. `fs.rmSync(dir, { recursive: true })`
   is the obvious call and it takes node 24 down on this machine with a
   stack-buffer overrun. Recursing by hand behaves the same everywhere. */
const clear = (dir) => {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) clear(p);
    else fs.unlinkSync(p);
  }
  fs.rmdirSync(dir);
};

/* Hand-rolled for the same reason as `clear`: node's recursive helpers
   — rmSync, cpSync, readdirSync({recursive}) — all abort this process
   on this machine. Copying a directory tree is ten lines and works
   the same on every runtime. */
const copy = (from, to) => {
  const stat = fs.statSync(from);
  if (!stat.isDirectory()) {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
    return;
  }
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    copy(path.join(from, entry.name), path.join(to, entry.name));
  }
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


/* ------------------------------------------------------------------
   The Unity player, fetched rather than built.

   Vercel builds this site on every push and has no Unity in it — the
   editor is a several-gigabyte install and needs a licence — so the
   player cannot be produced here. It is built by `.github/workflows/
   unity.yml` on a runner that does have one, and published as an asset
   on a rolling `webgl` release.

   A release asset rather than an Actions artifact because an artifact
   needs a token to download and this repository is public, so the asset
   does not. And a release asset rather than a commit because it is
   eleven megabytes that would otherwise land in the git history on
   every Unity change, forever.

   Missing is not fatal, and that is deliberate: the web version is the
   thing people are actually playing, and a Unity build that has not
   been produced yet — or a GitHub outage — must not take it down with
   it. The site then ships without `/unity/` and says so.
   ------------------------------------------------------------------ */
const UNITY_URL =
  'https://github.com/reinhardt7177-lab/f1go/releases/download/webgl/mumuF1-webgl.tar.gz';

/* Extracted by hand, in Node, with nothing installed.

   Vercel's install command is `npm --prefix f1sim install`, so a
   dependency added at the root would never be installed and this file
   would fail on the host and nowhere else. Shelling out to `tar` or
   `unzip` would work until the day the build image does not have one.
   Node has gzip built in, and tar is a genuinely simple format: 512-byte
   headers, the name at offset 0, the size in octal at 124, the type at
   156, and the contents padded to the next 512. */
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
       name is a placeholder. It applies to the next entry and to nothing
       else. */
    if (type === 'L') {
      pendingName = body.toString('utf8').replace(/\0.*$/, '');
      continue;
    }

    /* pax carries the same thing as `path=` inside a `len key=value`
       list. Anything else in there — times, ownership, extended
       attributes — is not wanted. */
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

const addUnity = async () => {
  const into = path.join(out, 'unity');

  let response;
  try {
    response = await fetch(UNITY_URL, { redirect: 'follow' });
  } catch (err) {
    console.log(`  /unity/  skipped — could not reach the release (${err.message})`);
    return;
  }

  if (!response.ok) {
    console.log(`  /unity/  skipped — the release returned ${response.status}`);
    return;
  }

  const gz = Buffer.from(await response.arrayBuffer());

  let files;
  try {
    files = untar(zlib.gunzipSync(gz), into);
  } catch (err) {
    console.log(`  /unity/  skipped — the archive would not open (${err.message})`);
    return;
  }

  if (files === 0) {
    console.log('  /unity/  skipped — the archive was empty');
    return;
  }

  /* The page has to be at the top, and an archive can easily arrive with
     it one level down: GameCI nests its output under the build name, so
     packing the directory above it produces exactly that. The workflow
     packs from the page's own directory now, and this is the belt to
     that pair of braces — an archive shaped either way is served the
     same, and a future change to the build name cannot quietly turn the
     whole thing into a 404 that every individual step reports as a
     success. */
  if (!fs.existsSync(path.join(into, 'index.html'))) {
    const entries = fs.readdirSync(into, { withFileTypes: true });
    const only = entries.length === 1 && entries[0].isDirectory() ? entries[0].name : null;

    if (only && fs.existsSync(path.join(into, only, 'index.html'))) {
      /* Lifted rather than re-extracted. Renaming into place would
         collide with the directory it is being lifted out of, so it goes
         via a name nothing else uses. */
      const nested = path.join(into, only);
      const staging = `${into}.lift`;
      fs.renameSync(nested, staging);
      fs.rmdirSync(into);
      fs.renameSync(staging, into);
      console.log(`  /unity/  lifted out of ${only}/ — the archive was nested`);
    } else {
      console.log('  /unity/  skipped — no index.html in the archive');
      fs.rmSync(into, { recursive: true, force: true });
      return;
    }
  }

  console.log(
    `  /unity/  the Unity build — ${files} files, ` +
    `${(size(into) / 1024 / 1024).toFixed(1)} MB`
  );
};

clear(out);
fs.mkdirSync(out, { recursive: true });

/* Static assets, laid down alongside the bundle rather than left to
   Vite. Vite copies `public/` itself — and on this machine that step
   dies the same way everything else recursive does, silently, leaving
   a dist that looks complete and has no car in it. Doing it here means
   the model ships whether or not the bundler managed it. */
const publicDir = path.join(root, 'f1sim', 'public');

/* Vite is configured with a relative base, so one build serves both the
   root and the sub-path without being rebuilt for each. Each
   destination is filled from the sources — never from the other
   destination, which would mean copying `out` into a directory inside
   `out` and recursing until the disk gave out. */
for (const dest of [out, path.join(out, 'sim')]) {
  copy(dist, dest);
  if (fs.existsSync(publicDir)) {
    for (const entry of fs.readdirSync(publicDir, { withFileTypes: true })) {
      copy(path.join(publicDir, entry.name), path.join(dest, entry.name));
    }
  }
}

copy(path.join(root, 'README.md'), path.join(out, 'README.md'));

/* Last, and awaited, so the size printed below is the whole site. Top
   level await is unavailable here — this file is CommonJS, because the
   host's build command runs it directly — so the tail is a callback. */
addUnity().then(() => {
  console.log(`dist-site ready — ${(size(out) / 1024 / 1024).toFixed(1)} MB`);
  console.log('  /      the simulator');
  console.log('  /sim/  the same build, for older links');
});
