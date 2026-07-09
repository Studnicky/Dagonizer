import type { GatherExecutionType, GatherRecordType } from '../contracts/GatherExecution.js';
import type { NodeInterface } from '../contracts/NodeInterface.js';
import type { StateAccessorInterface } from '../contracts/StateAccessorInterface.js';
import { GatherStrategies } from '../core/GatherStrategies.js';
import { Batch } from '../entities/batch/Batch.js';
import type { GatherNodeType } from '../entities/dag/GatherNode.js';
import type { NodeContextType } from '../entities/node/NodeContext.js';
import { DAGError } from '../errors/index.js';
import type { NodeStateInterface } from '../NodeStateBase.js';

import { NodeInvoker } from './NodeInvoker.js';
import type { NodeInvokerSourceInterface } from './NodeInvoker.js';

export type GatherRunResultType = {
  readonly output: string;
};

export type GatherRouteRecordType = Pick<GatherRecordType, 'source' | 'output' | 'terminalOutcome'>;

export type GatherRunOptionsType = {
  readonly preReduced?: boolean;
  readonly routeRecords?: readonly GatherRouteRecordType[];
};

class GatherOutcome {
  private constructor() { /* static-only */ }

  static route(records: readonly GatherRouteRecordType[]): string {
    if (records.length === 0) return 'empty';
    return records.some((record) => record.output === 'error' || record.terminalOutcome === 'failed')
      ? 'error'
      : 'success';
  }
}

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
 * `GatherStrategy`) and `invokeRegisteredNode` (runs a registered node IRI during a
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

  retainsRecordsForFinalize(placement: GatherNodeType): boolean {
    return GatherStrategies.resolve(placement.gather.strategy).retainsRecordsForFinalize;
  }

  initialGather(placement: GatherNodeType, state: NodeStateInterface): void {
    GatherStrategies.resolve(placement.gather.strategy).initial(
      placement.gather,
      state,
      this.#source.accessor,
    );
  }

  async reduceGather(
    placement: GatherNodeType,
    records: readonly GatherRecordType[],
    state: NodeStateInterface,
  ): Promise<void> {
    await GatherStrategies.resolve(placement.gather.strategy).reduce(
      placement.gather,
      Batch.from(records.map((record) => ({
        'id': `${record.source}:${record.index ?? 0}`,
        'state': record,
      }))),
      state,
      this.#source.accessor,
    );
  }

  async runGather(
    placement: GatherNodeType,
    records: readonly GatherRecordType[],
    state: NodeStateInterface,
    dagName: string,
    signal: AbortSignal,
    options: GatherRunOptionsType = {},
  ): Promise<GatherRunResultType> {
    if (options.preReduced !== true) {
      this.initialGather(placement, state);
      await this.reduceGather(placement, records, state);
    }

    const execution = this.composeGatherExecution(state, records, dagName, signal);
    await GatherStrategies.resolve(placement.gather.strategy).finalize(placement.gather, execution);

    return { 'output': GatherOutcome.route(options.routeRecords ?? records) };
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
    nodeIri: string,
    state: NodeStateInterface,
    dagName: string,
    signal: AbortSignal,
  ): Promise<void> {
    if (!this.#source.nodes.has(nodeIri)) {
      throw new DAGError(`Unknown custom node IRI: ${nodeIri}`);
    }
    const dagNode = this.#source.nodes.get(nodeIri);
    if (dagNode === undefined) return;
    const context = this.#source.nodeContext(dagName, nodeIri, signal);
    await this.#source.runNodeOnState(dagNode, state, context);
  }
}
