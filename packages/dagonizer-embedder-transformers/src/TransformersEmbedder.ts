/**
 * TransformersEmbedder: in-browser text embedder backed by transformers.js
 * (Hugging Face) running on ONNX Runtime WASM. Loads the bundled npm
 * `@huggingface/transformers` package via dynamic import, lazily and
 * memoised for the adapter's lifetime, through `LocalModelEmbedder`'s
 * shared lifecycle.
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
 * `connect()` (inherited) lazy-loads the pipeline once; `disconnect()` clears
 * it. `performEmbed` (inherited) calls `connect()` (idempotent) before running
 * the extractor via `embedWith()`.
 */

import { fileURLToPath } from 'node:url';

import { LocalModelEmbedder, ModelCost } from '@studnicky/dagonizer/adapter';
import type { BaseEmbedderOptionsType } from '@studnicky/dagonizer/adapter';
import type { LlmModelType } from '@studnicky/dagonizer/entities';

import type { TransformersExtractorInterface, TransformersModuleInterface, TransformersPipelineOptionsType } from './TransformersHost.js';
import { transformersModuleValidator } from './TransformersHost.js';

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
 * The only pipeline dtype this package vendors weights for. Passed to
 * `mod.pipeline('feature-extraction', model, ...)` so the loader resolves
 * `onnx/model_quantized.onnx` instead of the (unvendored) fp32 default.
 */
const TRANSFORMERS_PIPELINE_OPTIONS: TransformersPipelineOptionsType = { 'dtype': 'q8' };

/**
 * Caller options for `TransformersEmbedder`. Extends the shared embedder
 * options with `localModelPath` — the filesystem directory transformers.js
 * resolves vendored model files from. Defaults to `models/` at this
 * package's root (vendored via `scripts/fetch-model.mjs`).
 */
export type TransformersEmbedderOptionsType = BaseEmbedderOptionsType & {
  readonly localModelPath?: string;
};

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

export class TransformersEmbedder extends LocalModelEmbedder<TransformersModuleInterface, TransformersExtractorInterface> {
  readonly #localModelPath: string;

  /**
   * Constructor: `(options?)`. All configuration lives in `options`.
   * `options.model` selects the embedding model (default: `Xenova/all-MiniLM-L6-v2`);
   * `options.dimensions` overrides the auto-resolved dimensionality;
   * `options.localModelPath` overrides the vendored `models/` directory
   * transformers.js loads weights from (default: this package's own `models/`).
   *
   * `new TransformersEmbedder()` → `Xenova/all-MiniLM-L6-v2`, 384 dims.
   * `new TransformersEmbedder({ model: 'Xenova/bge-small-en-v1.5' })` → 384 dims.
   * `new TransformersEmbedder({ model: 'custom/model', dimensions: 768 })` → 768 dims.
   */
  constructor(options: TransformersEmbedderOptionsType = {}) {
    const selectedModel = options.model ?? TRANSFORMERS_EMBEDDER_DEFAULTS.model;
    const dimensions = options.dimensions ?? (KNOWN_DIMENSIONS[selectedModel] ?? DEFAULT_DIMENSIONS);

    super('transformers', `Transformers.js (${selectedModel})`, dimensions, import.meta.url, options);
    this.setModel(selectedModel);
    this.#localModelPath = options.localModelPath ?? fileURLToPath(this.resolveAssetPath('../models/'));
  }

  /**
   * Import the bundled `@huggingface/transformers` npm package. The dynamic
   * `import()` result is `unknown`; narrowed through `transformersModuleValidator`
   * at the foreign boundary — no `as` casts. Points the module's `env` at the
   * vendored `models/` directory and disables remote hub fetches, so model
   * resolution is fully offline.
   */
  protected async loadModule(): Promise<TransformersModuleInterface> {
    const raw: unknown = await import('@huggingface/transformers');
    const module = transformersModuleValidator.validate(raw);
    module.env.allowRemoteModels = false;
    module.env.allowLocalModels = true;
    module.env.localModelPath = this.#localModelPath;
    return module;
  }

  /** Build the feature-extraction pipeline from the loaded module. */
  protected async spawnModel(module: TransformersModuleInterface): Promise<TransformersExtractorInterface> {
    return module.pipeline('feature-extraction', this.model, TRANSFORMERS_PIPELINE_OPTIONS);
  }

  /** Run the extractor against `text` with mean pooling and normalization. */
  protected async embedWith(model: TransformersExtractorInterface, text: string): Promise<readonly number[]> {
    const output = await model(text, { 'pooling': 'mean', 'normalize': true });
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
