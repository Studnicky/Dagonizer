import type { Node } from '../entities/node/Node.js';
import type { NodeContextInterface } from '../entities/node/NodeContext.js';
import type { NodeOutputInterface } from '../entities/node/NodeOutput.js';
import type { ValidationResult } from '../entities/validation/ValidationResult.js';
import type { NodeStateInterface } from '../NodeStateBase.js';

/**
 * A discrete unit of work in a flow.
 * Nodes are stateless — all state flows through NodeStateInterface.
 * Nodes never throw — they return results with named outputs for routing.
 *
 * Extends `Node` entity via `Omit<Node, 'outputs'>`:
 *   - `outputs` is narrowed from `string[]` to `readonly TOutput[]`
 *
 * The `TOutput` generic narrows the node's output port union so
 * node configurations can be exhaustiveness-checked at compile time.
 *
 * The `TServices` generic carries the dispatcher's services bag through
 * `NodeContextInterface`. When a node only depends on `state`, leave
 * `TServices` at the default `undefined`.
 */
export interface NodeInterface<
  TState extends NodeStateInterface = NodeStateInterface,
  TOutput extends string = string,
  TServices = undefined,
> extends Omit<Node, 'outputs'> {
  /**
   * Clean up resources when dispatcher is destroyed.
   */
  destroy?(): Promise<void>;

  /**
   * Optional per-node wall-clock budget in milliseconds.
   *
   * When set, the engine derives a child `AbortController` from the run's
   * signal and schedules an abort after `timeoutMs`. The child signal is
   * passed as `context.signal` to this node's `execute()` call only —
   * other nodes in the same run are unaffected. On expiry the engine throws
   * a `NodeTimeoutError` wrapped as a `DAGError`, fires `onError`, and
   * marks the run failed.
   *
   * Omitting this field (or setting it to `undefined`) leaves the node
   * subject only to the run-level `deadlineMs` / `signal` from
   * `ExecuteOptionsInterface`.
   */
  readonly 'timeoutMs'?: number;

  /**
   * Execute the node, mutating state.
   * Returns a result indicating which output port to route to.
   * Never throws — catches all errors internally and routes to error output.
   *
   * `context` carries the abort signal, the names of the flow/stage being
   * executed, and the dispatcher's services bag. Long-running nodes should
   * propagate `context.signal` to any awaitable IO.
   */
  execute(state: TState, context: NodeContextInterface<TServices>): Promise<NodeOutputInterface<TOutput>>;

  readonly 'name': string;

  /**
   * Declared output ports this node can return.
   * Used for flow validation — ensures all outputs are wired.
   * Common outputs: 'success', 'error', 'skip', 'retry'
   */
  readonly 'outputs': readonly TOutput[];

  /**
   * Validate node configuration.
   * Called during flow registration to catch errors early.
   */
  validate?(): ValidationResult;
}
