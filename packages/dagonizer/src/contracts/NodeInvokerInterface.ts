/**
 * NodeInvokerInterface: typed contract for dispatching a registered node back
 * through the engine.
 *
 * `GatherExecutionType.invoker` satisfies this contract; `custom`
 * gather strategies call `invoker.invokeNode(nodeIri)` to dispatch a
 * registered node back through the engine without a direct reference
 * to the dispatcher.
 */
export interface NodeInvokerInterface {
  /** Dispatch the registered node `nodeIri` back through the engine. */
  invokeNode(nodeIri: string): Promise<void>;
}
