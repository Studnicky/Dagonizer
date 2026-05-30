/**
 * NodeWarning: warning collected during node execution.
 *
 * Warnings accumulate in state and are available on the final result.
 */

import type { FromSchema } from 'json-schema-to-ts';

export const NodeWarningSchema = {
  '$id': 'https://noocodex.dev/schemas/dagonizer/NodeWarning',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'required': ['code', 'message', 'operation', 'timestamp'],
  'properties': {
    'code': { 'type': 'string' },
    'message': { 'type': 'string' },
    'operation': { 'type': 'string' },
    'timestamp': { 'type': 'string' },
  },
  'additionalProperties': false,
} as const;

/** TypeScript type derived from `NodeWarningSchema` via `json-schema-to-ts`. */
export type NodeWarning = FromSchema<typeof NodeWarningSchema>;
