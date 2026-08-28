/**
 * vite.config.ts: minimal dev/build config for the browser harness.
 *
 * Roots at this directory so `index.html` is the entry. Port pinned so
 * the README + tooling references stay deterministic.
 */

import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

import { transformersEmbedderAssets } from '../the-archivist/tooling/transformersEmbedderAssets.ts';
import { dispatcherDeployPayloadPolicy } from './runtime/DispatcherDeployPayloadPolicy.ts';

function dispatcherManualChunks(id: string): string | undefined {
  if (
    id.endsWith('/runtime/DispatcherProviderRuntime.ts')
    || id.endsWith('/the-archivist/providers/BaseLlmClient.ts')
    || id.endsWith('/the-archivist/providers/MobileDetection.ts')
  ) return dispatcherDeployPayloadPolicy.providerRuntimeChunk;
  if (
    id.includes('/node_modules/.pnpm/@huggingface+transformers')
  ) return dispatcherDeployPayloadPolicy.transformerRuntimeChunk;
  if (id.includes('/node_modules/.pnpm/onnxruntime-')) {
    return dispatcherDeployPayloadPolicy.onnxRuntimeChunk;
  }
  if (id.includes('/node_modules/.pnpm/@vue+')) return 'vue-vendor';
  if (id.includes('/packages/dagonizer/dist/')) return 'dagonizer-core';
  if (
    id.includes('/node_modules/.pnpm/ajv')
    || id.includes('/node_modules/.pnpm/fast-deep-equal')
    || id.includes('/node_modules/.pnpm/fast-uri')
    || id.includes('/node_modules/.pnpm/json-schema-traverse')
  ) return 'schema-vendor';
  return undefined;
}

export default defineConfig({
  // Vue compiles `app/DispatcherRunner.vue` (the same SFC the docs site
  // renders); transformersEmbedderAssets stages the transformers embedder's
  // vendored model + onnxruntime WASM into the bundle so the in-browser
  // on-device intent classifier (shared with the-archivist via
  // `EmbedderProvisioner`) runs fully offline.
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
    'port':           5175,
    'strictPort':     true,
    'open':           false,
    'forwardConsole': { 'logLevels': ['warn', 'error'], 'unhandledErrors': true },
  },
  'build':   {
    'target': 'es2022',
    'rollupOptions': {
      'output': {
        'codeSplitting': {
          'groups': [{
            'name': (id) => dispatcherManualChunks(id) ?? null,
            'test': (id) => dispatcherManualChunks(id) !== undefined,
            'includeDependenciesRecursively': false,
          }],
        },
      },
    },
  },
  // esbuild can't parse `"target": "ES2024"` from the base tsconfig; pin
  // it to a version esbuild understands so the dev/build pipelines run
  // without warnings.
  'esbuild': { 'target': 'es2022', 'tsconfigRaw': { 'compilerOptions': { 'target': 'es2022', 'useDefineForClassFields': true } } },
});
