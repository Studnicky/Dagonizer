/**
 * ParallelCombine — strategies for combining outputs from parallel node groups.
 *
 *   all-success — continue with 'success' only if all nodes output 'success'
 *   any-success — continue with 'success' if any node outputs 'success'
 *   collect     — store all outputs in metadata for the next node to inspect
 */

import type { FromSchema } from 'json-schema-to-ts';

export const ParallelCombineSchema = {
  '$id': 'https://noocodex.dev/schemas/dagonizer/ParallelCombine',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'string',
  'enum': ['all-success', 'any-success', 'collect'],
} as const;

/** Union type derived from `ParallelCombineSchema` via `json-schema-to-ts`. */
export type ParallelCombine = FromSchema<typeof ParallelCombineSchema>;
// → 'all-success' | 'any-success' | 'collect'

/** Parallel combine strategies. */
export const ParallelCombine = {
  'ALL_SUCCESS': 'all-success',
  'ANY_SUCCESS': 'any-success',
  'COLLECT': 'collect',
} as const satisfies Record<string, ParallelCombine>;
