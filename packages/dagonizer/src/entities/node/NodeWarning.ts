/**
 * NodeWarning: warning collected during node execution.
 *
 * Warnings accumulate in state and are available on the final result.
 */

import type { FromSchema } from 'json-schema-to-ts';

/**
 * Single source of the `NodeWarning` JSON Schema `properties` block.
 *
 * `NodeStateData` embeds an inline `NodeWarning` item shape and references this
 * const structurally (`properties: NodeWarningProperties`) instead of
 * hand-copying the property block. Pair it with `NodeWarningSchema.required` at
 * the inline site.
 */
export const NodeWarningProperties = {
  'code': { 'type': 'string' },
  'message': { 'type': 'string' },
  'operation': { 'type': 'string' },
  'timestamp': { 'type': 'string' },
} as const;

export const NodeWarningSchema = {
  '$id': 'https://noocodex.dev/schemas/dagonizer/NodeWarning',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'required': ['code', 'message', 'operation', 'timestamp'],
  'properties': NodeWarningProperties,
  'additionalProperties': false,
} as const;

/** TypeScript type derived from `NodeWarningSchema` via `json-schema-to-ts`. */
export type NodeWarningType = FromSchema<typeof NodeWarningSchema>;
