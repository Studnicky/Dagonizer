import type { Batch } from '../entities/batch/Batch.js';
import type { RoutedBatchType } from '../entities/batch/RoutedBatchType.js';
import type { NodeUnionType } from '../entities/node/Node.js';
import type { NodeContextType } from '../entities/node/NodeContext.js';
import type { JsonSchemaObjectType } from '../entities/primitives/JsonSchema.js';
import type { Timeout } from '../entities/Timeout.js';
import type { ValidationResultType } from '../entities/validation/ValidationResult.js';
import type { NodeStateInterface } from '../NodeStateBase.js';

/**
 * The loose schema-object type accepted by `Validator.compile`. Equivalent to
 * `JsonSchemaObjectType` — reused, not reinvented.
 */
export type SchemaObjectType = JsonSchemaObjectType;

/**
 * Thin validation contract the engine injects into `NodeContextType` when
 * `validateOutputs` is true. Lives in `contracts/` so `core/` can import it
 * without violating the layer rule (core/ ← contracts/ is a legal inward edge).
 *
 * The implementation is built in `Dagonizer` using `Validator.compile`; `core/`
 * only sees this interface, keeping `validation/` out of the `core/` import graph.
 */
export interface OutputSchemaValidatorInterface {
  /**
   * Validate `state` against the schema declared for `portKey`. Returns `null`
   * when the state satisfies the schema; returns a non-empty array of human-
   * readable violation strings when it does not.
   */
  validatePort(portKey: string, schema: SchemaObjectType, state: unknown): string[] | null;
}

/**
 * A discrete unit of work in a flow.
 * Nodes are stateless; all state flows through NodeStateInterface.
 * Nodes never throw; they return results with named outputs for routing.
 *
 * Extends `Node` entity via `Omit<Node, 'outputs'>`:
 *   - `outputs` is narrowed from `string[]` to `readonly TOutput[]`
 *
 * The `TOutput` generic narrows the node's output port union so
 * node configurations can be exhaustiveness-checked at compile time.
 *
 */
export interface NodeInterface<
  TState extends NodeStateInterface = NodeStateInterface,
  TOutput extends string = string,
> extends Omit<NodeUnionType, 'outputs'> {
  /**
   * Clean up resources when dispatcher is destroyed.
   */
  destroy?(): Promise<void>;

  /**
   * Per-node wall-clock budget. Every node carries this field; use
   * `Timeout.none()` for nodes that have no per-node timeout.
   *
   * When the budget is active (`Timeout.ofMs(n)`), the engine derives a child
   * `AbortController` from the run's signal and schedules an abort after `n` ms.
   * The child signal is passed as `context.signal` to this node's `execute()`
   * call only; other nodes in the same run are unaffected. On expiry the engine
   * throws a `DAGError` (code `NODE_TIMEOUT`), fires `onError`, and marks the run failed.
   *
   * `Timeout.none()` means no per-node budget; the node is subject only to the
   * run-level `deadlineMs` / `signal` from `ExecuteOptionsType`.
   *
   * `MonadicNode` declares `readonly timeout: Timeout = Timeout.none()` as the
   * V8-stable required-with-default. Nodes that do not extend `MonadicNode` must
   * declare `readonly timeout = Timeout.none();` explicitly.
   */
  readonly 'timeout': Timeout;

  /**
   * Execute the node over a batch of states.
   * Returns a `RoutedBatchType` mapping each output port to the items that routed there.
   * Never throws; catches all errors internally and routes to error output.
   *
   * `context` carries the abort signal and the names of the flow/stage being
   * executed. Long-running nodes should propagate `context.signal` to any awaitable IO.
   */
  execute(batch: Batch<TState>, context: NodeContextType): Promise<RoutedBatchType<TOutput, TState>>;

  /** Unique registration name; the dispatcher key and the contract identity. */
  readonly 'name': string;

  /**
   * Declared output ports this node can return.
   * Used for flow validation; ensures all outputs are wired.
   * Common outputs: 'success', 'error', 'skip', 'retry'
   */
  readonly 'outputs': readonly TOutput[];

  /**
   * JSON Schema 2020-12 declaration describing the state shape this node
   * expects before execution. The permissive object schema means "no additional
   * structural requirement"; concrete nodes can narrow this to make route and
   * mapping compatibility visible to graph validation.
   */
  readonly 'inputSchema': SchemaObjectType;

  /**
   * Per-output-port JSON Schema 2020-12 declarations describing the state delta
   * this node guarantees when it routes to that port. Every declared output port
   * in `outputs` MUST have an entry here (enforced at `registerNode`). Schemas
   * are partial over state — they validate the fields this node writes; do NOT
   * set `additionalProperties: false`. Concrete nodes declare the schemas they
   * route with; use `MonadicNode.permissiveSchema(outputs)` only when every port
   * accepts the generic object shape.
   */
  readonly 'outputSchema': Record<TOutput, SchemaObjectType>;

  /**
   * Validate node configuration.
   * Called during flow registration to catch errors early.
   */
  validate?(): ValidationResultType;
}
