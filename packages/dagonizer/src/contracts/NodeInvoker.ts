/**
 * NodeInvoker: typed contract for dispatching a registered node back
 * through the engine.
 *
 * Wave 4 will swap the bare `invokeNode` function property on
 * `GatherExecution` to this contract, removing the last callback seam
 * from the gather dispatch path.
 */
export interface NodeInvoker {
  invokeNode(nodeName: string): Promise<void>;
}
