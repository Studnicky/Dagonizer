/**
 * ScatterOutput: aggregate output names produced by the `aggregate`
 * outcome reducer of a scatter node.
 *
 *   all-success: every clone routed 'success'
 *   partial: some clones succeeded, some failed
 *   all-error: every clone failed
 *   empty: source array was empty; scatter skipped
 */

import type { FromSchema } from 'json-schema-to-ts';

export const ScatterOutputSchema = {
  '$id': 'https://noocodex.dev/schemas/dagonizer/ScatterOutput',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'string',
  'enum': ['all-error', 'all-success', 'empty', 'partial'],
} as const;

/** Union type derived from `ScatterOutputSchema` via `json-schema-to-ts`. */
export type ScatterOutputType = FromSchema<typeof ScatterOutputSchema>;
// → 'all-error' | 'all-success' | 'empty' | 'partial'

/** Scatter aggregate output names. */
export const ScatterOutputNames = {
  'ALL_ERROR': 'all-error',
  'ALL_SUCCESS': 'all-success',
  'EMPTY': 'empty',
  'PARTIAL': 'partial',
} as const satisfies Record<string, ScatterOutputType>;
