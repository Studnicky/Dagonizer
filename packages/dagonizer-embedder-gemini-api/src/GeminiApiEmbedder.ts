/**
 * GeminiApiEmbedder: Google AI Studio REST adapter for text embeddings.
 *
 * Wire format:
 *
 *   POST https://generativelanguage.googleapis.com/v1beta/models/{model}:embedContent?key={apiKey}
 *   { "content": { "parts": [ { "text": "<text>" } ] } }
 *
 *   → { "embedding": { "values": number[] } }
 *
 * Default model: `text-embedding-004` (768-dim vectors). Override via
 * `options.model` to target `text-embedding-005` or future models;
 * supply `options.dimensions` when targeting a non-768 model.
 *
 * Probe: returns true iff a non-empty API key was supplied. Gemini's
 * REST surface gates every call on the `key` query parameter; an empty
 * key is a deterministic 400/403 with no useful retry path. Same probe
 * shape `GeminiApiAdapter` ships.
 */

import { BaseEmbedder, Classifications, LlmError } from '@studnicky/dagonizer/adapter';
import type { BaseEmbedderOptionsType } from '@studnicky/dagonizer/adapter';
import type { AbortableOptionsType } from '@studnicky/dagonizer/contracts';

import { GeminiApiEmbedResponseValidator } from './GeminiApiEmbedResponse.js';

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

/** Module-level defaults; the producer fills them so the consumer never sees absence. */
const GEMINI_API_EMBEDDER_DEFAULTS = {
  'model': 'text-embedding-004',
  'dimensions': 768,
} as const;

/**
 * Constructor options for `GeminiApiEmbedder`. Inherits `model?`/`dimensions?`
 * from `BaseEmbedderOptions`; the provider default (`text-embedding-004`,
 * 768-dim) is supplied by `GEMINI_API_EMBEDDER_DEFAULTS`.
 */
export type GeminiApiEmbedderOptionsType = BaseEmbedderOptionsType;

export class GeminiApiEmbedder extends BaseEmbedder {
  readonly #apiKey: string;
  readonly #model: string;

  /**
   * Constructor: `(apiKey, options?)`. `apiKey` is required positional;
   * Gemini's REST surface refuses every call without it. An empty
   * string is accepted so the embedder can still be constructed and
   * its `probe()` can return false, letting the cascade route around
   * it cleanly.
   */
  constructor(apiKey: string, options: GeminiApiEmbedderOptionsType = {}) {
    const resolved = { ...GEMINI_API_EMBEDDER_DEFAULTS, ...options };
    super('gemini-api', `Gemini REST (${resolved.model})`, resolved.dimensions, options);
    this.#apiKey = apiKey;
    this.#model = resolved.model;
  }

  protected async performEmbed(text: string, signal: AbortSignal): Promise<readonly number[]> {
    const url = `${ENDPOINT}/${encodeURIComponent(this.#model)}:embedContent?key=${encodeURIComponent(this.#apiKey)}`;
    const raw = await this.fetchJson(
      url,
      {
        'method': 'POST',
        'headers': { 'Content-Type': 'application/json' },
        'body': JSON.stringify({ 'content': { 'parts': [{ 'text': text }] } }),
      },
      signal,
    );
    if (!GeminiApiEmbedResponseValidator.is(raw) || raw.embedding.values.length === 0) {
      throw new LlmError(
        `Gemini embed: missing or empty 'embedding.values' field`,
        Classifications['SCHEMA_VIOLATION'],
      );
    }
    return raw.embedding.values;
  }

  /**
   * Probe true when a non-empty API key was supplied. Never throws.
   * Symmetric with `GeminiApiAdapter.probe`.
   */
  override async probe(_options?: AbortableOptionsType): Promise<boolean> {
    return Promise.resolve(this.#apiKey.length > 0);
  }
}
