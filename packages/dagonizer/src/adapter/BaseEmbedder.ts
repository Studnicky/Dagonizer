/**
 * BaseEmbedder: abstract base every concrete embedder extends.
 *
 * Owns the retry plumbing (Dagonizer's `RetryPolicy` with exponential
 * backoff) and the embed-call envelope. Concrete embedders implement
 * `performEmbed()` (the raw transport call) and may override
 * `classify()` to map a provider-native error into the shared
 * `LlmError` taxonomy.
 *
 *   Embedder contract → BaseEmbedder ┐
 *                                    ├─ embed() → retry-wrapped performEmbed()
 *                                    └─ classify(err) returns retryable/non-retryable
 *
 * The retry wrapper rethrows non-retryable errors immediately and
 * loops with exponential backoff for retryable ones (NETWORK, TIMEOUT,
 * QUOTA_EXHAUSTED). Default `embedBatch()` calls `embed()` in series;
 * adapters with native batch endpoints override.
 *
 * Mirrors `BaseAdapter` symbol-for-symbol so the cascade plumbing and
 * the error taxonomy stay shared across the two surfaces.
 */

import type { Embedder } from '../contracts/Embedder.js';
import { BackoffStrategy } from '../runtime/index.js';

import { Classifications, LlmError, MAX_QUOTA_WAIT_MS, type ErrorClassification } from './LlmError.js';
import { RetryableErrorPolicy } from './RetryableErrorPolicy.js';

export const DEFAULT_EMBEDDER_MAX_ATTEMPTS = 3;
export const DEFAULT_EMBEDDER_BASE_DELAY_MS = 400;

export interface BaseEmbedderOptions {
  readonly maxAttempts?: number;
  readonly baseDelayMs?: number;
}

export abstract class BaseEmbedder implements Embedder {
  readonly id: string;
  readonly displayName: string;
  readonly dimensions: number;
  readonly #retry: RetryableErrorPolicy;

  protected constructor(
    id: string,
    displayName: string,
    dimensions: number,
    options: BaseEmbedderOptions = {},
  ) {
    this.id = id;
    this.displayName = displayName;
    this.dimensions = dimensions;
    this.#retry = new RetryableErrorPolicy({
      'maxAttempts': options.maxAttempts ?? DEFAULT_EMBEDDER_MAX_ATTEMPTS,
      'strategy':    BackoffStrategy.EXPONENTIAL,
      'baseDelay':   options.baseDelayMs ?? DEFAULT_EMBEDDER_BASE_DELAY_MS,
    });
  }

  /** No-op default. Subclasses with a session lifecycle override. */
  async connect(): Promise<void> {
    return Promise.resolve();
  }

  /** No-op default. Subclasses with a session lifecycle override. */
  async disconnect(): Promise<void> {
    return Promise.resolve();
  }

  /**
   * Default availability probe. Returns true; the embedder assumes it
   * can run unless the concrete subclass knows better. Subclasses with
   * meaningful availability constraints (API key presence, runtime
   * feature detect, local model warmth) override and surface their own
   * check. Must never throw; return false instead.
   */
  async probe(): Promise<boolean> {
    return Promise.resolve(true);
  }

  async embed(text: string, options?: { signal?: AbortSignal }): Promise<readonly number[]> {
    const runOptions = options?.signal !== undefined ? { 'signal': options.signal } : {};
    return this.#retry.run(async () => {
      try {
        return await this.performEmbed(text);
      } catch (rawError) {
        // Already classified by performEmbed; don't double-wrap. Apply the
        // quota cap, then rethrow as-is.
        if (rawError instanceof LlmError) {
          const c = rawError.classification;
          if (c.reason === 'QUOTA_EXHAUSTED' && c.retryAfterMs !== undefined && c.retryAfterMs > MAX_QUOTA_WAIT_MS) {
            throw new LlmError(
              `quota exhausted; retry-after ${String(c.retryAfterMs)}ms exceeds ${String(MAX_QUOTA_WAIT_MS)}ms cap`,
              { ...c, 'retryable': false },
              { 'cause': rawError },
            );
          }
          throw rawError;
        }
        throw new LlmError(LlmError.messageFrom(rawError), this.classify(rawError), { 'cause': rawError });
      }
    }, runOptions);
  }

  /**
   * Default batch implementation: serial iteration over `embed()`. Adapters whose
   * provider exposes a native batch endpoint override and post one
   * request for the whole batch.
   */
  async embedBatch(texts: readonly string[], options?: { signal?: AbortSignal }): Promise<readonly (readonly number[])[]> {
    const results: (readonly number[])[] = [];
    for (const t of texts) {
      results.push(await this.embed(t, options));
    }
    return results;
  }

  /** Concrete embedder: perform the actual API call. */
  protected abstract performEmbed(text: string): Promise<readonly number[]>;

  /** Map a provider-native error into the shared classification. */
  protected classify(error: unknown): ErrorClassification {
    if (error instanceof LlmError) return error.classification;
    return Classifications['UNKNOWN'];
  }
}

