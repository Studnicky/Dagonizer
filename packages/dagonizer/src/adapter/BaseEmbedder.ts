/**
 * BaseEmbedder: abstract base every concrete embedder extends.
 *
 * Extends `AdapterBase` for shared lifecycle (retry policy,
 * `connect`/`disconnect`/`probe`, `classify`) and adds only what is
 * unique to the embedding surface: `dimensions` and the `embed()` /
 * `embedBatch()` envelope that calls the abstract `performEmbed()`.
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

import type { AbortableOptionsInterface } from '../contracts/AbortableOptionsInterface.js';
import type { Embedder } from '../contracts/Embedder.js';

import { AdapterBase, type AdapterBaseOptions } from './AdapterBase.js';
import { LlmError, MAX_QUOTA_WAIT_MS } from './LlmError.js';

export abstract class BaseEmbedder extends AdapterBase implements Embedder {
  readonly dimensions: number;

  protected constructor(
    id: string,
    displayName: string,
    dimensions: number,
    options: AdapterBaseOptions = {},
  ) {
    super(id, displayName, options);
    this.dimensions = dimensions;
  }

  async embed(text: string, options?: AbortableOptionsInterface): Promise<readonly number[]> {
    const signal = options?.signal;
    const runOptions = signal !== undefined ? { signal } : {};
    return this.retryPolicy.run(async () => {
      try {
        return await this.performEmbed(text, signal ?? BaseEmbedder.#neverAbortingSignal());
      } catch (rawError) {
        // Already classified by performEmbed; don't double-wrap. Apply the
        // quota cap, then rethrow as-is.
        if (rawError instanceof LlmError) {
          const c = rawError.classification;
          if (c.reason === 'QUOTA_EXHAUSTED' && c.retryable && c.retryAfterMs !== null && c.retryAfterMs > MAX_QUOTA_WAIT_MS) {
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
  async embedBatch(texts: readonly string[], options?: AbortableOptionsInterface): Promise<readonly (readonly number[])[]> {
    const results: (readonly number[])[] = [];
    for (const t of texts) {
      results.push(await this.embed(t, options));
    }
    return results;
  }

  /** Concrete embedder: perform the actual API call. `signal` is always a valid AbortSignal. */
  protected abstract performEmbed(text: string, signal: AbortSignal): Promise<readonly number[]>;

  /** A signal that never fires; materialised once per call so each call site
   *  always receives an AbortSignal without allocating a persistent controller. */
  static #neverAbortingSignal(): AbortSignal {
    return new AbortController().signal;
  }
}
