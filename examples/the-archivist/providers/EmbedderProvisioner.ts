/**
 * EmbedderProvisioner: memoized browser embedder selection and IntentClassifier
 * construction.
 *
 * Walks a preference-ordered candidate list (transformers → tensorflow →
 * web-llm), selects the first embedder that probes true via EmbedderCascade,
 * connects it, and builds an IntentClassifier against it. The result is
 * memoized: every caller across backend swaps reuses the same instance.
 *
 * On any failure (no candidate probes true, CDN import fails, connect or
 * anchor-embed throws) the provisioner returns `{ embedder: null,
 * intentClassifier: null }` so callers keep working with LLM-only
 * classification.
 */

import type { EmbedderInterface } from '@studnicky/dagonizer/contracts';
import { EmbedderCascade, EmbedderRegistry } from '@studnicky/dagonizer/adapter';
import type { AdapterCapabilitiesType, AdapterDescriptorShapeType } from '@studnicky/dagonizer/adapter';

import { TransformersEmbedder } from '@studnicky/dagonizer-embedder-transformers';
import { UniversalSentenceEncoderEmbedder } from '@studnicky/dagonizer-embedder-tensorflow';
import { WebLlmEmbedder } from '@studnicky/dagonizer-embedder-web-llm';

import { IntentClassifier } from './IntentClassifier.ts';

export type EmbedderProvisionResultType = {
  readonly embedder: EmbedderInterface | null;
  readonly intentClassifier: IntentClassifier | null;
};

// Embedder adapters are not LLM adapters; these capability fields satisfy the
// shared AdapterDescriptorShapeType but carry no semantic meaning for embedders.
const EMBEDDER_CAPABILITIES: AdapterCapabilitiesType = {
  'toolUse': 'none',
  'structuredOutput': false,
  'jsonMode': false,
};

type CandidateEntry = {
  readonly descriptor: AdapterDescriptorShapeType;
  readonly factory: () => EmbedderInterface;
};

/**
 * Provisioning options. A Vite consumer supplies the transformers embedder's
 * served asset paths (from the `virtual:transformers-embedder-assets` module the
 * package's Vite plugin exposes) so the model + WASM load from the app's own
 * bundle — fully offline, no CDN. Absent (node, or no plugin) the embedder
 * uses its package-local vendored `models/`.
 */
export type EmbedderProvisionOptionsType = {
  readonly transformersLocalModelPath?: string;
  readonly transformersWasmPaths?: string;
};

// Memoized in-flight promise; populated on the first call to provision().
let provisionPromise: Promise<EmbedderProvisionResultType> | null = null;

/**
 * EmbedderProvisioner: memoized browser embedder + IntentClassifier factory.
 */
export class EmbedderProvisioner {
  /**
   * Provision a browser embedder and build an IntentClassifier against it.
   *
   * Memoized: subsequent calls return the same Promise without re-running
   * the cascade. Returns `{ embedder: null, intentClassifier: null }` when
   * no candidate is available or any step throws.
   */
  static provision(options: EmbedderProvisionOptionsType = {}): Promise<EmbedderProvisionResultType> {
    if (provisionPromise !== null) return provisionPromise;
    provisionPromise = EmbedderProvisioner.#run(options);
    return provisionPromise;
  }

  /**
   * Preference order: WASM-floor transformers first (always available), then
   * tensorflow USE, then WebGPU-gated web-llm. The transformers candidate is
   * parameterised by the browser asset paths supplied to `provision()`.
   */
  static #candidates(options: EmbedderProvisionOptionsType): readonly CandidateEntry[] {
    const transformersOptions = {
      ...(options.transformersLocalModelPath !== undefined ? { 'localModelPath': options.transformersLocalModelPath } : {}),
      ...(options.transformersWasmPaths !== undefined ? { 'wasmPaths': options.transformersWasmPaths } : {}),
    };
    return [
      {
        'descriptor': { 'provider': 'transformers', 'model': 'Xenova/all-MiniLM-L6-v2', 'capabilities': EMBEDDER_CAPABILITIES },
        'factory': () => new TransformersEmbedder(transformersOptions),
      },
      {
        'descriptor': { 'provider': 'tensorflow', 'model': 'universal-sentence-encoder', 'capabilities': EMBEDDER_CAPABILITIES },
        'factory': () => new UniversalSentenceEncoderEmbedder(),
      },
      {
        'descriptor': { 'provider': 'web-llm', 'model': 'snowflake-arctic-embed-s-q0f32-MLC-b4', 'capabilities': EMBEDDER_CAPABILITIES },
        'factory': () => new WebLlmEmbedder(),
      },
    ];
  }

  static async #run(options: EmbedderProvisionOptionsType): Promise<EmbedderProvisionResultType> {
    try {
      const candidates = EmbedderProvisioner.#candidates(options);
      const registry = new EmbedderRegistry();
      for (const candidate of candidates) {
        registry.register(candidate.descriptor, candidate.factory);
      }

      const preferences = candidates.map((c) => ({
        'provider': c.descriptor.provider,
        'model': c.descriptor.model,
      }));
      const cascade = new EmbedderCascade(registry, preferences);

      const embedder = await cascade.select();
      await embedder.connect();

      const intentClassifier = await IntentClassifier.create(embedder);
      return { embedder, intentClassifier };
    } catch (err) {
      console.info('[EmbedderProvisioner] embedder unavailable; using LLM-only intent classification:', err);
      return { 'embedder': null, 'intentClassifier': null };
    }
  }
}
