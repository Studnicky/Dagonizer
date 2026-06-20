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
 * `options.model` is optional. When omitted, call `selectEmbeddingModel()`
 * after construction to discover and pick an available model via
 * `GET /v1/models`.
 *
 * Probe: returns true iff a non-empty API key was supplied. Same
 * shape `MistralApiAdapter` ships.
 */

import { BaseEmbedder, Classifications, LlmError } from '@studnicky/dagonizer/adapter';
import type { BaseEmbedderOptionsType } from '@studnicky/dagonizer/adapter';
import type { AbortableOptionsType } from '@studnicky/dagonizer/contracts';
import type { LlmModelType } from '@studnicky/dagonizer/entities';
import { Validator } from '@studnicky/dagonizer/validation';

import { MistralEmbedResponseValidator } from './MistralEmbedResponse.js';

const BASE_URL = 'https://api.mistral.ai/v1';
const ENDPOINT = `${BASE_URL}/embeddings`;
const MODELS_ENDPOINT = `${BASE_URL}/models`;
const DISCOVERY_TIMEOUT_MS = 3000;

/** Module-level defaults; the producer fills them so the consumer never sees absence. */
const MISTRAL_EMBEDDER_DEFAULTS = {
  'model': 'mistral-embed',
  'dimensions': 1024,
} as const;

/**
 * Constructor options for `MistralEmbedder`. Inherits `model?`/`dimensions?`
 * from `BaseEmbedderOptions`; the provider default (`mistral-embed`, 1024-dim)
 * is supplied by `MISTRAL_EMBEDDER_DEFAULTS`.
 *
 * `model` is optional. When omitted, call `selectEmbeddingModel()` to discover
 * an available embedding model via the Mistral `/v1/models` endpoint.
 */
export type MistralEmbedderOptionsType = BaseEmbedderOptionsType;

export class MistralEmbedder extends BaseEmbedder {
  readonly #apiKey: string;

  /**
   * Constructor: `(apiKey, options?)`. `apiKey` is required positional.
   * Empty string is accepted so the embedder can still be constructed
   * and its `probe()` can return false, letting the cascade route
   * around it cleanly.
   *
   * `options.model` is optional. When supplied, `embed()` is immediately
   * usable with the named model. When omitted, call `selectEmbeddingModel()`
   * first to discover and set an available embedding model.
   */
  constructor(apiKey: string, options: MistralEmbedderOptionsType = {}) {
    const selectedModel = options.model ?? MISTRAL_EMBEDDER_DEFAULTS.model;
    const dimensions    = options.dimensions ?? MISTRAL_EMBEDDER_DEFAULTS.dimensions;
    super('mistral', `Mistral (${selectedModel})`, dimensions, options);
    this.#apiKey = apiKey;
    this.setModel(selectedModel);
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
        'body': JSON.stringify({ 'model': this.model, 'input': [text] }),
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
  override async probe(_options?: AbortableOptionsType): Promise<boolean> {
    return Promise.resolve(this.#apiKey.length > 0);
  }

  /**
   * Enumerate models available from the Mistral la Plateforme `GET /v1/models`
   * endpoint. Uses a short discovery timeout composed with any caller-supplied
   * signal. Requires a non-empty `apiKey` (the endpoint is authenticated).
   *
   * Each model id is classified:
   *   - `'embedding'` when the lowercased id contains `'embed'`.
   *   - `'chat'` otherwise.
   *
   * `cloud` is always `true` — Mistral la Plateforme is a cloud service.
   *
   * Returns `[]` on any transport failure, authentication failure, or
   * validation error — never throws.
   */
  override async listModels(options?: { readonly signal?: AbortSignal }): Promise<readonly LlmModelType[]> {
    if (this.#apiKey.length === 0) {
      return [];
    }
    const controller = new AbortController();
    const timer = setTimeout(() => { controller.abort(); }, DISCOVERY_TIMEOUT_MS);
    if (options?.signal !== undefined) {
      options.signal.addEventListener('abort', () => { controller.abort(); }, { 'once': true });
    }
    try {
      const res = await fetch(MODELS_ENDPOINT, {
        'method': 'GET',
        'headers': {
          'Authorization': `Bearer ${this.#apiKey}`,
        },
        'signal': controller.signal,
      });
      if (!res.ok) {
        return [];
      }
      const body: unknown = await res.json() as unknown;
      if (!Validator.openAiModelsResponse.is(body)) {
        return [];
      }
      return body.data.map((entry): LlmModelType => {
        const lower = entry.id.toLowerCase();
        const isEmbedding = lower.includes('embed');
        return {
          'name': entry.id,
          'variant': isEmbedding ? 'embedding' : 'chat',
          'cloud': true,
        };
      });
    } catch {
      return [];
    } finally {
      clearTimeout(timer);
    }
  }
}
