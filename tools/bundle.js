#!/usr/bin/env node
/* ------------------------------------------------------------------
   Inline index.html and every script it loads into one HTML file.

     node tools/bundle.js [outfile]     # default: dist/f1go.html

   The output is deliberately written without <!doctype>, <html>,
   <head> or <body> wrappers. Browsers supply those themselves when you
   open the file directly, and leaving them out lets the same file drop
   into a host page that provides its own document shell.
   ------------------------------------------------------------------ */
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const out = path.resolve(root, process.argv[2] || 'dist/f1go.html');

const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

const pick = (re, what) => {
  const m = html.match(re);
  if (!m) throw new Error(`could not find ${what} in index.html`);
  return m[1];
};

const title = pick(/<title>([\s\S]*?)<\/title>/, '<title>');
const style = pick(/<style>([\s\S]*?)<\/style>/, '<style>');
let body = pick(/<body>([\s\S]*)<\/body>/, '<body>');

/* Swap every <script src="..."> for the file's contents. */
body = body.replace(/[ \t]*<script src="([^"]+)"><\/script>\n?/g, (_, src) => {
  const code = fs.readFileSync(path.join(root, src), 'utf8').trimEnd();
  if (code.includes('</script>')) {
    throw new Error(`${src} contains a literal </script> and cannot be inlined`);
  }
  return `<script>\n/* ${src} */\n${code}\n</script>\n`;
});

const bundle = `<title>${title}</title>
<style>${style}</style>
${body.trim()}
`;

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, bundle);

const kb = (Buffer.byteLength(bundle) / 1024).toFixed(1);
console.log(`${path.relative(root, out)} — ${kb} kB, no external requests`);
