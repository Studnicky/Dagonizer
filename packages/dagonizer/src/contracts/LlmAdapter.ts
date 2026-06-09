/**
 * LlmAdapter: consumer-implemented contract for LLM transport plugins.
 *
 * Canonical re-export for the `./contracts` subpath. The interface is
 * defined in `src/adapter/LlmAdapter.ts` alongside the entity types
 * (`ChatRequest`, `ChatResponse`, `AdapterCapabilities`, …) it depends
 * on; moving the declaration here would require editing non-owned files
 * (`BaseAdapter.ts`, `LlmAdapterRegistry.ts`, `LlmAdapterCascade.ts`)
 * which import `LlmAdapter` from `./LlmAdapter.js`. Full source migration
 * is deferred to the Wave 4 adapter agent which owns those files.
 *
 * This re-export makes `LlmAdapter` available at `@noocodex/dagonizer/contracts`
 * and in the `./contracts` barrel, symmetrically to `Embedder`.
 */

export type { LlmAdapter } from '../adapter/LlmAdapter.js';
