/**
 * Lint rules for the repository.
 *
 * This file, and the linter it configures, live at the root rather than
 * inside `f1sim/` — and that is not tidiness, it is the only way the two
 * fit together. typescript-eslint refuses to load against TypeScript 7
 * outright: `typescript-eslint does not support TS 7.0`, thrown from its
 * entry point, with a pointer to running it against the TypeScript 6 API
 * instead. The game builds with 7 and there is no published version of
 * the linter that accepts it.
 *
 * So each gets the compiler it wants, by the ordinary rules of module
 * resolution rather than by a trick: `f1sim/package.json` depends on
 * TypeScript 7 and builds with it, the root `package.json` depends on
 * TypeScript 6 and lints with it, and neither can see the other's copy.
 * Nesting `overrides` inside the linter's subtree was tried first and
 * npm hoisted straight past it.
 *
 * The two checkers were made to agree before this was committed: every
 * assertion TypeScript 6 called unnecessary was removed, and TypeScript
 * 7 still compiles the result, with all 299 tests passing. Worth
 * re-checking if that ever stops being true — a rule that reasons about
 * what is *necessary* is only as right as the checker running it, and
 * the checker running it is not the one that compiles this code.
 *
 * `.mjs` rather than `.js` because the root package is deliberately not
 * `"type": "module"`: `tools/build-site.js` is CommonJS and the host's
 * build command runs it, so declaring the root ESM breaks the deploy.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/* The game has its own tsconfig, and the rules that need types need to
   be pointed at it. Absolute, because typescript-eslint insists — and
   derived from this file's location rather than the working directory,
   so linting works from anywhere in the repository. */
const game = path.join(path.dirname(fileURLToPath(import.meta.url)), 'f1sim');

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      'f1sim/dist/**',
      'dist-site/**',
      'f1sim/public/**'
    ]
  },

  js.configs.recommended,

  // Everything the tsconfig knows about gets the rules that need types.
  {
    files: ['f1sim/src/**/*.ts', 'f1sim/tests/**/*.ts', 'f1sim/vite.config.ts'],
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: game },
      globals: { ...globals.browser }
    }
  },

  // The offline tools are outside the tsconfig, so they get the rules
  // that only need the syntax.
  {
    files: ['f1sim/tools/**/*.ts'],
    extends: [...tseslint.configs.recommended],
    languageOptions: { globals: { ...globals.node } }
  },

  {
    files: ['f1sim/tests/**/*.ts', 'tools/**/*.js'],
    languageOptions: { globals: { ...globals.node } }
  },

  /* Last, so it wins over the recommended sets above, and scoped to
     TypeScript so the plugin it names is actually loaded. */
  {
    files: ['**/*.ts'],
    plugins: { '@typescript-eslint': tseslint.plugin },
    rules: {
      /* An underscore already means "kept on purpose" in this codebase,
         and it is written down where it is used: `mat()` in
         `render/cockpit.ts` keeps a roughness and a metalness it no
         longer needs because taking them out would mean editing thirty
         call sites to say less. The convention is honoured rather than
         argued with. */
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_'
        }
      ]
    }
  }
);
