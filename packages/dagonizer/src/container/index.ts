/**
 * Container subpath barrel (`@noocodex/dagonizer/container`).
 *
 * W1 exports: DagTask (engine-side task object for contained DAG execution).
 * W2 exports: DagHost (isolate-side runtime), DagContainerBase (abstract
 *             transport base), ForwardingInstrumentation (instrumentation
 *             forwarding over a channel).
 * W3 will add: WorkerThreadContainer, ForkContainer, ClusterContainer,
 *              SpawnContainer (executor-node package);
 *              WebWorkerContainer (executor-web package).
 */

export { DagTask } from './DagTask.js';
export { DagHost } from './DagHost.js';
export type { DagHostOptions } from './DagHost.js';
export { DagContainerBase } from './DagContainerBase.js';
export type { DagContainerOptions } from './DagContainerBase.js';
export { DagOutcome } from './DagOutcome.js';
export { ForwardingInstrumentation } from './ForwardingInstrumentation.js';
export {
  DAG_CONTAINER_TRANSPORT,
  DAG_CONTAINER_WORKER_DIED,
  TransportErrorCode,
} from './TransportErrorCode.js';
