/**
 * NodeError: error collected during node execution.
 *
 * Errors accumulate in state; they do not stop the flow.
 * At flow completion the caller decides what to do with them.
 */

import type { FromSchema } from 'json-schema-to-ts';

export const NodeErrorSchema = {
  '$id': 'https://noocodex.dev/schemas/dagonizer/NodeError',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'required': ['code', 'message', 'operation', 'recoverable', 'timestamp'],
  'properties': {
    'code': { 'type': 'string' },
    'context': { 'type': 'object' },
    'message': { 'type': 'string' },
    'operation': { 'type': 'string' },
    'recoverable': { 'type': 'boolean' },
    'timestamp': { 'type': 'string' },
  },
  'additionalProperties': false,
} as const;

/** TypeScript type derived from `NodeErrorSchema` via `json-schema-to-ts`. */
export type NodeError = FromSchema<typeof NodeErrorSchema>;

/**
 * Error collected during node execution.
 *
 * Extends the `NodeError` entity with a narrowed `context` type. The entity
 * uses `{ type: 'object' }` (opaque JSON object); the interface narrows it to
 * `Record<string, unknown>` for ergonomic access in TypeScript consumers.
 */
export interface NodeErrorInterface extends Omit<NodeError, 'context'> {
  'context'?: Record<string, unknown>;
}
