/**
 * MistralEmbedder — Mistral la Plateforme embeddings adapter.
 *
 * Wire format:
 *
 *   POST https://api.mistral.ai/v1/embeddings
 *   Authorization: Bearer <apiKey>
 *   { "model": "mistral-embed", "input": ["<text>"] }
 *
 *   → { "data": [ { "embedding": number[] } ] }
 *
 * Default model: `mistral-embed` — 1024-dim vectors. Mistral's embedding
 * surface is batch-native: `input` is always an array. The default
 * `embedBatch` implementation in `BaseEmbedder` still works (one HTTP
 * call per text), but consumers wanting peak throughput can override —
 * left as a deliberate followup since the cost difference is small for
 * the intent-classifier corpus (≤ 10 short texts at startup).
 *
 * Probe: returns true iff a non-empty API key was supplied. Same
 * shape `MistralApiAdapter` ships.
 */

import { BaseEmbedder, Classifications, LlmError } from '@noocodex/dagonizer/adapter';
import type { BaseEmbedderOptions } from '@noocodex/dagonizer/adapter';

const DEFAULT_MODEL = 'mistral-embed';
const DEFAULT_DIMENSIONS = 1024;
const ENDPOINT = 'https://api.mistral.ai/v1/embeddings';

export interface MistralEmbedderOptions extends BaseEmbedderOptions {
  /** Override the embedding model. Defaults to `mistral-embed`. */
  readonly model?: string;
  /** Override dimensions when targeting a non-`mistral-embed` model. */
  readonly dimensions?: number;
}

interface MistralEmbedResponse {
  readonly data?: ReadonlyArray<{ readonly embedding?: readonly number[] }>;
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

  protected async performEmbed(text: string): Promise<readonly number[]> {
    let res: Response;
    try {
      res = await fetch(ENDPOINT, {
        'method': 'POST',
        'headers': {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.#apiKey}`,
        },
        'body': JSON.stringify({ 'model': this.#model, 'input': [text] }),
      });
    } catch (err) {
      throw new LlmError(
        `Mistral embed network error: ${err instanceof Error ? err.message : String(err)}`,
        Classifications['NETWORK'],
        err,
      );
    }

    if (!res.ok) {
      const body = await res.text();
      throw new LlmError(
        `Mistral embed failed: ${String(res.status)} ${body}`,
        Classifications['NETWORK'],
      );
    }

    const payload = (await res.json()) as MistralEmbedResponse;
    const first = payload.data?.[0]?.embedding;
    if (first === undefined || first.length === 0) {
      throw new LlmError(
        `Mistral embed: missing or empty 'data[0].embedding' field`,
        Classifications['SCHEMA_VIOLATION'],
      );
    }
    return first;
  }

  /**
   * Probe true when a non-empty API key was supplied. Never throws.
   * Symmetric with `MistralApiAdapter.probe`.
   */
  override async probe(): Promise<boolean> {
    return Promise.resolve(this.#apiKey.length > 0);
  }
}
