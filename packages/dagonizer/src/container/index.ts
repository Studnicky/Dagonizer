/**
 * Container subpath barrel (`@studnicky/dagonizer/container`).
 *
 * Exports the full container surface: pool-lifecycle base, channel request
 * correlator, isolate-side host runtime, task and outcome value types,
 * and transport error codes.
 *
 * Subclasses extend DagContainerBase<TState, TWorker> and implement the
 * four abstract seams: composeEntry, attachDeathListeners, terminateWorker,
 * awaitWorkerExit. The base owns pool growth, semaphore waiting, lazy init,
 * death eviction, and graceful shutdown.
 */

export { BaseMessageChannel } from './BaseMessageChannel.js';
export { DagTask } from './DagTask.js';
export type { DagTaskInterface } from '../contracts/DagTaskInterface.js';
export { DagHost } from './DagHost.js';
export type { DagHostOptionsType } from './DagHost.js';
export { DagContainerBase, DAG_CONTAINER_DEFAULTS } from './DagContainerBase.js';
export type {
  DagContainerOptionsType,
  InitMessageShapeType,
  PoolEntryType,
} from './DagContainerBase.js';
export { DEFAULT_SHUTDOWN_GRACE_MS } from './DagContainerBase.js';
export { DagContainerError } from './DagContainerError.js';
export { DagOutcome } from './DagOutcome.js';
export type { BatchRunResultType } from './DagOutcome.js';
export type { DagOutcomeType } from '../contracts/DagOutcomeType.js';
export {
  DAG_CONTAINER_TRANSPORT,
  DAG_CONTAINER_WORKER_DIED,
  TransportErrorCode,
} from './TransportErrorCode.js';
