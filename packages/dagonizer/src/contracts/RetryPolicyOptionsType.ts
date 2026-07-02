import type { BackoffStrategyType } from '../entities/runtime/BackoffStrategy.js';

import type { ErrorMatcherType } from './ErrorMatcherType.js';

/**
 * Trailing config object for `RetryPolicy.from(partial)` and the `RetryPolicy`
 * constructor. All fields are optional; defaults are materialised in
 * `RETRY_POLICY_DEFAULTS` inside `RetryPolicy`. Callers only need to supply
 * the fields they want to override.
 */
export type RetryPolicyOptionsType = {
  /** Maximum number of attempts (initial + retries). Defaults to `RETRY_POLICY_DEFAULTS.maxAttempts`. */
  maxAttempts?: number;
  /** Delay growth strategy. Defaults to `'exponential'`. */
  strategy?: BackoffStrategyType;
  /** Base delay in milliseconds before the first retry. Defaults to `RETRY_POLICY_DEFAULTS.baseDelay`. */
  baseDelay?: number;
  /** Upper bound on the computed delay in milliseconds. Defaults to `RETRY_POLICY_DEFAULTS.maxDelay`. */
  maxDelay?: number;
  /** Exponential growth factor; used by `'exponential'` and `'linear'` strategies. */
  multiplier?: number;
  /** Fractional jitter applied to the computed delay; `0` = no jitter, `1` = full-width jitter. */
  jitterFactor?: number;
  /**
   * Error classes (or `DAGError` code strings) that trigger a retry. An
   * error not matched by this list is re-thrown immediately.
   */
  retryOn?: ErrorMatcherType[];
  /**
   * Error classes (or `DAGError` code strings) that abort the retry loop
   * immediately regardless of `retryOn`.
   */
  abortOn?: ErrorMatcherType[];
};