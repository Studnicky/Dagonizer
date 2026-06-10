/**
 * NodeError: error collected during node execution.
 *
 * Errors accumulate in state; they do not stop the flow.
 * At flow completion the caller decides what to do with them.
 *
 * Every `NodeError` carries `context` (required, defaults to `{}` when no
 * additional diagnostic data is available). One hidden class — V8 monomorphic.
 *
 * Construction routes through `NodeErrorBuilder.from(partial)` which fills
 * `context: {}` when the caller omits it, so authors never write boilerplate.
 */

import type { FromSchema } from 'json-schema-to-ts';

export const NodeErrorSchema = {
  '$id': 'https://noocodex.dev/schemas/dagonizer/NodeError',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'required': ['code', 'context', 'message', 'operation', 'recoverable', 'timestamp'],
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
 *
 * `context` is required — always present, defaults to `{}` when no additional
 * diagnostic data is available. One hidden class across all instances.
 */
export interface NodeErrorInterface extends Omit<NodeError, 'context'> {
  /**
   * Diagnostic context bag for this error.
   *
   * Always present. Callers with no additional data pass `{}`.
   * `NodeErrorBuilder.from(partial)` fills `context: {}` when omitted so
   * authors need not write it explicitly.
   */
  'context': Record<string, unknown>;
}

/**
 * Static factory for `NodeErrorInterface`.
 *
 * Named `NodeErrorBuilder` to avoid the identifier collision with the
 * schema-derived `NodeError` type (per the canonical-names rule: when a type
 * and a value would share a name, rename the value to its real role).
 *
 * `NodeErrorBuilder.from(partial)` accepts the required fields plus an
 * optional `context`, returning a complete `NodeErrorInterface` with
 * `context` defaulting to `{}`. All required fields are positional; defaults
 * live in one place.
 *
 * @example
 * ```ts
 * return NodeErrorBuilder.from({
 *   code: 'FETCH_FAILED',
 *   message: 'HTTP 503',
 *   operation: 'fetchUser',
 *   recoverable: true,
 *   timestamp: new Date().toISOString(),
 * });
 *
 * return NodeErrorBuilder.from({
 *   code: 'VALIDATION_ERROR',
 *   message: 'missing required field',
 *   operation: 'validate',
 *   recoverable: false,
 *   timestamp: new Date().toISOString(),
 *   context: { field: 'email', value: null },
 * });
 * ```
 */
export class NodeErrorBuilder {
  private constructor() { /* static class */ }

  /**
   * Construct a complete `NodeErrorInterface`, defaulting `context` to `{}`.
   */
  static from(partial: {
    code: string;
    message: string;
    operation: string;
    recoverable: boolean;
    timestamp: string;
    context?: Record<string, unknown>;
  }): NodeErrorInterface {
    return {
      'code': partial.code,
      'context': partial.context ?? {},
      'message': partial.message,
      'operation': partial.operation,
      'recoverable': partial.recoverable,
      'timestamp': partial.timestamp,
    };
  }
}
