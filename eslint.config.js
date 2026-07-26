// Flat ESLint config for MindAuth.
// Backend: Node.js CommonJS (src/, tests/, scripts/).
// Frontend: React + TypeScript (frontend/src/).
const js = require('@eslint/js');
const globals = require('globals');
const tseslint = require('typescript-eslint');
const reactHooks = require('eslint-plugin-react-hooks');

module.exports = tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'playwright-report/**',
      'test-results/**',
      'public/**',
      '.claude/**',
    ],
  },

  // Backend Node.js (CommonJS)
  {
    files: ['src/**/*.js', 'tests/**/*.js', 'scripts/**/*.js', '*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
    ...js.configs.recommended,
    rules: {
      ...js.configs.recommended.rules,
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-empty': ['warn', { allowEmptyCatch: true }],
      // JSDoc examples embed "/* … */" sequences with box-drawing chars
      'no-irregular-whitespace': ['error', { skipComments: true, skipStrings: true }],
    },
  },

  // ESM config files (playwright.config.js, vite.config.ts handled by TS block)
  {
    files: ['*.config.js', '*.config.mjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    ...js.configs.recommended,
  },

  // Playwright E2E specs — ESM modules, run browser code via page.evaluate.
  // no-undef is disabled: evaluate() callbacks reference page-defined globals
  // (apiFetch, showLoginView, sessionStorage) that ESLint cannot resolve.
  {
    files: ['tests/specs/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.browser },
    },
    ...js.configs.recommended,
    rules: {
      ...js.configs.recommended.rules,
      'no-undef': 'off',
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-empty': ['warn', { allowEmptyCatch: true }],
    },
  },

  // Frontend React + TypeScript
  {
    files: ['frontend/**/*.{ts,tsx}'],
    extends: [...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },
);
