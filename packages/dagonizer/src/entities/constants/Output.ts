/**
 * Output: common operation output names.
 *
 *   success: operation completed successfully
 *   error: operation encountered an error
 */

import type { FromSchema } from 'json-schema-to-ts';

export const OutputSchema = {
  '$id': 'https://noocodex.dev/schemas/dagonizer/Output',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'string',
  'enum': ['error', 'success'],
} as const;

/** Union type derived from `OutputSchema` via `json-schema-to-ts`. */
export type Output = FromSchema<typeof OutputSchema>;
// → 'error' | 'success'

/** Common operation output names. */
export const OutputNames = {
  'ERROR': 'error',
  'SUCCESS': 'success',
} as const satisfies Record<string, Output>;
