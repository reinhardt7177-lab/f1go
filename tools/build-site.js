#!/usr/bin/env node
/* ------------------------------------------------------------------
   Build both projects into one static site.

     /       the arcade racer  (no build step; copied as-is)
     /sim/   f1sim             (Vite build)

   The two share nothing but this script and a repository, so they are
   assembled rather than integrated. f1sim's Vite config uses a relative
   base, which is what lets it sit under a sub-path without knowing it.
   ------------------------------------------------------------------ */
'use strict';

const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const out = path.join(root, 'dist-site');

const copy = (from, to) => {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.cpSync(from, to, { recursive: true });
};

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

// --- the arcade racer, verbatim -------------------------------------
for (const entry of ['index.html', 'js', 'assets', 'README.md']) {
  const src = path.join(root, entry);
  if (fs.existsSync(src)) copy(src, path.join(out, entry));
}

// --- f1sim ----------------------------------------------------------
const sim = path.join(root, 'f1sim');
console.log('building f1sim…');
execSync('npm run build', { cwd: sim, stdio: 'inherit' });
copy(path.join(sim, 'dist'), path.join(out, 'sim'));

const size = (dir) =>
  fs
    .readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile())
    .reduce((n, d) => n + fs.statSync(path.join(d.parentPath ?? d.path, d.name)).size, 0);

console.log(`dist-site ready — ${(size(out) / 1024 / 1024).toFixed(1)} MB`);
console.log('  /      arcade racer');
console.log('  /sim/  f1sim');
