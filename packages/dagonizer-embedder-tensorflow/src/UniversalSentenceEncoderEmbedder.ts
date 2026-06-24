/**
 * UniversalSentenceEncoderEmbedder: in-browser text embedder running
 * TensorFlow.js Universal Sentence Encoder (USE) via a CDN ESM dynamic
 * import. Runs on WASM and WebGL; no WebGPU required.
 *
 * The USE library is loaded once via a CDN ESM URL (`esm.run`), which
 * pulls the tfjs runtime dependency transitively. No npm dependency on
 * the foreign library is needed — the module boundary is crossed at
 * runtime and narrowed via JSON Schema 2020-12 validators.
 *
 * USE produces 512-dimensional vectors for any input text. A single
 * default model (`'universal-sentence-encoder'`) is available; no model
 * enumeration or remote discovery is required.
 *
 * Usage:
 *   const embedder = new UniversalSentenceEncoderEmbedder();
 *   await embedder.connect();          // lazy-loads the CDN model
 *   const vector = await embedder.embed('the cat sat on the mat');
 *   // vector.length === embedder.dimensions === 512
 *
 * Probe: returns `true` unconditionally — USE runs on WASM/WebGL on every
 * modern browser and Node.js with @tensorflow/tfjs-node, so no hardware
 * gate is required.
 */

import { BaseEmbedder, Classifications, LlmError, ModelCost } from '@studnicky/dagonizer/adapter';
import type { BaseEmbedderOptionsType } from '@studnicky/dagonizer/adapter';
import type { LlmModelType } from '@studnicky/dagonizer/entities';

import {
  TFJS_USE_ESM,
  tfjsUseModelValidator,
  tfjsUseModuleValidator,
} from './UniversalSentenceEncoderHost.js';
import type { TfjsUseModelInterface } from './UniversalSentenceEncoderHost.js';

/** Output dimensionality of the Universal Sentence Encoder. */
const DEFAULT_DIMENSIONS = 512;

/**
 * Known model → output dimensionality. USE has a single default model;
 * future variants may surface here.
 */
const KNOWN_DIMENSIONS: Readonly<Record<string, number>> = {
  'universal-sentence-encoder': 512,
};

/**
 * Module-level defaults; the producer fills them so the consumer never
 * sees absence. `model` is fixed to the sole USE model name; `dimensions`
 * is the USE output dimensionality.
 */
const UNIVERSAL_SENTENCE_ENCODER_DEFAULTS = {
  'model': 'universal-sentence-encoder',
  'dimensions': DEFAULT_DIMENSIONS,
} as const;

export class UniversalSentenceEncoderEmbedder extends BaseEmbedder {
  /** Memoized loaded USE model; null until `connect()` resolves. */
  #model: TfjsUseModelInterface | null;
  /** In-flight boot promise to prevent concurrent `load()` calls. */
  #bootPromise: Promise<TfjsUseModelInterface> | null;

  /**
   * Constructor: `(options?)`. All configuration lives in `options`.
   * `options.model` selects the model name (default: `'universal-sentence-encoder'`);
   * `options.dimensions` overrides the output dimensionality (default: 512).
   *
   * Usage: `new UniversalSentenceEncoderEmbedder()`
   */
  constructor(options: BaseEmbedderOptionsType = {}) {
    const selectedModel = options.model ?? UNIVERSAL_SENTENCE_ENCODER_DEFAULTS.model;
    const dimensions = options.dimensions
      ?? (KNOWN_DIMENSIONS[selectedModel] ?? DEFAULT_DIMENSIONS);

    super('tensorflow', `TensorFlow.js USE (${selectedModel})`, dimensions, options);
    this.#model = null;
    this.#bootPromise = null;

    this.setModel(selectedModel);
  }

  /**
   * Lazy-load the CDN ESM module and invoke `load()` to initialise the
   * USE model. Memoizes the result so subsequent calls return immediately.
   * Validates both the imported module and the loaded model shapes via
   * compiled JSON Schema validators before use.
   *
   * Overrides `BaseAdapterCore.connect()`.
   */
  override async connect(): Promise<void> {
    if (this.#model !== null) return;
    if (this.#bootPromise !== null) {
      await this.#bootPromise;
      return;
    }
    this.#bootPromise = this.#boot();
    this.#model = await this.#bootPromise;
    this.#bootPromise = null;
  }

  async #boot(): Promise<TfjsUseModelInterface> {
    const rawModule: unknown = await import(/* @vite-ignore */ TFJS_USE_ESM);
    const mod = tfjsUseModuleValidator.validate(rawModule);
    const rawModel: unknown = await mod.load();
    return tfjsUseModelValidator.validate(rawModel);
  }

  /**
   * Disconnect clears the memoized model so the next `connect()` call
   * reloads the CDN module. Overrides `BaseAdapterCore.disconnect()`.
   */
  override async disconnect(): Promise<void> {
    this.#model = null;
    this.#bootPromise = null;
  }

  /**
   * Probe: USE runs on WASM and WebGL everywhere — no WebGPU hardware
   * gate is required. Returns `true` unconditionally.
   */
  override async probe(): Promise<boolean> {
    return true;
  }

  /**
   * Embed `text` by calling the memoized USE model. Ensures `connect()`
   * has run, calls `model.embed([text])`, extracts the first row of the
   * returned Tensor2D, and disposes the tensor to free GPU/WASM memory.
   */
  protected override async performEmbed(text: string, _signal: AbortSignal): Promise<readonly number[]> {
    await this.connect();
    if (this.#model === null) {
      throw new LlmError(
        'UniversalSentenceEncoderEmbedder: model not loaded',
        Classifications['MODEL_NOT_FOUND'],
      );
    }
    const tensor = await this.#model.embed([text]);
    try {
      const arrays = await tensor.array();
      if (arrays.length === 0 || arrays[0] === undefined || arrays[0].length === 0) {
        throw new LlmError(
          'UniversalSentenceEncoderEmbedder: embed returned empty tensor',
          Classifications['SCHEMA_VIOLATION'],
        );
      }
      return arrays[0];
    } finally {
      tensor.dispose();
    }
  }

  /**
   * Returns a single model descriptor for the Universal Sentence Encoder.
   * USE is browser-local (non-cloud) with a fixed cost rank derived from
   * the model name.
   */
  override async listModels(): Promise<readonly LlmModelType[]> {
    return [
      {
        'name': this.model,
        'variant': 'embedding',
        'cloud': false,
        'costRank': ModelCost.rankFromName(this.model),
      },
    ];
  }
}
