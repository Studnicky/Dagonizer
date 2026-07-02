import type { NodeInvokerInterface } from '../contracts/NodeInvokerInterface.js';
import type { NodeStateInterface } from '../NodeStateBase.js';

/**
 * Dispatcher surface `NodeInvoker` needs to run a registered node on a state
 * during a `custom` gather's finalize pass. `Dagonizer` implements it so the
 * gather invoker is a named class with a stable shape rather than an inline
 * object literal that captures the dispatcher in a closure.
 */
export interface NodeInvokerSourceInterface {
  /**
   * Run the named registered node over `state` as a size-1 batch. Throws
   * `DAGError` when the node is not registered. No-op when the lookup races to
   * `undefined` after the existence check.
   */
  invokeRegisteredNode(nodeName: string, state: NodeStateInterface, dagName: string, signal: AbortSignal): Promise<void>;
}

/**
 * `NodeInvokerInterface` implementation handed to a `GatherStrategy` so a
 * `custom` gather can invoke a registered node by name during finalize.
 *
 * Holds stable references to the dispatcher source, the gather's parent state,
 * the DAG name, and the run signal — no injected behaviour closures. The single
 * forwarding method delegates to `Dagonizer.invokeRegisteredNode`, where the
 * private registry and node-on-state machinery are in scope.
 */
export class NodeInvoker implements NodeInvokerInterface {
  readonly #source: NodeInvokerSourceInterface;
  readonly #state: NodeStateInterface;
  readonly #dagName: string;
  readonly #signal: AbortSignal;

  constructor(
    source: NodeInvokerSourceInterface,
    state: NodeStateInterface,
    dagName: string,
    signal: AbortSignal,
  ) {
    this.#source = source;
    this.#state = state;
    this.#dagName = dagName;
    this.#signal = signal;
  }

  async invokeNode(nodeName: string): Promise<void> {
    await this.#source.invokeRegisteredNode(nodeName, this.#state, this.#dagName, this.#signal);
  }
}
