/**
 * NodeContext: execution context passed to every `NodeInterface.execute()` call.
 *
 * The wire shape carries `dagName` and `nodeName`. The runtime `NodeContextType`
 * extends this to add `signal: AbortSignal` (not JSON-expressible).
 */

import type { FromSchema } from 'json-schema-to-ts';

import type { OutputSchemaValidatorInterface } from '../../contracts/NodeInterface.js';

export const NodeContextSchema = {
  '$id': 'https://noocodec.dev/schemas/dagonizer/NodeContext',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'required': ['dagName', 'nodeName'],
  'properties': {
    'dagName': { 'type': 'string', 'minLength': 1 },
    'nodeName': { 'type': 'string', 'minLength': 1 },
  },
  'additionalProperties': false,
} as const;

/** TypeScript type derived from `NodeContextSchema` via `json-schema-to-ts`. */
export type NodeContextWireType = FromSchema<typeof NodeContextSchema>;

/**
 * Execution context passed to every `NodeInterface.execute()` call.
 *
 * Extends `NodeContextWireType` entity with `signal: AbortSignal`.
 * The entity carries the JSON-expressible fields (`dagName`, `nodeName`);
 * the type adds runtime-only fields (signal, validation) that are not serializable.
 *
 * Nodes should pass `context.signal` to every awaitable IO (fetch, retry,
 * subprocess) so cancellation propagates cleanly.
 *
 * A node that needs its run's correlation id or DAG IRI reads it via
 * `DagExecutionContext.correlationIdOf(context.signal)` /
 * `.dagNameOf(context.signal)` (`runtime/DagExecutionContext.ts`) — both
 * return `undefined` when the node runs outside `Dagonizer.execute()`/
 * `resume()` (e.g. invoked directly in a test). Not stored as a field on
 * this type: the value depends on external mutable scope state resolved at
 * read time, which would break the fixed-key-order V8 shape guarantee this
 * type otherwise holds if computed once at construction and then gone stale
 * relative to the live scope.
 */
export type NodeContextType = NodeContextWireType & {
  /** AbortSignal: fires when the caller aborts or the deadline expires. */
  'signal': AbortSignal;
  /** Name of the DAG being executed. */
  'dagName': string;
  /** Name of the current node. */
  'nodeName': string;
  /**
   * When `true`, the scheduler validates routed batch item state against
   * `this.outputSchema[port]` after `execute` returns. On mismatch the item
   * is re-routed to `'error'` with code `outputContractViolation`.
   * Set from `DagonizerOptionsType.validateOutputs`; default `false`.
   */
  'validateOutputs': boolean;
  /**
   * Validator service injected by the dispatcher when `validateOutputs` is
   * `true`. `null` when validation is off (default) — zero overhead. `core/`
   * reads this via the `OutputSchemaValidatorInterface` contract (defined in
   * `contracts/`) without importing `validation/` directly.
   */
  'outputSchemaValidator': OutputSchemaValidatorInterface | null;
};

/**
 * Static factory for `NodeContextType`.
 *
 * Key order (signal, dagName, nodeName, validateOutputs, outputSchemaValidator) is
 * fixed for V8 shape stability: every instance has the same hidden class regardless
 * of call site.
 */
export class NodeContext {
  static create(
    dagName: string,
    nodeName: string,
    signal: AbortSignal,
    validateOutputs: boolean = false,
    outputSchemaValidator: OutputSchemaValidatorInterface | null = null,
  ): NodeContextType {
    return { signal, dagName, nodeName, validateOutputs, outputSchemaValidator };
  }
}
