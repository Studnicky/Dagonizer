/**
 * TransformersEmbedder: in-browser text embedder backed by transformers.js
 * (Hugging Face) running on ONNX Runtime WASM. No npm dependency on the
 * foreign library — the bundle is loaded once from the CDN ESM URL at
 * first `connect()` call and memoised for the adapter's lifetime.
 *
 * Usage:
 *
 *   const embedder = new TransformersEmbedder();
 *   const vector = await embedder.embed('the cat sat on the mat');
 *   // vector.length === embedder.dimensions === 384
 *
 * With an explicit model:
 *
 *   const embedder = new TransformersEmbedder({ model: 'Xenova/bge-small-en-v1.5' });
 *
 * `probe()` always returns `true`: transformers.js runs on ONNX Runtime WASM,
 * which requires no WebGPU and is available in every modern browser. The WASM
 * runtime is the universal floor.
 *
 * `connect()` lazy-loads the pipeline once; `disconnect()` clears it.
 * `performEmbed` calls `connect()` (idempotent) before running the extractor.
 */

import { BaseEmbedder, Classifications, LlmError, ModelCost } from '@studnicky/dagonizer/adapter';
import type { BaseEmbedderOptionsType } from '@studnicky/dagonizer/adapter';
import type { LlmModelType } from '@studnicky/dagonizer/entities';

import type { TransformersExtractorInterface } from './TransformersHost.js';
import { TRANSFORMERS_ESM, transformersModuleValidator } from './TransformersHost.js';

/** Default model for TransformersEmbedder when no model is specified. */
const DEFAULT_MODEL = 'Xenova/all-MiniLM-L6-v2';
const DEFAULT_DIMENSIONS = 384;

/**
 * Module-level defaults; the producer fills them so the consumer never
 * sees absence. Every instance field is a stable `string` or `number`
 * (no `| undefined`) for V8 shape stability.
 */
const TRANSFORMERS_EMBEDDER_DEFAULTS = {
  'model': DEFAULT_MODEL,
} as const;

/**
 * Known model → output dimensionality. Sourced from Hugging Face model cards.
 * When the consumer uses a model not listed here they must supply `dimensions`
 * explicitly. The runtime-load shortcut isn't worth a round-trip on construction.
 */
const KNOWN_DIMENSIONS: Readonly<Record<string, number>> = {
  'Xenova/all-MiniLM-L6-v2':    384,
  'Xenova/bge-small-en-v1.5':   384,
  'Xenova/gte-small':            384,
};

/**
 * Curated known-good embedding-model catalog. transformers.js can load ANY
 * Hugging Face feature-extraction model, so there is no bounded upstream
 * catalog; this list is the subset whose output dimensions this package
 * already knows (`KNOWN_DIMENSIONS` is the single source of truth for the
 * ids). Pass `{ model }` to the constructor to use any other HF model — it
 * runs all the same, the consumer just supplies `dimensions`. Every entry is
 * an on-device embedding model (`cloud: false`, `variant: 'embedding'`).
 */
const PREBUILT_EMBEDDING_MODELS: readonly LlmModelType[] = Object.keys(KNOWN_DIMENSIONS).map(
  (id): LlmModelType => ({ 'name': id, 'variant': 'embedding', 'cloud': false, 'costRank': ModelCost.rankFromName(id) }),
);

/**
 * Pending-extractor registry keyed on the adapter instance. Holding the lazy
 * connect promise here (rather than in a `Promise | null` instance field that
 * flips type after construction) keeps every `TransformersEmbedder` instance's
 * hidden class stable: the instance shape is fixed at construction and never
 * transitions a property's type. The entry is set once on first `connect()`
 * call and reused for the adapter's lifetime.
 */
const extractorPromises = new WeakMap<TransformersEmbedder, Promise<TransformersExtractorInterface>>();

export class TransformersEmbedder extends BaseEmbedder {
  /**
   * Constructor: `(options?)`. All configuration lives in `options`.
   * `options.model` selects the embedding model (default: `Xenova/all-MiniLM-L6-v2`);
   * `options.dimensions` overrides the auto-resolved dimensionality.
   *
   * `new TransformersEmbedder()` → `Xenova/all-MiniLM-L6-v2`, 384 dims.
   * `new TransformersEmbedder({ model: 'Xenova/bge-small-en-v1.5' })` → 384 dims.
   * `new TransformersEmbedder({ model: 'custom/model', dimensions: 768 })` → 768 dims.
   */
  constructor(options: BaseEmbedderOptionsType = {}) {
    const selectedModel = options.model ?? TRANSFORMERS_EMBEDDER_DEFAULTS.model;
    const dimensions = options.dimensions ?? (KNOWN_DIMENSIONS[selectedModel] ?? DEFAULT_DIMENSIONS);

    super('transformers', `Transformers.js (${selectedModel})`, dimensions, options);
    this.setModel(selectedModel);
  }

  /**
   * Lazy-load the transformers.js pipeline from the CDN ESM URL. Idempotent:
   * subsequent calls return the same promise. Uses `extractorPromises` WeakMap
   * to keep the instance shape stable (no `Promise | null` property flip).
   *
   * The dynamic `import()` result is `unknown`; narrowed through the schema
   * `transformersModuleValidator` at the foreign boundary — no `as` casts.
   */
  override async connect(): Promise<void> {
    if (extractorPromises.has(this)) {
      await extractorPromises.get(this);
      return;
    }

    const model = this.model;
    const promise = (async (): Promise<TransformersExtractorInterface> => {
      const raw: unknown = await import(/* @vite-ignore */ TRANSFORMERS_ESM);
      const mod = transformersModuleValidator.validate(raw);
      return mod.pipeline('feature-extraction', model);
    })();

    extractorPromises.set(this, promise);
    await promise;
  }

  /**
   * Disconnect clears the memoised extractor promise so the next `connect()`
   * call re-loads the pipeline.
   */
  override async disconnect(): Promise<void> {
    extractorPromises.delete(this);
  }

  protected async performEmbed(text: string, _signal: AbortSignal): Promise<readonly number[]> {
    await this.connect();
    const extractor = await extractorPromises.get(this);
    if (extractor === undefined) {
      throw new LlmError(
        `TransformersEmbedder: extractor not initialised`,
        Classifications['UNKNOWN'],
      );
    }
    const output = await extractor(text, { 'pooling': 'mean', 'normalize': true });
    return Array.from(output.data);
  }

  /**
   * Probe returns `true`: transformers.js runs on ONNX Runtime WASM, which
   * requires no WebGPU and is available in every modern browser.
   */
  override async probe(): Promise<boolean> {
    return true;
  }

  /**
   * Returns the curated known-good embedding-model catalog — the subset of HF
   * feature-extraction models whose output dimensions this package knows.
   * transformers.js can load any other HF model too; pass `{ model }` to the
   * constructor and supply `dimensions` for those. The catalog is a constant;
   * the returned Promise always resolves immediately.
   */
  override listModels(): Promise<readonly LlmModelType[]> {
    return Promise.resolve(PREBUILT_EMBEDDING_MODELS);
  }
}
