/**
 * BackoffStrategy: backoff delay strategies for `RetryPolicy`.
 *
 *   constant: fixed delay between attempts
 *   linear: delay grows linearly with attempt number
 *   exponential: delay grows exponentially (default)
 *   decorrelated-jitter: randomized jitter to spread retry load
 *
 * `@studnicky/retry` ships its own `BackoffStrategyType`, but it is a
 * `(attemptNumber, baseDelayMs) => number` function — not a JSON-serializable
 * value. `RetryPolicyOptionsType.strategy` is a wire-shape field (schemas are
 * the source of truth here), so this schema-derived string enum stays as the
 * DAG-specific, serializable strategy selector; `RetryPolicy.getDelay()`
 * dispatches on it.
 */

import type { FromSchema } from 'json-schema-to-ts';

export const BackoffStrategySchema = {
  '$id': 'https://noocodec.dev/schemas/dagonizer/BackoffStrategy',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'string',
  'enum': ['constant', 'decorrelated-jitter', 'exponential', 'linear'],
} as const;

/** Union type derived from `BackoffStrategySchema` via `json-schema-to-ts`. */
export type BackoffStrategyType = FromSchema<typeof BackoffStrategySchema>;
// → 'constant' | 'decorrelated-jitter' | 'exponential' | 'linear'

/** Backoff delay strategies for `RetryPolicy`. */
export const BackoffStrategyNames = {
  'CONSTANT': 'constant',
  'DECORRELATED_JITTER': 'decorrelated-jitter',
  'EXPONENTIAL': 'exponential',
  'LINEAR': 'linear',
} as const satisfies Record<string, BackoffStrategyType>;
