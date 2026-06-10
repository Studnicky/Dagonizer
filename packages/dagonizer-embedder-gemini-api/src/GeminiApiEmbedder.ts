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

import { BaseEmbedder, Classifications, LlmError } from '@noocodex/dagonizer/adapter';
import type { AdapterBaseOptions } from '@noocodex/dagonizer/adapter';
import type { AbortableOptionsInterface } from '@noocodex/dagonizer/contracts';

const DEFAULT_MODEL = 'text-embedding-004';
const DEFAULT_DIMENSIONS = 768;
const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

export interface GeminiApiEmbedderOptions extends AdapterBaseOptions {
  /** Override the embedding model. Defaults to `text-embedding-004`. */
  readonly model?: string;
  /** Override dimensions when targeting a non-`text-embedding-004` model. */
  readonly dimensions?: number;
}

interface GeminiEmbedResponse {
  readonly embedding?: { readonly values?: readonly number[] };
}

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
  constructor(apiKey: string, options: GeminiApiEmbedderOptions = {}) {
    const model = options.model ?? DEFAULT_MODEL;
    const dimensions = options.dimensions ?? DEFAULT_DIMENSIONS;
    super('gemini-api', `Gemini REST (${model})`, dimensions, options);
    this.#apiKey = apiKey;
    this.#model = model;
  }

  protected async performEmbed(text: string, signal: AbortSignal): Promise<readonly number[]> {
    const url = `${ENDPOINT}/${encodeURIComponent(this.#model)}:embedContent?key=${encodeURIComponent(this.#apiKey)}`;
    let res: Response;
    try {
      res = await fetch(url, {
        'method': 'POST',
        'headers': { 'Content-Type': 'application/json' },
        'body': JSON.stringify({ 'content': { 'parts': [{ 'text': text }] } }),
        signal,
      });
    } catch (err) {
      throw new LlmError(
        `Gemini embed network error: ${err instanceof Error ? err.message : String(err)}`,
        Classifications['NETWORK'],
        { 'cause': err },
      );
    }

    if (!res.ok) {
      const body = await res.text();
      throw new LlmError(
        `Gemini embed failed: ${String(res.status)} ${body}`,
        LlmError.classifyHttp(res.status, { 'body': body }),
      );
    }

    const payload = (await res.json()) as GeminiEmbedResponse;
    const values = payload.embedding?.values;
    if (values === undefined || values.length === 0) {
      throw new LlmError(
        `Gemini embed: missing or empty 'embedding.values' field`,
        Classifications['SCHEMA_VIOLATION'],
      );
    }
    return values;
  }

  /**
   * Probe true when a non-empty API key was supplied. Never throws.
   * Symmetric with `GeminiApiAdapter.probe`.
   */
  override async probe(_options?: AbortableOptionsInterface): Promise<boolean> {
    return Promise.resolve(this.#apiKey.length > 0);
  }
}
