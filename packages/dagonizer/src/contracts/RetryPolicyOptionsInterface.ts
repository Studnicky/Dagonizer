import type { BackoffStrategyValue } from '../entities/runtime/BackoffStrategy.js';

import type { ErrorConstructorType } from './ErrorConstructorType.js';

/** Configuration options for `RetryPolicy`. */
export interface RetryPolicyOptionsInterface {
  maxAttempts?: number;
  strategy?: BackoffStrategyValue;
  baseDelay?: number;
  maxDelay?: number;
  multiplier?: number;
  jitterFactor?: number;
  retryOn?: ErrorConstructorType[];
  abortOn?: ErrorConstructorType[];
}
