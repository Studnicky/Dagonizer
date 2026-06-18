/**
 * BackoffStrategy: backoff delay strategies for `RetryPolicy`.
 *
 *   constant: fixed delay between attempts
 *   linear: delay grows linearly with attempt number
 *   exponential: delay grows exponentially (default)
 *   decorrelated-jitter: randomized jitter to spread retry load
 */

import type { FromSchema } from 'json-schema-to-ts';

export const BackoffStrategySchema = {
  '$id': 'https://noocodex.dev/schemas/dagonizer/BackoffStrategy',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'string',
  'enum': ['constant', 'decorrelated-jitter', 'exponential', 'linear'],
} as const;

/** Union type derived from `BackoffStrategySchema` via `json-schema-to-ts`. */
export type BackoffStrategy = FromSchema<typeof BackoffStrategySchema>;
// → 'constant' | 'decorrelated-jitter' | 'exponential' | 'linear'

/** Backoff delay strategies for `RetryPolicy`. */
export const BackoffStrategyNames = {
  'CONSTANT': 'constant',
  'DECORRELATED_JITTER': 'decorrelated-jitter',
  'EXPONENTIAL': 'exponential',
  'LINEAR': 'linear',
} as const satisfies Record<string, BackoffStrategy>;
