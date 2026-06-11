import type { BackoffStrategy } from '../entities/runtime/BackoffStrategy.js';

import type { ErrorConstructorType } from './ErrorConstructorType.js';

/**
 * Trailing config object for `RetryPolicy.from(partial)` and the `RetryPolicy`
 * constructor. All fields are optional; defaults are materialised in
 * `RETRY_POLICY_DEFAULTS` inside `RetryPolicy`. Callers only need to supply
 * the fields they want to override.
 */
export interface RetryPolicyOptionsInterface {
  maxAttempts?: number;
  strategy?: BackoffStrategy;
  baseDelay?: number;
  maxDelay?: number;
  multiplier?: number;
  jitterFactor?: number;
  retryOn?: ErrorConstructorType[];
  abortOn?: ErrorConstructorType[];
}
