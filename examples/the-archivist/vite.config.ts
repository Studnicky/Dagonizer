/**
 * vite.config.ts: minimal dev/build config for the browser harness.
 *
 * Roots at this directory so `index.html` is the entry. Port pinned so
 * the README + tooling references stay deterministic.
 */

import { defineConfig } from 'vite';

export default defineConfig({
  'root':    import.meta.dirname,
  'server':  { 'port': 5174, 'strictPort': true, 'open': false },
  'build':   { 'target': 'es2022' },
  // esbuild can't parse `"target": "ES2024"` from the base tsconfig; pin
  // it to a version esbuild understands so the dev/build pipelines run
  // without warnings.
  'esbuild': { 'target': 'es2022', 'tsconfigRaw': { 'compilerOptions': { 'target': 'es2022', 'useDefineForClassFields': true } } },
});
