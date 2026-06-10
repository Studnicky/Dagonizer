import type { Node } from '../entities/node/Node.js';
import type { NodeContextInterface } from '../entities/node/NodeContext.js';
import type { NodeOutputInterface } from '../entities/node/NodeOutput.js';
import type { ValidationResult } from '../entities/validation/ValidationResult.js';
import type { NodeStateInterface } from '../NodeStateBase.js';
import type { Timeout } from '../runtime/Timeout.js';

import type { OperationContractFragment } from './OperationContractFragment.js';

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
   * Optional per-node wall-clock budget.
   *
   * When set, the engine derives a child `AbortController` from the run's
   * signal and schedules an abort after the budget elapses. The child signal
   * is passed as `context.signal` to this node's `execute()` call only;
   * other nodes in the same run are unaffected. On expiry the engine throws
   * a `NodeTimeoutError` wrapped as a `DAGError`, fires `onError`, and marks
   * the run failed.
   *
   * Absent (or `Timeout.none()`) — the node is subject only to the run-level
   * `deadlineMs` / `signal` from `ExecuteOptionsInterface`.
   *
   * Set `Timeout.ofMs(n)` for a per-node wall-clock budget of `n` ms.
   *
   * This field is intentionally optional on the contract (external boundary:
   * consumer-implemented nodes are not required to carry a default). The
   * concrete `MonadicNode` base class declares `timeout: Timeout = Timeout.none()`
   * for V8 hidden-class stability; the engine treats an absent field as
   * `Timeout.none()`.
   */
  timeout?: Timeout;

  /**
   * Execute the node, mutating state.
   * Returns a result indicating which output port to route to.
   * Never throws; catches all errors internally and routes to error output.
   *
   * `context` carries the abort signal, the names of the flow/stage being
   * executed, and the dispatcher's services bag. Long-running nodes should
   * propagate `context.signal` to any awaitable IO.
   */
  execute(state: TState, context: NodeContextInterface<TServices>): Promise<NodeOutputInterface<TOutput>>;

  readonly 'name': string;

  /**
   * Declared output ports this node can return.
   * Used for flow validation; ensures all outputs are wired.
   * Common outputs: 'success', 'error', 'skip', 'retry'
   */
  readonly 'outputs': readonly TOutput[];

  /**
   * Optional data-flow declaration. When present, DAGDeriver can derive
   * topology from a node registry without a separate contract array;
   * registration-time validation cross-checks producers and consumers.
   *
   * The node's own `name` and `outputs` fields complete the full
   * OperationContract surface; the fragment carries only the fields
   * the deriver uses to wire edges.
   */
  readonly 'contract'?: OperationContractFragment;

  /**
   * Validate node configuration.
   * Called during flow registration to catch errors early.
   */
  validate?(): ValidationResult;
}
