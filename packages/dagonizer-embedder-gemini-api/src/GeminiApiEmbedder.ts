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
 *
 * Discovery: `listModels()` queries `GET /v1beta/models` with a 3 s timeout,
 * strips the `models/` name prefix, and maps each entry to the appropriate
 * `LlmModelType` variant (`embedding` / `chat` / `unknown`). Never throws.
 */

import { BaseEmbedder, Classifications, LlmError, ModelCost } from '@studnicky/dagonizer/adapter';
import type { BaseEmbedderOptionsType } from '@studnicky/dagonizer/adapter';
import type { AbortableOptionsType } from '@studnicky/dagonizer/contracts';
import type { LlmModelType } from '@studnicky/dagonizer/entities';

import { GeminiApiEmbedResponseValidator } from './GeminiApiEmbedResponse.js';
import { GeminiModelsResponseValidator } from './GeminiModelsResponse.js';

const EMBED_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const MODELS_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const LIST_MODELS_TIMEOUT_MS = 3000;
const MODELS_NAME_PREFIX = 'models/';

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

  /**
   * Constructor: `(apiKey, options?)`. `apiKey` is required positional;
   * Gemini's REST surface refuses every call without it. An empty
   * string is accepted so the embedder can still be constructed and
   * its `probe()` can return false, letting the cascade route around
   * it cleanly.
   */
  constructor(apiKey: string, options: GeminiApiEmbedderOptionsType = {}) {
    const resolved = { ...GEMINI_API_EMBEDDER_DEFAULTS, ...options };
    super('gemini-api', `Gemini REST (${resolved.model})`, resolved.dimensions, { ...options, 'model': resolved.model });
    this.#apiKey = apiKey;
  }

  protected async performEmbed(text: string, signal: AbortSignal): Promise<readonly number[]> {
    const url = `${EMBED_ENDPOINT}/${encodeURIComponent(this.model)}:embedContent?key=${encodeURIComponent(this.#apiKey)}`;
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
  override async probe(): Promise<boolean> {
    return Promise.resolve(this.#apiKey.length > 0);
  }

  /**
   * Discover models by querying `GET /v1beta/models`. Uses a 3 s discovery
   * timeout composed with any caller-supplied abort signal. Strips the
   * `models/` prefix from each entry name, then assigns variant:
   *   - `'embedding'` when `supportedGenerationMethods` includes `'embedContent'`
   *   - `'chat'`      when `supportedGenerationMethods` includes `'generateContent'`
   *   - `'unknown'`   otherwise
   *
   * Returns `[]` on any fetch error, non-ok response, or schema mismatch.
   * Never throws.
   */
  override async listModels(options?: AbortableOptionsType): Promise<readonly LlmModelType[]> {
    const controller = new AbortController();
    const timer = setTimeout(() => { controller.abort(); }, LIST_MODELS_TIMEOUT_MS);

    const signals: AbortSignal[] = [controller.signal];
    if (options?.signal !== undefined) {
      signals.push(options.signal);
    }
    const composed = AbortSignal.any(signals);

    try {
      const url = `${MODELS_ENDPOINT}?key=${encodeURIComponent(this.#apiKey)}`;
      let res: Response;
      try {
        res = await fetch(url, { 'signal': composed });
      } catch {
        return [];
      }
      if (!res.ok) return [];

      const body: unknown = await res.json();
      if (!GeminiModelsResponseValidator.is(body)) return [];

      return body.models.map((entry): LlmModelType => {
        const name = entry.name.startsWith(MODELS_NAME_PREFIX)
          ? entry.name.slice(MODELS_NAME_PREFIX.length)
          : entry.name;

        const methods = entry.supportedGenerationMethods ?? [];
        let variant: LlmModelType['variant'];
        if (methods.includes('embedContent')) {
          variant = 'embedding';
        } else if (methods.includes('generateContent')) {
          variant = 'chat';
        } else {
          variant = 'unknown';
        }

        return { name, variant, 'cloud': true, 'costRank': ModelCost.rankFromName(name) };
      });
    } finally {
      clearTimeout(timer);
    }
  }
}
