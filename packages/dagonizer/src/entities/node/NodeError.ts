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
  /**
   * Optional context bag for this error.
   *
   * Kept optional on this author-facing interface: `NodeStateBase.collectError`
   * defaults absent `context` to `{}` before storing the error, so the engine
   * never null-checks this field internally. Node authors omit it when there
   * is no additional diagnostic data to attach.
   */
  'context'?: Record<string, unknown>;
}
