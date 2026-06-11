import type { RetryPolicyOptionsInterface } from '../contracts/RetryPolicyOptionsInterface.js';
import { RetryPolicy } from '../runtime/index.js';

import { LlmError } from './LlmError.js';

/**
 * A `RetryPolicy` that honors the `retryable` flag carried by every `LlmError`:
 * a non-retryable classification (auth failure, bad request, model-not-found,
 * quota-exceeded past the cap) is never retried, regardless of attempt budget.
 * Any other error falls back to the base `retryOn`/`abortOn` behavior.
 *
 * Keeps `RetryPolicy` itself generic; the `LlmError` coupling lives here, in
 * the adapter layer.
 *
 * Construct via `RetryableErrorPolicy.from(partial)` — the inherited constructor
 * is `protected`, so `from()` is the canonical creation path.
 */
export class RetryableErrorPolicy extends RetryPolicy {
  /**
   * Materialise a `RetryableErrorPolicy` from a partial options object.
   * Delegates to the base `RetryPolicy` constructor via `from()`.
   */
  static override from(partial: RetryPolicyOptionsInterface = {}): RetryableErrorPolicy {
    return new RetryableErrorPolicy(partial);
  }

  override shouldRetry(error: Error, attempt: number): boolean {
    if (error instanceof LlmError && !error.classification.retryable) return false;
    return super.shouldRetry(error, attempt);
  }
}
