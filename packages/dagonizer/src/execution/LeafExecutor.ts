import type { NodeInterface } from '../contracts/NodeInterface.js';
import type { SingleNodePlacementType } from '../entities/dag/SingleNode.js';
import type { NodeContextType } from '../entities/node/NodeContext.js';
import { DAGError } from '../errors/index.js';
import type { NodeStateInterface } from '../NodeStateBase.js';

import { PlacementRouter } from './PlacementRouter.js';
import type { RunNodeResultType } from './ScatterDispatch.js';

/** Max registered node IRIs listed in an "Unknown node" error message before eliding the rest. */
const UNKNOWN_NODE_LISTED_IRIS = 5;

/**
 * Dispatcher surface `LeafExecutor` needs to execute a `SingleNode` placement.
 * `Dagonizer` implements this interface so `LeafExecutor` depends only on a
 * narrow port, not on the whole dispatcher.
 */
export interface LeafExecutorSourceInterface {
  readonly nodes: ReadonlyMap<string, NodeInterface<NodeStateInterface, string>>;
  withNodeTimeout<TResult>(
    node: NodeInterface<NodeStateInterface, string>,
    signal: AbortSignal,
    fn: (sig: AbortSignal) => Promise<TResult>,
  ): Promise<TResult>;
  nodeContext(dagName: string, placementName: string, signal: AbortSignal): NodeContextType;
  runNodeOnState(node: NodeInterface<NodeStateInterface, string>, state: NodeStateInterface, context: NodeContextType): Promise<string>;
}

/**
 * `SingleNode` placement executor.
 *
 * Extracts `executeSingleNode` from `Dagonizer` into a focused domain module.
 * Depends only on the narrow `LeafExecutorSourceInterface` port: node registry,
 * timeout wrapper, context builder, and node-on-state runner.
 *
 * The timeout wrapper provides the `nodeSignal` (always a valid `AbortSignal`)
 * used to build the node context, so `LeafExecutor` has no direct dependency
 * on `Signal`.
 */
export class LeafExecutor {
  readonly #source: LeafExecutorSourceInterface;

  constructor(source: LeafExecutorSourceInterface) {
    this.#source = source;
  }

  async executeSingleNode(
    nodeConfig: SingleNodePlacementType,
    state: NodeStateInterface,
    dagName: string,
    signal: AbortSignal,
  ): Promise<RunNodeResultType> {
    const dagNode = this.#source.nodes.get(nodeConfig.node);

    if (!dagNode) {
      throw new DAGError(this.#unknownNodeMessage(nodeConfig.node));
    }

    const output = await this.#source.withNodeTimeout(dagNode, signal, (nodeSignal) => {
      const context = this.#source.nodeContext(dagName, nodeConfig.name, nodeSignal);
      return this.#source.runNodeOnState(dagNode, state, context);
    });

    const nextStage = nodeConfig.outputs[output];

    if (nextStage === undefined) {
      throw new DAGError(
        `Node ${dagNode.name} returned output '${output}' but node ${nodeConfig.name} has no routing for it. `
        + `Available outputs: ${Object.keys(nodeConfig.outputs).join(', ')}`,
      );
    }

    // A leaf node routes on its own returned output token (validated above) and
    // produces no inner intermediates. Assemble the shared result envelope.
    return PlacementRouter.envelope(nodeConfig.name, output, nextStage, state, []);
  }

  /**
   * Build an actionable "Unknown node" message for `nodeRef`: lists up to
   * `UNKNOWN_NODE_LISTED_IRIS` of the currently registered node IRIs so the
   * author can spot a typo or a missing `dispatcher.registerNode(...)` call.
   */
  #unknownNodeMessage(nodeRef: string): string {
    const registeredIris = [...this.#source.nodes.keys()];
    if (registeredIris.length === 0) {
      return `Unknown node: '${nodeRef}'. No nodes are registered. Did you forget dispatcher.registerNode(...)?`;
    }
    const shown = registeredIris.slice(0, UNKNOWN_NODE_LISTED_IRIS).join(', ');
    const elided = registeredIris.length > UNKNOWN_NODE_LISTED_IRIS ? ', …' : '';
    return `Unknown node: '${nodeRef}'. Registered node IRIs: ${shown}${elided}. Did you forget dispatcher.registerNode(...)?`;
  }
}
