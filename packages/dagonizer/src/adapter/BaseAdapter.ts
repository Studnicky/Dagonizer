/**
 * BaseAdapter: abstract base every concrete adapter extends.
 *
 * Owns the retry plumbing (Dagonizer's `RetryPolicy` with exponential
 * backoff) and the chat-call envelope. Concrete adapters implement
 * `performChat()` (the raw transport call) and `classify()` which
 * maps a provider-native error into the shared `LlmError` taxonomy.
 *
 *   Adapter contract → BaseAdapter ┐
 *                                  ├─ chat() → retry-wrapped performChat()
 *                                  └─ classify(err) returns retryable/non-retryable
 *
 * The retry wrapper rethrows non-retryable errors immediately and
 * loops with exponential backoff for retryable ones (NETWORK, TIMEOUT,
 * QUOTA_EXHAUSTED). Honors `Retry-After` hints if the adapter surfaces
 * them through the `retryAfterMs` field on the classification.
 *
 * For QUOTA_EXHAUSTED: nocturne caps the wait at 10s and gives one
 * extra attempt; mirrored here via `MAX_QUOTA_WAIT_MS`.
 */


import { BackoffStrategy } from '../runtime/index.js';

import type { AdapterCapabilities, ChatRequest, ChatResponse, LlmAdapter } from './LlmAdapter.js';
import { Classifications, LlmError, MAX_QUOTA_WAIT_MS, type ErrorClassification } from './LlmError.js';
import { RetryableErrorPolicy } from './RetryableErrorPolicy.js';

export const DEFAULT_MAX_ATTEMPTS = 3;
export const DEFAULT_BASE_DELAY_MS = 400;

export interface BaseAdapterOptions {
  readonly maxAttempts?: number;
  readonly baseDelayMs?: number;
}

export abstract class BaseAdapter implements LlmAdapter {
  readonly id: string;
  readonly displayName: string;
  readonly capabilities: AdapterCapabilities;
  readonly #retry: RetryableErrorPolicy;

  protected constructor(
    id: string,
    displayName: string,
    capabilities: AdapterCapabilities,
    options: BaseAdapterOptions = {},
  ) {
    this.id = id;
    this.displayName = displayName;
    this.capabilities = capabilities;
    this.#retry = new RetryableErrorPolicy({
      'maxAttempts': options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
      'strategy':    BackoffStrategy.EXPONENTIAL,
      'baseDelay':   options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS,
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
   * Default availability probe. Returns true; the adapter assumes it
   * can run unless the concrete subclass knows better. Subclasses with
   * meaningful availability constraints (API key presence, runtime
   * feature detect, local model warmth) override and surface their own
   * check. Must never throw; return false instead.
   */
  async probe(): Promise<boolean> {
    return Promise.resolve(true);
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    return this.#retry.run(async () => {
      try {
        return await this.performChat(request);
      } catch (rawError) {
        const classification = this.classify(rawError);
        // QUOTA_EXHAUSTED: honor retry-after only when short; else give up
        // immediately (matches nocturne's `extractWithSchema.ts:26–27`).
        if (
          classification.reason === 'QUOTA_EXHAUSTED'
          && classification.retryAfterMs !== undefined
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

  /** Map a provider-native error into the shared classification. */
  protected classify(error: unknown): ErrorClassification {
    if (error instanceof LlmError) return error.classification;
    return Classifications['UNKNOWN'];
  }
}

