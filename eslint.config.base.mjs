import js from '@eslint/js';
import importPlugin from 'eslint-plugin-import-x';
import tseslint from 'typescript-eslint';

/**
 * Shared ESLint flat config factory for all @studnicky/dagonizer-* packages.
 *
 * @param {string} tsconfigRootDir - Absolute path to the package directory (pass `import.meta.dirname`).
 * @param {{ project?: string, files?: string[] }} [options]
 */
export function dagonizerEslintConfig(tsconfigRootDir, options = {}) {
  const project = options.project ?? './tsconfig.eslint.json';
  const files = options.files ?? ['src/**/*.ts', 'tests/**/*.ts'];

  return tseslint.config(
    {
      ignores: [
        '**/dist/**',
        '**/dist-test/**',
        '**/node_modules/**',
        '**/build/**',
        '**/*.d.ts',
        'docs/.vitepress/cache/**',
      ],
    },
    {
      files,
      languageOptions: {
        parser: tseslint.parser,
        parserOptions: {
          project,
          tsconfigRootDir,
        },
        globals: {
          // Node.js
          'Buffer': 'readonly',
          'NodeJS': 'readonly',
          'process': 'readonly',
          'setImmediate': 'readonly',
          'clearImmediate': 'readonly',
          '__dirname': 'readonly',
          '__filename': 'readonly',
          'module': 'readonly',
          'require': 'readonly',
          'exports': 'readonly',
          // Timers (shared Node/browser)
          'setTimeout': 'readonly',
          'clearTimeout': 'readonly',
          'setInterval': 'readonly',
          'clearInterval': 'readonly',
          // Console
          'console': 'readonly',
          // Web / Worker globals
          'globalThis': 'readonly',
          'self': 'readonly',
          'navigator': 'readonly',
          'WebAssembly': 'readonly',
          'Worker': 'readonly',
          'MessagePort': 'readonly',
          'MessageChannel': 'readonly',
          'MessageEvent': 'readonly',
          'postMessage': 'readonly',
          'crypto': 'readonly',
          'caches': 'readonly',
          'TextEncoder': 'readonly',
          'TextDecoder': 'readonly',
          'performance': 'readonly',
          'queueMicrotask': 'readonly',
          'Blob': 'readonly',
          'ReadableStream': 'readonly',
          'WritableStream': 'readonly',
          // Fetch API
          'fetch': 'readonly',
          'Response': 'readonly',
          'Request': 'readonly',
          'Headers': 'readonly',
          'RequestInit': 'readonly',
          // URL
          'URL': 'readonly',
          'URLSearchParams': 'readonly',
          // Abort
          'AbortController': 'readonly',
          'AbortSignal': 'readonly',
          // DOM exceptions + structured clone
          'DOMException': 'readonly',
          'structuredClone': 'readonly',
          // Storage
          'localStorage': 'readonly',
        },
      },
      plugins: {
        '@typescript-eslint': tseslint.plugin,
        'import-x': importPlugin,
      },
      rules: {
        ...js.configs.recommended.rules,
        ...tseslint.configs.recommended.rules,
        ...tseslint.configs.recommendedTypeChecked.rules,

        'no-unused-vars': 'off',

        '@typescript-eslint/no-unused-vars': [
          'error',
          {
            'argsIgnorePattern': '^_',
            'varsIgnorePattern': '^_',
            'caughtErrorsIgnorePattern': '^_',
          },
        ],
        '@typescript-eslint/consistent-type-imports': [
          'error',
          {
            'prefer': 'type-imports',
            'fixStyle': 'separate-type-imports',
          },
        ],
        '@typescript-eslint/no-explicit-any': 'warn',
        '@typescript-eslint/explicit-module-boundary-types': 'off',
        '@typescript-eslint/no-non-null-assertion': 'warn',

        'quote-props': ['error', 'always'],
        'eqeqeq': ['error', 'always', { 'null': 'ignore' }],
        'no-console': 'warn',
        'no-debugger': 'error',
        'no-redeclare': 'off',

        '@typescript-eslint/no-empty-interface': 'warn',
        '@typescript-eslint/ban-ts-comment': [
          'warn',
          {
            'ts-expect-error': 'allow-with-description',
            'ts-ignore': 'allow-with-description',
            'ts-nocheck': false,
            'ts-check': false,
          },
        ],

        'import-x/order': [
          'error',
          {
            'groups': ['builtin', 'external', 'parent', 'sibling', 'index'],
            'newlines-between': 'always',
            'alphabetize': { 'order': 'asc', 'caseInsensitive': true },
          },
        ],
        'import-x/no-duplicates': 'error',
      },
    },
  );
}
