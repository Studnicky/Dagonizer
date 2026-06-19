import { dagonizerEslintConfig } from '../../eslint.config.base.mjs';

export default [
  ...dagonizerEslintConfig(import.meta.dirname),
  // Onion-skin layering (§2.5): satellites import type-only symbols from the
  // `./types` subpath, never the root barrel. Value imports stay on the root
  // barrel. The canonical engine types are banned by name from the root
  // barrel and steered to `@studnicky/dagonizer/types`.
  {
    files: ['src/**/*.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          'paths': [
            {
              'name': '@studnicky/dagonizer',
              'importNames': ['NodeStateInterface', 'NodeContextInterface', 'NodeOutputInterface'],
              'message': 'Import engine types from @studnicky/dagonizer/types, not the root barrel (value imports stay on the root barrel).',
            },
          ],
        },
      ],
    },
  },
  // Sanctioned framework-purity exception: the spawn bootstrap IS the
  // stdin/stdout NDJSON transport, so it legitimately wraps `process.stdout`.
  // This is the ONLY package-runtime file allowed to touch the process
  // streams; every other `src/**` file inherits the deny rule from the shared
  // base config.
  {
    files: ['src/spawnEntry.ts'],
    rules: {
      'no-restricted-properties': 'off',
    },
  },
];
