import type { GatherExecutionType, GatherRecordType } from '../contracts/GatherExecution.js';
import type { NodeInterface } from '../contracts/NodeInterface.js';
import type { StateAccessorInterface } from '../contracts/StateAccessorInterface.js';
import type { NodeContextType } from '../entities/node/NodeContext.js';
import { DAGError } from '../errors/index.js';
import type { NodeStateInterface } from '../NodeStateBase.js';

import { NodeInvoker } from './NodeInvoker.js';
import type { NodeInvokerSourceInterface } from './NodeInvoker.js';

/**
 * Dispatcher surface `Gather` needs to compose gather executions and invoke
 * registered nodes during a `custom` gather's finalize pass. `Dagonizer`
 * implements this interface so `Gather` depends only on a narrow port, not
 * on the whole dispatcher.
 */
export interface GatherSourceInterface<TState extends NodeStateInterface, TServices> {
  readonly nodes: ReadonlyMap<string, NodeInterface<TState, string, TServices>>;
  readonly accessor: StateAccessorInterface;
  nodeContext(dagName: string, placementName: string, signal: AbortSignal | null): NodeContextType<TServices>;
  runNodeOnState(node: NodeInterface<TState, string, TServices>, state: TState, context: NodeContextType<TServices>): Promise<string>;
}

/**
 * Gather execution composer and registered-node invoker.
 *
 * Extracts the two gather-adjacent methods that previously lived on `Dagonizer`:
 * `composeGatherExecution` (builds the `GatherExecutionType` handed to a
 * `GatherStrategy`) and `invokeRegisteredNode` (runs a named node during a
 * `custom` gather's finalize pass). Both depend only on the narrow
 * `GatherSourceInterface` port, not the full dispatcher.
 *
 * Implements `NodeInvokerSourceInterface` so it can be passed as the source
 * to `NodeInvoker` instances produced during `composeGatherExecution`.
 */
export class Gather<TState extends NodeStateInterface, TServices>
  implements NodeInvokerSourceInterface<TState>
{
  readonly #source: GatherSourceInterface<TState, TServices>;

  constructor(source: GatherSourceInterface<TState, TServices>) {
    this.#source = source;
  }

  /**
   * Compose the per-gather execution context handed to a `GatherStrategy`.
   *
   * The `invoker` is a `NodeInvoker` (a named class with a stable shape)
   * holding direct references to this instance and the enclosing execution
   * context. No injected function callbacks.
   */
  composeGatherExecution(
    state: TState,
    records: ReadonlyArray<GatherRecordType<TState>>,
    dagName: string,
    signal: AbortSignal | null,
  ): GatherExecutionType<TState> {
    const invoker = new NodeInvoker<TState>(this, state, dagName, signal);
    return {
      state,
      'records': [...records],
      dagName,
      signal,
      'accessor': this.#source.accessor,
      invoker,
    };
  }

  /**
   * Run the named registered node over `state` as a size-1 batch during a
   * `custom` gather's finalize pass. Throws `DAGError` when the node is not
   * registered; no-ops if the lookup races to `undefined` after the
   * existence check.
   *
   * Satisfies `NodeInvokerSourceInterface` so `NodeInvoker` instances
   * produced by `composeGatherExecution` can forward here.
   *
   * Null-signal substitution (SignalComposer.never()) is performed inside
   * the source's `nodeContext` implementation so `Gather` has no direct
   * dependency on `SignalComposer`.
   */
  async invokeRegisteredNode(
    nodeName: string,
    state: TState,
    dagName: string,
    signal: AbortSignal | null,
  ): Promise<void> {
    if (!this.#source.nodes.has(nodeName)) {
      throw new DAGError(`Unknown custom node: ${nodeName}`);
    }
    const dagNode = this.#source.nodes.get(nodeName);
    if (dagNode === undefined) return;
    const context = this.#source.nodeContext(dagName, nodeName, signal);
    await this.#source.runNodeOnState(dagNode, state, context);
  }
}
