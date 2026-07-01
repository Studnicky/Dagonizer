/**
 * UniversalSentenceEncoderEmbedder: in-browser text embedder running
 * TensorFlow.js Universal Sentence Encoder (USE) via a bundled npm
 * dependency. Runs on WASM and WebGL; no WebGPU required.
 *
 * The USE library is loaded once via a dynamic `import()` of the bundled
 * `@tensorflow-models/universal-sentence-encoder` npm package, with
 * `@tensorflow/tfjs` as an explicit peer dependency. The module boundary
 * is crossed at runtime and narrowed via JSON Schema 2020-12 validators.
 *
 * USE produces 512-dimensional vectors for any input text. A single
 * default model (`'universal-sentence-encoder'`) is available; no model
 * enumeration or remote discovery is required.
 *
 * Usage:
 *   const embedder = new UniversalSentenceEncoderEmbedder();
 *   await embedder.connect();          // lazy-loads the bundled model
 *   const vector = await embedder.embed('the cat sat on the mat');
 *   // vector.length === embedder.dimensions === 512
 *
 * Probe: returns `true` unconditionally — USE runs on WASM/WebGL on every
 * modern browser and Node.js with @tensorflow/tfjs-node, so no hardware
 * gate is required.
 */

import { Classifications, LlmError, LocalModelEmbedder, ModelCost } from '@studnicky/dagonizer/adapter';
import type { BaseEmbedderOptionsType } from '@studnicky/dagonizer/adapter';
import type { LlmModelType } from '@studnicky/dagonizer/entities';

import {
  tfjsUseModelValidator,
  tfjsUseModuleValidator,
} from './UniversalSentenceEncoderHost.js';
import type { TfjsUseModelInterface, TfjsUseModuleInterface } from './UniversalSentenceEncoderHost.js';

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

export class UniversalSentenceEncoderEmbedder extends LocalModelEmbedder<TfjsUseModuleInterface, TfjsUseModelInterface> {
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

    super('tensorflow', `TensorFlow.js USE (${selectedModel})`, dimensions, import.meta.url, options);

    this.setModel(selectedModel);
  }

  /**
   * Import and validate the bundled USE module. NO CDN — bundled npm
   * import of `@tensorflow-models/universal-sentence-encoder`.
   */
  protected async loadModule(): Promise<TfjsUseModuleInterface> {
    const raw: unknown = await import('@tensorflow-models/universal-sentence-encoder');
    return tfjsUseModuleValidator.validate(raw);
  }

  /**
   * Invoke `load()` on the imported module to initialise the USE model,
   * then validate the loaded model shape via the compiled JSON Schema
   * validator before use.
   */
  protected async spawnModel(module: TfjsUseModuleInterface): Promise<TfjsUseModelInterface> {
    const rawModel: unknown = await module.load();
    return tfjsUseModelValidator.validate(rawModel);
  }

  /**
   * Probe: USE runs on WASM and WebGL everywhere — no WebGPU hardware
   * gate is required. Returns `true` unconditionally.
   */
  override async probe(): Promise<boolean> {
    return true;
  }

  /**
   * Embed `text` by calling the built USE model. Calls `model.embed([text])`,
   * extracts the first row of the returned Tensor2D, and disposes the
   * tensor to free GPU/WASM memory.
   */
  protected async embedWith(model: TfjsUseModelInterface, text: string): Promise<readonly number[]> {
    const tensor = await model.embed([text]);
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
