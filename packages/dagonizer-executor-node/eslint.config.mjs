import { dagonizerEslintConfig } from '../../eslint.config.base.mjs';

export default [
  ...dagonizerEslintConfig(import.meta.dirname),
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
