/**
 * FanOutOutput — aggregate output names for fan-out nodes.
 *
 *   all-success — all items returned 'success'
 *   partial     — some items succeeded, some failed
 *   all-error   — all items failed
 *   empty       — source array was empty; fan-out skipped
 */

import type { FromSchema } from 'json-schema-to-ts';

export const FanOutOutputSchema = {
  '$id': 'https://noocodex.dev/schemas/dagonizer/FanOutOutput',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'string',
  'enum': ['all-error', 'all-success', 'empty', 'partial'],
} as const;

/** Union type derived from `FanOutOutputSchema` via `json-schema-to-ts`. */
export type FanOutOutput = FromSchema<typeof FanOutOutputSchema>;
// → 'all-error' | 'all-success' | 'empty' | 'partial'

/** Fan-out aggregate output names. */
export const FanOutOutput = {
  'ALL_ERROR': 'all-error',
  'ALL_SUCCESS': 'all-success',
  'EMPTY': 'empty',
  'PARTIAL': 'partial',
} as const satisfies Record<string, FanOutOutput>;
