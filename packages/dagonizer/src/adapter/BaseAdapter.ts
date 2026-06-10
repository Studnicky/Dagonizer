/**
 * BaseAdapter: abstract base every concrete LLM adapter extends.
 *
 * Extends `AdapterBase` for shared lifecycle (retry policy,
 * `connect`/`disconnect`/`probe`, `classify`) and adds only what is
 * unique to the LLM surface: `capabilities` and the `chat()` envelope
 * that calls the abstract `performChat()`.
 *
 *   LlmAdapter contract → BaseAdapter ┐
 *                                     ├─ chat() → retry-wrapped performChat()
 *                                     └─ classify(err) returns retryable/non-retryable
 *
 * The retry wrapper rethrows non-retryable errors immediately and
 * loops with exponential backoff for retryable ones (NETWORK, TIMEOUT,
 * QUOTA_EXHAUSTED). Honors `Retry-After` hints if the adapter surfaces
 * them through the `retryAfterMs` field on the classification.
 *
 * For QUOTA_EXHAUSTED: nocturne caps the wait at 10s and gives one
 * extra attempt; mirrored here via `MAX_QUOTA_WAIT_MS`.
 */

import type { LlmAdapter } from '../contracts/LlmAdapter.js';

import { AdapterBase, type AdapterBaseOptions } from './AdapterBase.js';
import type { AdapterCapabilities, ChatRequest, ChatResponse } from './LlmAdapter.js';
import { LlmError, MAX_QUOTA_WAIT_MS } from './LlmError.js';

export abstract class BaseAdapter extends AdapterBase implements LlmAdapter {
  readonly capabilities: AdapterCapabilities;

  /**
   * Returns a fully-resolved options object with every field set to its
   * canonical default. Subclasses that receive a partial `options` from
   * their own callers spread this as a base so the object handed to
   * `super()` is always complete:
   *
   *   super(id, name, caps, { ...BaseAdapter.defaultOptions(), ...options });
   */
  static override defaultOptions() {
    return AdapterBase.defaultOptions();
  }

  protected constructor(
    id: string,
    displayName: string,
    capabilities: AdapterCapabilities,
    options: AdapterBaseOptions = {},
  ) {
    super(id, displayName, options);
    this.capabilities = capabilities;
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    return this.retryPolicy.run(async () => {
      try {
        return await this.performChat(request);
      } catch (rawError) {
        const classification = this.classify(rawError);
        // QUOTA_EXHAUSTED: honor retry-after hint only when short; else give up
        // immediately (matches nocturne's `extractWithSchema.ts:26–27`).
        if (
          classification.reason === 'QUOTA_EXHAUSTED'
          && classification.retryable
          && classification.retryAfterMs !== null
          && classification.retryAfterMs > MAX_QUOTA_WAIT_MS
        ) {
          throw new LlmError(
            `quota exhausted; retry-after ${String(classification.retryAfterMs)}ms exceeds ${String(MAX_QUOTA_WAIT_MS)}ms cap`,
            { ...classification, 'retryable': false },
            { 'cause': rawError },
          );
        }
        // Rethrow as LlmError; RetryableErrorPolicy retries only when the
        // classification is retryable.
        throw new LlmError(LlmError.messageFrom(rawError), classification, { 'cause': rawError });
      }
    }, { 'signal': request.signal });
  }

  /** Concrete adapter: perform the actual API call. */
  protected abstract performChat(request: ChatRequest): Promise<ChatResponse>;
}
