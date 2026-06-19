/**
 * NodeInvokerInterface: typed contract for dispatching a registered node back
 * through the engine.
 *
 * `GatherExecutionType.invoker` satisfies this contract; `custom`
 * gather strategies call `invoker.invokeNode(name)` to dispatch a
 * registered node back through the engine without a direct reference
 * to the dispatcher.
 */
export interface NodeInvokerInterface {
  /** Dispatch the registered node `nodeName` back through the engine. */
  invokeNode(nodeName: string): Promise<void>;
}
