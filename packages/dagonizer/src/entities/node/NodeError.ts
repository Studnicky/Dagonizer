/**
 * NodeError: error collected during node execution.
 *
 * Errors accumulate in state; they do not stop the flow.
 * At flow completion the caller decides what to do with them.
 *
 * Every `NodeError` carries `context` (required, defaults to `{}` when no
 * additional diagnostic data is available). One hidden class — V8 monomorphic.
 *
 * Construction routes through `NodeErrorBuilder.from(code, message, operation,
 * recoverable, timestamp, options?)` which fills `context: {}` when the caller
 * omits it, so authors never write boilerplate.
 */

import type { FromSchema } from 'json-schema-to-ts';

/**
 * Single source of the `NodeError` JSON Schema `properties` block.
 *
 * Every entity that embeds an inline `NodeError` item shape (`NodeOutput`,
 * `NodeStateData`, `ExecutionResponse`, `BridgeMessage`) references this const
 * structurally (`properties: NodeErrorProperties`) instead of hand-copying the
 * property block. `json-schema-to-ts` reads the literal at compile time, so the
 * derived `FromSchema` types stay identical while a field change propagates
 * from one place. Pair it with `NodeErrorSchema.required` at each inline site.
 */
export const NodeErrorProperties = {
  'code': { 'type': 'string' },
  'context': { 'type': 'object' },
  'message': { 'type': 'string' },
  'operation': { 'type': 'string' },
  'recoverable': { 'type': 'boolean' },
  'timestamp': { 'type': 'string' },
} as const;

export const NodeErrorSchema = {
  '$id': 'https://noocodex.dev/schemas/dagonizer/NodeError',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'required': ['code', 'context', 'message', 'operation', 'recoverable', 'timestamp'],
  'properties': NodeErrorProperties,
  'additionalProperties': false,
} as const;

/** TypeScript type derived from `NodeErrorSchema` via `json-schema-to-ts`. */
export type NodeErrorWireType = FromSchema<typeof NodeErrorSchema>;

/**
 * Error collected during node execution.
 *
 * Extends the `NodeErrorWireType` entity with a narrowed `context` type. The entity
 * uses `{ type: 'object' }` (opaque JSON object); the type narrows it to
 * `Record<string, unknown>` for ergonomic access in TypeScript consumers.
 *
 * `context` is required — always present, defaults to `{}` when no additional
 * diagnostic data is available. One hidden class across all instances.
 */
export type NodeErrorType = Omit<NodeErrorWireType, 'context'> & {
  /**
   * Diagnostic context record for this error.
   *
   * Always present. Callers with no additional data omit the options object;
   * `NodeErrorBuilder.from` fills `context: {}` automatically.
   */
  'context': Record<string, unknown>;
};

/**
 * Static factory for `NodeErrorType`.
 *
 * Named `NodeErrorBuilder` to avoid the identifier collision with the
 * schema-derived `NodeError` type (per the canonical-names rule: when a type
 * and a value would share a name, rename the value to its real role).
 *
 * Required fields are positional in their natural order. The optional
 * `context` lives in the trailing options object. `context` defaults to `{}`
 * when the services record is omitted, so authors never write boilerplate.
 *
 * @example
 * ```ts
 * return NodeErrorBuilder.from(
 *   'FETCH_FAILED',
 *   'HTTP 503',
 *   'fetchUser',
 *   true,
 *   new Date().toISOString(),
 * );
 *
 * return NodeErrorBuilder.from(
 *   'VALIDATION_ERROR',
 *   'missing required field',
 *   'validate',
 *   false,
 *   new Date().toISOString(),
 *   { context: { field: 'email', value: null } },
 * );
 * ```
 */
export class NodeErrorBuilder {
  private constructor() { /* static class */ }

  /**
   * Construct a complete `NodeErrorType`, defaulting `context` to `{}`.
   *
   * @param code - Error code (e.g. `'FETCH_FAILED'`).
   * @param message - Human-readable error description.
   * @param operation - Name of the operation that failed.
   * @param recoverable - Whether the error allows the flow to continue.
   * @param timestamp - ISO 8601 timestamp of the error.
   * @param options - Optional record; `context` defaults to `{}`.
   */
  static from(
    code: string,
    message: string,
    operation: string,
    recoverable: boolean,
    timestamp: string,
    options: { context?: Record<string, unknown> } = {},
  ): NodeErrorType {
    return {
      'code': code,
      'context': options.context ?? {},
      'message': message,
      'operation': operation,
      'recoverable': recoverable,
      'timestamp': timestamp,
    };
  }
}
