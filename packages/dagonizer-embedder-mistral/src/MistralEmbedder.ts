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

import { BaseEmbedder, Classifications, LlmError } from '@noocodex/dagonizer/adapter';
import type { BaseAdapterCoreOptions } from '@noocodex/dagonizer/adapter';
import type { AbortableOptionsInterface } from '@noocodex/dagonizer/contracts';

const DEFAULT_MODEL = 'mistral-embed';
const DEFAULT_DIMENSIONS = 1024;
const ENDPOINT = 'https://api.mistral.ai/v1/embeddings';

export interface MistralEmbedderOptions extends BaseAdapterCoreOptions {
  /** Override the embedding model. Defaults to `mistral-embed`. */
  readonly model?: string;
  /** Override dimensions when targeting a non-`mistral-embed` model. */
  readonly dimensions?: number;
}

interface MistralEmbedResponse {
  readonly data: ReadonlyArray<{ readonly embedding: readonly number[] }>;
}

function isMistralEmbedResponse(v: unknown): v is MistralEmbedResponse {
  if (typeof v !== 'object' || v === null) return false;
  const obj = v as Record<string, unknown>;
  if (!Array.isArray(obj['data']) || obj['data'].length === 0) return false;
  const first: unknown = obj['data'][0];
  if (typeof first !== 'object' || first === null) return false;
  return Array.isArray((first as Record<string, unknown>)['embedding']);
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
    const model = options.model ?? DEFAULT_MODEL;
    const dimensions = options.dimensions ?? DEFAULT_DIMENSIONS;
    super('mistral', `Mistral (${model})`, dimensions, options);
    this.#apiKey = apiKey;
    this.#model = model;
  }

  protected async performEmbed(text: string, signal: AbortSignal): Promise<readonly number[]> {
    let res: Response;
    try {
      res = await fetch(ENDPOINT, {
        'method': 'POST',
        'headers': {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.#apiKey}`,
        },
        'body': JSON.stringify({ 'model': this.#model, 'input': [text] }),
        signal,
      });
    } catch (err) {
      throw new LlmError(
        `Mistral embed network error: ${err instanceof Error ? err.message : String(err)}`,
        Classifications['NETWORK'],
        { 'cause': err },
      );
    }

    if (!res.ok) {
      const body = await res.text();
      throw new LlmError(
        `Mistral embed failed: ${String(res.status)} ${body}`,
        LlmError.classifyHttp(res.status, { 'body': body }),
      );
    }

    const raw: unknown = await res.json();
    if (!isMistralEmbedResponse(raw)) {
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
