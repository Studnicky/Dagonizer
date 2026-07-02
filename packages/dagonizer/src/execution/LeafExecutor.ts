import type { NodeInterface } from '../contracts/NodeInterface.js';
import { ContextResolver } from '../dag/ContextResolver.js';
import type { SingleNodePlacementType } from '../entities/dag/SingleNode.js';
import type { NodeContextType } from '../entities/node/NodeContext.js';
import { DAGError } from '../errors/index.js';
import type { NodeStateInterface } from '../NodeStateBase.js';

import { PlacementRouter } from './PlacementRouter.js';
import type { RunNodeResultType } from './ScatterDispatch.js';

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
    const nodeIri = ContextResolver.expand(nodeConfig.node, {});
    const dagNode = this.#source.nodes.get(nodeIri);

    if (!dagNode) {
      throw new DAGError(`Unknown node: ${nodeConfig.node}`);
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
}
