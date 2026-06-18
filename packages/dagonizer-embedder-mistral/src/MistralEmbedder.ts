/**
 * MistralEmbedder: Mistral la Plateforme embeddings adapter.
 *
 * Wire format:
 *
 *   POST https://api.mistral.ai/v1/embeddings
 *   Authorization: Bearer <apiKey>
 *   { "model": "mistral-embed", "input": ["<text>"] }
 *
 *   → { "data": [ { "embedding": number[] } ] }
 *
 * Default model: `mistral-embed` (1024-dim vectors). Mistral's embedding
 * surface is batch-native: `input` is always an array. The default
 * `embedBatch` implementation in `BaseEmbedder` issues one HTTP call per
 * text; consumers wanting peak throughput can override it. The cost
 * difference is small for the intent-classifier corpus (≤ 10 short texts
 * at startup).
 *
 * Probe: returns true iff a non-empty API key was supplied. Same
 * shape `MistralApiAdapter` ships.
 */

import { BaseEmbedder, Classifications, LlmError } from '@studnicky/dagonizer/adapter';
import type { BaseAdapterCoreOptions } from '@studnicky/dagonizer/adapter';
import type { AbortableOptionsInterface } from '@studnicky/dagonizer/contracts';

import { MistralEmbedResponseValidator } from './MistralEmbedResponse.js';

const ENDPOINT = 'https://api.mistral.ai/v1/embeddings';

/** Module-level defaults; the producer fills them so the consumer never sees absence. */
const MISTRAL_EMBEDDER_DEFAULTS = {
  'model': 'mistral-embed',
  'dimensions': 1024,
} as const;

export interface MistralEmbedderOptions extends BaseAdapterCoreOptions {
  /** Override the embedding model. Defaults to `mistral-embed`. */
  readonly model?: string;
  /** Override dimensions when targeting a non-`mistral-embed` model. */
  readonly dimensions?: number;
}

export class MistralEmbedder extends BaseEmbedder {
  readonly #apiKey: string;
  readonly #model: string;

  /**
   * Constructor: `(apiKey, options?)`. `apiKey` is required positional.
   * Empty string is accepted so the embedder can still be constructed
   * and its `probe()` can return false, letting the cascade route
   * around it cleanly.
   */
  constructor(apiKey: string, options: MistralEmbedderOptions = {}) {
    const resolved = { ...MISTRAL_EMBEDDER_DEFAULTS, ...options };
    super('mistral', `Mistral (${resolved.model})`, resolved.dimensions, options);
    this.#apiKey = apiKey;
    this.#model = resolved.model;
  }

  protected async performEmbed(text: string, signal: AbortSignal): Promise<readonly number[]> {
    const raw = await this.fetchJson(
      ENDPOINT,
      {
        'method': 'POST',
        'headers': {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.#apiKey}`,
        },
        'body': JSON.stringify({ 'model': this.#model, 'input': [text] }),
      },
      signal,
    );
    if (!MistralEmbedResponseValidator.is(raw)) {
      throw new LlmError(
        `Mistral embed: missing or empty 'data[0].embedding' field`,
        Classifications['SCHEMA_VIOLATION'],
      );
    }
    const first = raw.data[0];
    if (first === undefined || first.embedding.length === 0) {
      throw new LlmError(
        `Mistral embed: missing or empty 'data[0].embedding' field`,
        Classifications['SCHEMA_VIOLATION'],
      );
    }
    return first.embedding;
  }

  /**
   * Probe true when a non-empty API key was supplied. Never throws.
   * Symmetric with `MistralApiAdapter.probe`.
   */
  override async probe(_options?: AbortableOptionsInterface): Promise<boolean> {
    return Promise.resolve(this.#apiKey.length > 0);
  }
}
