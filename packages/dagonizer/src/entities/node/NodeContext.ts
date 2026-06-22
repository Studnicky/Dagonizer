/**
 * NodeContext: execution context passed to every `NodeInterface.execute()` call.
 *
 * The wire shape carries `dagName` and `nodeName`. The runtime `NodeContextType`
 * extends this to add `signal: AbortSignal` (not JSON-expressible).
 */

import type { FromSchema } from 'json-schema-to-ts';

import type { OutputSchemaValidatorInterface } from '../../contracts/NodeInterface.js';

export const NodeContextSchema = {
  '$id': 'https://noocodex.dev/schemas/dagonizer/NodeContext',
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
 * Extends `NodeContextWireType` entity with `signal: AbortSignal` and a typed
 * `services` slot. The entity carries the JSON-expressible fields
 * (`dagName`, `nodeName`); the type adds runtime-only fields
 * (signal, services record) that are not serializable.
 *
 * The `TServices` parameter carries the consumer-defined services record the
 * dispatcher was constructed with, typically a typed record of injected
 * dependencies (loggers, clients, registries). When a dispatcher is
 * constructed without `services`, `TServices` defaults to `undefined`
 * and `context.services` is `undefined` at runtime.
 *
 * Nodes should pass `context.signal` to every awaitable IO (fetch, retry,
 * subprocess) so cancellation propagates cleanly.
 */
export type NodeContextType<TServices = undefined> = NodeContextWireType & {
  /** AbortSignal: fires when the caller aborts or the deadline expires. */
  'signal': AbortSignal;
  /** Name of the DAG being executed. */
  'dagName': string;
  /** Name of the current node. */
  'nodeName': string;
  /**
   * Services record handed to the dispatcher at construction. `undefined`
   * when the dispatcher was constructed without a services option; a node
   * that requires services narrows this and routes to `error` when absent.
   */
  'services': TServices | undefined;
  /**
   * When `true`, `ScalarNode.execute` validates each item's state against
   * `this.outputSchema[port]` after `executeOne` returns. On mismatch the
   * item is re-routed to `'error'` with code `outputContractViolation`.
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
 * Static factory for `NodeContextType`. Named `NodeContextBuilder` to
 * avoid collision with the `NodeContext` wire type (the `FromSchema`-derived
 * type occupies that identifier). The `*Builder` pattern follows the same
 * convention used elsewhere in this codebase where the type name is taken.
 *
 * Key order (signal, dagName, nodeName, services, validateOutputs) is fixed
 * for V8 shape stability: every instance has the same hidden class regardless
 * of call site.
 */
export class NodeContextBuilder {
  static of<TServices>(
    dagName: string,
    nodeName: string,
    signal: AbortSignal,
    services: TServices | undefined,
    validateOutputs: boolean = false,
    outputSchemaValidator: OutputSchemaValidatorInterface | null = null,
  ): NodeContextType<TServices> {
    return { signal, dagName, nodeName, services, validateOutputs, outputSchemaValidator };
  }
}
