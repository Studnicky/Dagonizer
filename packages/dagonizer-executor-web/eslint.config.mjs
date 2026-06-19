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
];
