/**
 * Ambient module declaration for the `virtual:transformers-embedder-assets`
 * module `transformersEmbedderAssets()` (see `./vite.ts`) resolves at build
 * time. Consumers that `import { localModelPath, wasmPaths } from
 * 'virtual:transformers-embedder-assets'` get typed exports without a
 * runtime module on disk.
 */
declare module 'virtual:transformers-embedder-assets' {
  export const localModelPath: string;
  export const wasmPaths: string;
}
