import type { Batch } from '../entities/batch/Batch.js';
import type { RoutedBatchType } from '../entities/batch/RoutedBatchType.js';
import type { NodeUnionType } from '../entities/node/Node.js';
import type { NodeContextType } from '../entities/node/NodeContext.js';
import type { Timeout } from '../entities/Timeout.js';
import type { ValidationResultType } from '../entities/validation/ValidationResult.js';
import type { NodeStateInterface } from '../NodeStateBase.js';


import type { OperationContractFragmentType } from './OperationContractFragment.js';

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
 * `NodeContextType`. When a node only depends on `state`, leave
 * `TServices` at the default `undefined`.
 */
export interface NodeInterface<
  TState extends NodeStateInterface = NodeStateInterface,
  TOutput extends string = string,
  TServices = undefined,
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
   * throws a `NodeTimeoutError`, fires `onError`, and marks the run failed.
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
   * `context` carries the abort signal, the names of the flow/stage being
   * executed, and the dispatcher's services bag. Long-running nodes should
   * propagate `context.signal` to any awaitable IO.
   */
  execute(batch: Batch<TState>, context: NodeContextType<TServices>): Promise<RoutedBatchType<TOutput, TState>>;

  readonly 'name': string;

  /**
   * Declared output ports this node can return.
   * Used for flow validation; ensures all outputs are wired.
   * Common outputs: 'success', 'error', 'skip', 'retry'
   */
  readonly 'outputs': readonly TOutput[];

  /**
   * Data-flow declaration for `DAGDeriver`. Every node carries a contract;
   * nodes that do not participate in derivation use `EMPTY_CONTRACT_FRAGMENT`
   * (both arrays empty). The deriver skips fragments where
   * `hardRequired.length === 0 && produces.length === 0`, so these nodes
   * contribute no derived edges.
   *
   * The node's own `name` and `outputs` fields complete the full
   * `OperationContractType` surface; the fragment carries only the fields
   * the deriver uses to wire edges.
   *
   * Concrete base class `MonadicNode` declares
   * `readonly contract: OperationContractFragmentType = EMPTY_CONTRACT_FRAGMENT`
   * as the V8-stable required-with-default. Implementors that do not extend
   * `MonadicNode` must declare `contract` explicitly; import
   * `EMPTY_CONTRACT_FRAGMENT` from `contracts/OperationContractFragmentType.js`
   * for the no-derivation case.
   */
  readonly 'contract': OperationContractFragmentType;

  /**
   * Validate node configuration.
   * Called during flow registration to catch errors early.
   */
  validate?(): ValidationResultType;
}
