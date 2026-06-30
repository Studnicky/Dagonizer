/**
 * WebLlmEmbedder: fully in-browser text embedder using `@mlc-ai/web-llm`
 * over WebGPU.
 *
 * Dynamically imports the bundled `@mlc-ai/web-llm` npm dependency and
 * loads a quantized Snowflake Arctic Embed model on first `connect()` /
 * `embed()` call; subsequent calls reuse the engine. WebGPU is required
 * (`navigator.gpu`).
 *
 * The foreign module boundary is narrowed via compiled JSON-Schema validators
 * (`webLlmEmbedderModuleValidator`, `webLlmEmbedderEngineValidator`) —
 * no `as` casts, no `@ts-ignore`.
 *
 * Local in-browser usage:
 *   `new WebLlmEmbedder()`
 * Custom model:
 *   `new WebLlmEmbedder({ model: 'snowflake-arctic-embed-m-q0f32-MLC-b4' })`
 *
 * `probe()` returns true iff `navigator.gpu` is present. In Node (no
 * WebGPU) it returns false — the embedder cascade routes around it.
 */

import { Classifications, LlmError, LocalModelEmbedder, ModelCost } from '@studnicky/dagonizer/adapter';
import type { BaseEmbedderOptionsType } from '@studnicky/dagonizer/adapter';
import type { LlmModelType } from '@studnicky/dagonizer/entities';

import {
  webLlmEmbedderEngineValidator,
  webLlmEmbedderModuleValidator,
} from './WebLlmEmbedderHost.js';
import type { WebLlmEmbedderEngineType, WebLlmEmbedderModuleInterface } from './WebLlmEmbedderHost.js';

const DEFAULT_MODEL = 'snowflake-arctic-embed-s-q0f32-MLC-b4';
const DEFAULT_DIMENSIONS = 384;

/**
 * Known model → output dimensionality. Single source of truth for both the
 * dimensionality of each model and the set of catalog ids (see
 * `PREBUILT_EMBEDDING_MODELS`, derived from `Object.keys` of this map).
 * Consumers pulling a model not listed here must supply `dimensions`
 * explicitly.
 *
 * The id set mirrors `@mlc-ai/web-llm`'s `prebuiltAppConfig.model_list`
 * filtered to `ModelType.embedding`: a static snapshot — no network call and
 * no WebGPU is required to enumerate it. Update when upstream web-llm changes
 * its embedding model list.
 */
const KNOWN_DIMENSIONS: Readonly<Record<string, number>> = {
  'snowflake-arctic-embed-m-q0f32-MLC-b32': 768,
  'snowflake-arctic-embed-m-q0f32-MLC-b4': 768,
  'snowflake-arctic-embed-s-q0f32-MLC-b32': 384,
  'snowflake-arctic-embed-s-q0f32-MLC-b4': 384,
};

/**
 * Snapshot of the `@mlc-ai/web-llm` embedding model catalog — the
 * `prebuiltAppConfig.model_list` entries whose `model_type` is
 * `ModelType.embedding`. Derived from `KNOWN_DIMENSIONS` so the id list has a
 * single source of truth. All entries are on-device embedding models
 * (`cloud: false`, `variant: 'embedding'`). Static data — no network call and
 * no WebGPU required to enumerate it. Update when upstream web-llm changes its
 * embedding model list.
 */
const PREBUILT_EMBEDDING_MODELS: readonly LlmModelType[] = Object.keys(KNOWN_DIMENSIONS).map(
  (id): LlmModelType => ({ 'name': id, 'variant': 'embedding', 'cloud': false, 'costRank': ModelCost.rankFromName(id) }),
);

/**
 * Module-level defaults; the producer fills them so the consumer never
 * sees absence. Instance fields stay stable `string` / `number` types
 * (V8 shape stability) rather than `string | undefined`.
 */
const WEB_LLM_EMBEDDER_DEFAULTS = {
  'model': DEFAULT_MODEL,
  'dimensions': DEFAULT_DIMENSIONS,
} as const;

export class WebLlmEmbedder extends LocalModelEmbedder<WebLlmEmbedderModuleInterface, WebLlmEmbedderEngineType> {
  /**
   * Resolve `navigator.gpu` from the global scope as `unknown`. The
   * standard lib `Navigator` typings predate WebGPU, so the WebGPU object
   * enters as `unknown` at this foreign boundary and is probed structurally
   * — never cast to a fabricated shape.
   */
  private static gpu(): object | undefined {
    const nav: unknown = Reflect.get(globalThis, 'navigator');
    if (typeof nav !== 'object' || nav === null) return undefined;
    const gpu: unknown = Reflect.get(nav, 'gpu');
    if (typeof gpu !== 'object' || gpu === null) return undefined;
    return gpu;
  }

  /**
   * Constructor: `(options?)`. All configuration lives in `options`.
   * `options.model` selects the embedding model (defaults to
   * `snowflake-arctic-embed-s-q0f32-MLC-b4`);
   * `options.dimensions` overrides the auto-resolved dimensionality.
   *
   * In-browser:  `new WebLlmEmbedder()`
   * Custom model: `new WebLlmEmbedder({ model: 'snowflake-arctic-embed-m-q0f32-MLC-b4' })`
   */
  constructor(options: BaseEmbedderOptionsType = {}) {
    const selectedModel = options.model ?? WEB_LLM_EMBEDDER_DEFAULTS.model;
    const dimensions = options.dimensions
      ?? (KNOWN_DIMENSIONS[selectedModel] ?? WEB_LLM_EMBEDDER_DEFAULTS.dimensions);

    super('web-llm', `WebLLM (${selectedModel})`, dimensions, import.meta.url, options);

    // Set the model so embed() is immediately usable.
    this.setModel(selectedModel);
  }

  /**
   * Returns the static prebuilt embedding catalog shipped with
   * `@mlc-ai/web-llm` (`prebuiltAppConfig.model_list` filtered to
   * `ModelType.embedding`). All entries are on-device embedding models — no
   * network call and no WebGPU required to enumerate them. The catalog is a
   * constant; the returned Promise always resolves immediately.
   */
  override listModels(): Promise<readonly LlmModelType[]> {
    return Promise.resolve(PREBUILT_EMBEDDING_MODELS);
  }

  /**
   * Probe true when `navigator.gpu` is present, indicating WebGPU is
   * available in the current environment. In Node (no `navigator`) this
   * returns false immediately — the cascade routes around this embedder.
   * Never throws.
   */
  override async probe(): Promise<boolean> {
    return WebLlmEmbedder.gpu() !== undefined;
  }

  /**
   * Import and validate the bundled `@mlc-ai/web-llm` npm module. Requires
   * WebGPU (`navigator.gpu`); throws `LlmError` when unavailable.
   */
  protected async loadModule(): Promise<WebLlmEmbedderModuleInterface> {
    if (WebLlmEmbedder.gpu() === undefined) {
      throw new LlmError('navigator.gpu unavailable', Classifications['MODEL_NOT_FOUND']);
    }
    const rawModule: unknown = await import('@mlc-ai/web-llm');
    return webLlmEmbedderModuleValidator.validate(rawModule);
  }

  /** Build and validate the WebLLM embedding engine for the selected model. */
  protected async spawnModel(module: WebLlmEmbedderModuleInterface): Promise<WebLlmEmbedderEngineType> {
    const rawEngine: unknown = await module.CreateMLCEngine(this.model);
    return webLlmEmbedderEngineValidator.validate(rawEngine);
  }

  /** Run the embedding against the live WebLLM engine. */
  protected async embedWith(model: WebLlmEmbedderEngineType, text: string, signal: AbortSignal): Promise<readonly number[]> {
    if (signal.aborted) {
      throw new LlmError('Embedding aborted', Classifications['TIMEOUT']);
    }

    const result = await model.embeddings.create({ 'input': [text] });
    const item = result.data[0];
    if (item === undefined || item.embedding.length === 0) {
      throw new LlmError(
        `WebLLM embed: missing or empty 'embedding' in response`,
        Classifications['SCHEMA_VIOLATION'],
      );
    }
    return item.embedding;
  }
}
