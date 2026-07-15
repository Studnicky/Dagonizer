import { dagonizerEslintConfig } from '../../eslint.config.base.mjs';

export default dagonizerEslintConfig(import.meta.dirname, {
  files: ['src/**/*.ts'],
});
