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

console.log(`dist-site ready — ${(size(out) / 1024 / 1024).toFixed(1)} MB`);
console.log('  /      the simulator');
console.log('  /sim/  the same build, for older links');
