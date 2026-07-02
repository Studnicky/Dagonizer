import type { GatherExecutionType, GatherRecordType } from '../contracts/GatherExecution.js';
import type { NodeInterface } from '../contracts/NodeInterface.js';
import type { StateAccessorInterface } from '../contracts/StateAccessorInterface.js';
import { ContextResolver } from '../dag/ContextResolver.js';
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
export interface GatherSourceInterface {
  readonly nodes: ReadonlyMap<string, NodeInterface<NodeStateInterface, string>>;
  readonly accessor: StateAccessorInterface;
  nodeContext(dagName: string, placementName: string, signal: AbortSignal): NodeContextType;
  runNodeOnState(node: NodeInterface<NodeStateInterface, string>, state: NodeStateInterface, context: NodeContextType): Promise<string>;
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
export class Gather
  implements NodeInvokerSourceInterface
{
  readonly #source: GatherSourceInterface;

  constructor(source: GatherSourceInterface) {
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
    state: NodeStateInterface,
    records: ReadonlyArray<GatherRecordType>,
    dagName: string,
    signal: AbortSignal,
  ): GatherExecutionType {
    const invoker = new NodeInvoker(this, state, dagName, signal);
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
   * `signal` is always a valid `AbortSignal` — a run with no caller-supplied
   * cancellation surface carries `Signal.never()`, resolved upstream by the
   * source's `nodeContext` implementation, so `Gather` has no direct
   * dependency on `Signal`.
   */
  async invokeRegisteredNode(
    nodeName: string,
    state: NodeStateInterface,
    dagName: string,
    signal: AbortSignal,
  ): Promise<void> {
    const nodeIri = ContextResolver.expand(nodeName, {});
    if (!this.#source.nodes.has(nodeIri)) {
      throw new DAGError(`Unknown custom node: ${nodeName}`);
    }
    const dagNode = this.#source.nodes.get(nodeIri);
    if (dagNode === undefined) return;
    const context = this.#source.nodeContext(dagName, nodeName, signal);
    await this.#source.runNodeOnState(dagNode, state, context);
  }
}
