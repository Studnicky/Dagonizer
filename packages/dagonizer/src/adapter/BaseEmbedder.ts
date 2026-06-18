/**
 * BaseEmbedder: abstract base every concrete embedder extends.
 *
 * Extends `BaseAdapterCore` for shared lifecycle (retry policy,
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
import { SignalComposer } from '../runtime/SignalComposer.js';

import { BaseAdapterCore, type BaseAdapterCoreOptions } from './BaseAdapterCore.js';
import { LlmError, MAX_QUOTA_WAIT_MS } from './LlmError.js';

export abstract class BaseEmbedder extends BaseAdapterCore implements Embedder {
  readonly dimensions: number;

  protected constructor(
    id: string,
    displayName: string,
    dimensions: number,
    options: BaseAdapterCoreOptions = {},
  ) {
    super(id, displayName, options);
    this.dimensions = dimensions;
  }

  async embed(text: string, options?: AbortableOptionsInterface): Promise<readonly number[]> {
    const signal = options?.signal ?? SignalComposer.never();
    return this.retryPolicy.run(async () => {
      try {
        return await this.performEmbed(text, signal);
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
    }, { signal });
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

  /**
   * Fetch a JSON body at the embedder's HTTP boundary. Wraps `fetch`,
   * re-throwing a `fetch()` rejection as a NETWORK-classified `LlmError`,
   * classifying a non-ok response via `LlmError.classifyHttp`, and
   * returning the parsed body typed `unknown`. The caller validates the
   * `unknown` against its own provider schema before typed access — this
   * method never casts the body to a wire type. `signal` is threaded
   * explicitly into `fetch` so caller aborts propagate.
   */
  protected async fetchJson(url: string, init: RequestInit, signal: AbortSignal): Promise<unknown> {
    let res: Response;
    try {
      res = await fetch(url, { ...init, signal });
    } catch (err) {
      throw LlmError.fromNetworkError(err);
    }
    if (!res.ok) {
      const text = await res.text();
      throw new LlmError(`${this.displayName} ${String(res.status)}: ${text}`, LlmError.classifyHttp(res.status, { 'body': text }));
    }
    const body: unknown = await res.json();
    return body;
  }

  /** Concrete embedder: perform the actual API call. `signal` is always a valid AbortSignal. */
  protected abstract performEmbed(text: string, signal: AbortSignal): Promise<readonly number[]>;
}
