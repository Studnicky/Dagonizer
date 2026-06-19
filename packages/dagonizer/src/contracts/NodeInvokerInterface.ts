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
  invokeNode(nodeName: string): Promise<void>;
}
