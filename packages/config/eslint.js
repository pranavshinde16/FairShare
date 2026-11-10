// Shared ESLint flat config for the whole monorepo.
//
// Besides code-quality rules, this file enforces the architecture's dependency
// boundaries (see ARCHITECTURE.md). A boundary violation fails `pnpm lint` and CI.

import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const RELATIVE = String.raw`\.{1,2}/`;

/** @param {string} message @param {string[]} groups */
const banImports = (message, groups) => ({
  'no-restricted-imports': ['error', { patterns: [{ group: groups, message }] }],
});

/** Allow only relative imports plus the given package names (exact or with subpaths). */
const onlyImports = (message, allowed = []) => {
  const names = allowed.map((n) => n.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&') + '(/.*)?').join('|');
  const regex = names ? `^(?!(${RELATIVE}|(${names})$))` : `^(?!${RELATIVE})`;
  return { 'no-restricted-imports': ['error', { patterns: [{ regex, message }] }] };
};

/** @param {{ tsconfigRootDir: string }} options */
export function createConfig({ tsconfigRootDir }) {
  return defineConfig([
    globalIgnores(['**/dist/', '**/coverage/', '**/.turbo/', '**/*.gen.ts']),

    js.configs.recommended,
    tseslint.configs.recommendedTypeChecked,
    {
      languageOptions: {
        parserOptions: { projectService: true, tsconfigRootDir },
      },
      rules: {
        '@typescript-eslint/consistent-type-imports': 'error',
        '@typescript-eslint/no-unused-vars': [
          'error',
          { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
        ],
        eqeqeq: ['error', 'always'],
      },
    },

    // Plain JS config files are not part of any tsconfig.
    {
      files: ['**/*.js', '**/*.config.ts'],
      extends: [tseslint.configs.disableTypeChecked],
      languageOptions: { globals: globals.node },
    },

    // ---- Architecture boundaries -------------------------------------------

    // packages/core is pure domain logic: zero dependencies, no I/O, no clock, no randomness.
    {
      files: ['packages/core/src/**/*.ts'],
      ignores: ['**/*.test.ts', 'packages/core/src/testing/**'],
      rules: {
        ...onlyImports(
          'packages/core must not import anything: it is pure, dependency-free logic.',
        ),
        'no-restricted-syntax': [
          'error',
          {
            selector: "MemberExpression[object.name='Date'][property.name='now']",
            message: 'core must not read the clock. Pass the date in as an argument.',
          },
          {
            selector: "NewExpression[callee.name='Date'][arguments.length=0]",
            message: 'core must not read the clock. Pass the date in as an argument.',
          },
          {
            selector: "MemberExpression[object.name='Math'][property.name='random']",
            message: 'core must be deterministic. Derive randomness from a seed.',
          },
        ],
      },
    },
    // Tests and shared test generators (src/testing/, never exported) may use test tools.
    {
      files: ['packages/core/src/**/*.test.ts', 'packages/core/src/testing/**'],
      rules: onlyImports('core tests may only import core itself and test tools.', [
        'vitest',
        'fast-check',
      ]),
    },

    // packages/contracts holds request/response shapes: zod plus core's types.
    {
      files: ['packages/contracts/src/**/*.ts'],
      rules: onlyImports('packages/contracts may only import zod and @fairshare/core.', [
        'zod',
        '@fairshare/core',
        'vitest',
      ]),
    },

    // packages/db holds the schema only. Feature queries live in apps/api modules.
    {
      files: ['packages/db/src/**/*.ts'],
      ignores: ['packages/db/src/seed/**', 'packages/db/src/**/*.test.ts'],
      rules: banImports('packages/db must not import other FairShare packages.', ['@fairshare/*']),
    },
    // The demo seed and the tests build transactions exactly as the server will, through core and
    // contracts (both pure). They are never imported by the schema or the client.
    {
      files: ['packages/db/src/seed/**', 'packages/db/src/**/*.test.ts'],
      rules: banImports('db seed and tests may only import core and contracts.', [
        '@fairshare/*',
        '!@fairshare/core',
        '!@fairshare/contracts',
      ]),
    },

    // packages/api-client talks HTTP using contracts. It never touches the database.
    {
      files: ['packages/api-client/src/**/*.ts'],
      rules: onlyImports('packages/api-client may only import @fairshare/contracts.', [
        '@fairshare/contracts',
        'zod',
        'vitest',
      ]),
    },

    // The web app reaches the server only through the API client.
    {
      files: ['apps/web/src/**/*.{ts,tsx}'],
      rules: banImports('apps/web must not import server-side code. Use @fairshare/api-client.', [
        '@fairshare/db',
        '@fairshare/api',
        'pg',
        'drizzle-orm',
        'drizzle-orm/*',
        'hono',
        'hono/*',
      ]),
    },

    // ---- Environment-specific settings -------------------------------------

    {
      files: ['apps/api/**/*.ts', 'packages/db/**/*.ts'],
      languageOptions: { globals: globals.node },
    },
    {
      files: ['apps/web/**/*.{ts,tsx}'],
      extends: [reactHooks.configs.flat['recommended-latest']],
      languageOptions: { globals: globals.browser },
    },

    // Must be last: turns off rules that conflict with Prettier formatting.
    prettier,
  ]);
}
