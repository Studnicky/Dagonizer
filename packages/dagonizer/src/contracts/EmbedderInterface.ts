/**
 * EmbedderInterface: produces a fixed-dimensionality vector for a text input.
 *
 * Plugin authors implement this (typically by extending `BaseEmbedder`)
 * to swap embedding backends. The dispatcher's adapter cascade pattern
 * applies: register multiple `EmbedderInterface`s, probe at runtime, pick the
 * first available. Mirrors `LlmAdapterInterface` exactly so the registry +
 * cascade plumbing is symmetric.
 *
 *   EmbedderInterface contract → BaseEmbedder ┐
 *                                    ├─ embed() → retry-wrapped performEmbed()
 *                                    └─ classify(err) returns retryable/non-retryable
 *
 * Why a separate contract from `LlmAdapterInterface`? Chat and embedding are
 * different surfaces (no message list, no tools, no structured output;
 * just text to vector). Forcing them through the same contract would
 * leak chat concerns into embedding-only providers. Keep them parallel
 * but distinct; share the retry plumbing and the error taxonomy.
 */

import type { LlmModelType } from '../entities/adapter/LlmModel.js';

import type { AbortableOptionsType } from './AbortableOptionsType.js';

/** Implemented by every embedding provider. */
export interface EmbedderInterface {
  /** Provider identifier (e.g. `'ollama'`, `'gemini-api'`). */
  readonly id: string;
  /** Human-readable label for logs and UI. */
  readonly displayName: string;
  /**
   * Output vector dimensionality. Consumers verify this matches their
   * pre-computed corpus embeddings before computing similarity; a
   * dimensionality mismatch is a configuration bug, not a runtime
   * fallback case.
   */
  readonly dimensions: number;

  /**
   * Discover the embedding models available on this provider.
   * Returns an empty array when the provider is unreachable or reports no
   * models — never throws.
   */
  listModels(options?: AbortableOptionsType): Promise<readonly LlmModelType[]>;

  /**
   * Embed a single text. Returns a `number[]` of length `dimensions`.
   * Throws `LlmError` on failure; the caller decides whether to retry
   * or fall back. Retry plumbing is provided by `BaseEmbedder`.
   * `options.signal` aborts in-flight requests and retry-loop waits.
   */
  embed(text: string, options?: AbortableOptionsType): Promise<readonly number[]>;

  /**
   * Batch convenience: embed multiple texts. Default implementation in
   * `BaseEmbedder` calls `embed()` in series; concrete adapters with
   * native batch endpoints override. Threads `options.signal` into each
   * `embed()` call so the batch aborts cleanly.
   */
  embedBatch(texts: readonly string[], options?: AbortableOptionsType): Promise<readonly (readonly number[])[]>;

  /**
   * Quick availability check. Returns true when this embedder can
   * plausibly serve an `embed()` call right now (credentials present,
   * runtime backend reachable, model available). Implementations MUST
   * NOT throw on transport failure; return false so a cascade can
   * route around the embedder and try the next preference.
   *
   * `BaseEmbedder` ships a default that returns true; concrete adapters
   * override with a real probe (e.g. credential check, HEAD request).
   */
  probe(options?: AbortableOptionsType): Promise<boolean>;

  /**
   * Bring up any per-session state (model download, websocket
   * handshake). Adapters that don't need a session implement a no-op;
   * `BaseEmbedder` provides a default empty implementation so consumers
   * don't branch on `connect` vs `undefined`.
   */
  connect(options?: AbortableOptionsType): Promise<void>;

  /** Tear down any per-session state. No-op default on `BaseEmbedder`. */
  disconnect(options?: AbortableOptionsType): Promise<void>;
}
