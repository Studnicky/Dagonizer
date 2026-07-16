/**
 * vite.config.ts: minimal dev/build config for the browser harness.
 *
 * Roots at this directory so `index.html` is the entry. Port pinned so
 * the README + tooling references stay deterministic.
 */

import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

import { transformersEmbedderAssets } from './tooling/transformersEmbedderAssets.ts';

export default defineConfig({
  // Vue compiles `app/ArchivistRunner.vue` (the same SFC the docs site
  // renders); transformersEmbedderAssets stages the transformers embedder's
  // vendored model + onnxruntime WASM into the bundle so the in-browser
  // vector intent classifier runs fully offline.
  'plugins': [vue(), transformersEmbedderAssets()],
  'root':    import.meta.dirname,
  // `gl-bench` (a @cosmos.gl/graph dependency, pulled in via DagGraph.vue's
  // AnimatedDagGraph.ts) ships a `browser` field pointing at a global-script
  // build with no ES exports, and a `module` field with a real
  // `export default`. Vite's default field order picks `browser` first and
  // the build fails resolving `import GLBench from 'gl-bench'`. Preferring
  // `module` fixes this package without papering over it with an alias.
  'resolve': { 'mainFields': ['module', 'browser', 'main'] },
  'server':  {
    'port':           5174,
    'strictPort':     true,
    'open':           false,
    'forwardConsole': { 'logLevels': ['warn', 'error'], 'unhandledErrors': true },
  },
  'build':   { 'target': 'es2022' },
  // esbuild can't parse `"target": "ES2024"` from the base tsconfig; pin
  // it to a version esbuild understands so the dev/build pipelines run
  // without warnings.
  'esbuild': { 'target': 'es2022', 'tsconfigRaw': { 'compilerOptions': { 'target': 'es2022', 'useDefineForClassFields': true } } },
});
