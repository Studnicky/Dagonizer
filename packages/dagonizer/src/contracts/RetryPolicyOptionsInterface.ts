import type { BackoffStrategyValue } from '../entities/runtime/BackoffStrategy.js';

import type { ErrorConstructorType } from './ErrorConstructorType.js';

/** Configuration options for `RetryPolicy`. */
export interface RetryPolicyOptionsInterface {
  readonly 'maxAttempts'?: number;
  readonly 'strategy'?: BackoffStrategyValue;
  readonly 'baseDelay'?: number;
  readonly 'maxDelay'?: number;
  readonly 'multiplier'?: number;
  readonly 'jitterFactor'?: number;
  readonly 'retryOn'?: readonly ErrorConstructorType[];
  readonly 'abortOn'?: readonly ErrorConstructorType[];
}
