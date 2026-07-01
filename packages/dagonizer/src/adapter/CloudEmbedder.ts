/**
 * CloudEmbedder: abstract intermediate base for cloud-hosted embedders.
 *
 * Centralizes the request/parse envelope every cloud embedder duplicates:
 * POST the text to the provider's embeddings endpoint via `fetchJson`
 * (inherited from `BaseEmbedder`), then validate and extract the vector
 * from the parsed response body.
 *
 *   BaseEmbedder ─── CloudEmbedder
 *                       └─ performEmbed() → fetchJson(endpoint(), requestInit(text), signal) → vectorFrom(raw)
 *
 * Concrete subclasses implement only `endpoint()` (the full request URL),
 * `requestInit()` (method, headers incl. auth, body), and `vectorFrom()`
 * (validate the parsed body against the leaf's own schema validator and
 * extract the embedding vector). The POST + parse envelope lives here
 * once, matching how `OpenAiCompatibleAdapter` centralizes cloud chat
 * adapters under `BaseAdapter`.
 */

import { BaseEmbedder } from './BaseEmbedder.js';

export abstract class CloudEmbedder extends BaseEmbedder {
  protected async performEmbed(text: string, signal: AbortSignal): Promise<readonly number[]> {
    const raw = await this.fetchJson(this.endpoint(), this.requestInit(text), signal);
    return this.vectorFrom(raw);
  }

  /** Full request URL for the embeddings POST (may embed model/apiKey as path or query params). */
  protected abstract endpoint(): string;
  /** Build the `fetch` RequestInit (method, headers incl. auth, body) for embedding `text`. */
  protected abstract requestInit(text: string): RequestInit;
  /** Validate the parsed response body against the leaf's own schema validator and extract the embedding vector. Throws `LlmError` (SCHEMA_VIOLATION) on an invalid or empty vector — never casts. */
  protected abstract vectorFrom(body: unknown): readonly number[];
}
