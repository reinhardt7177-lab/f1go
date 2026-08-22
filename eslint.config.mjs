/**
 * Lint rules for the repository.
 *
 * There is very little left to lint. The game is C# under `unity/` and
 * is checked by `dotnet test` and by the Unity compiler; what remains in
 * JavaScript is `tools/`, which is the script that assembles the site
 * and the one that installs a model kit. Both are small and both run on
 * a host nobody watches, which is exactly where a typo costs the most.
 *
 * This file used to carry a long note about pinning two different
 * TypeScript versions so that the linter and the game's compiler could
 * coexist. That went with the TypeScript.
 *
 * `.mjs` rather than `.js` because the root package is deliberately not
 * `"type": "module"`: `tools/build-site.js` is CommonJS and the host's
 * build command runs it, so declaring the root ESM breaks the deploy.
 */
import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['dist-site/**', 'node_modules/**', 'unity/**', 'vendor/**'] },
  js.configs.recommended,
  {
    /* The driving harness is ESM and everything else here is CommonJS,
       which is why it is `.mjs` and why it needs its own block: the root
       package is deliberately not `"type": "module"`, because the host's
       build command runs `tools/build-site.js` and declaring the root ESM
       breaks the deploy. */
    files: ['tools/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      /* Both, and not by accident. The file runs under Node, and the
         callbacks it hands to Playwright run inside the page — so a
         reference to `document` in one of those is correct rather than a
         typo, and is the only place in this repository where that is
         true. */
      globals: { ...globals.node, ...globals.browser }
    },
    rules: {
      eqeqeq: ['error', 'always'],
      'no-var': 'error',
      'prefer-const': 'error'
    }
  },
  {
    files: ['tools/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: { ...globals.node }
    },
    rules: {
      eqeqeq: ['error', 'always'],
      'no-var': 'error',
      'prefer-const': 'error'
    }
  }
];
