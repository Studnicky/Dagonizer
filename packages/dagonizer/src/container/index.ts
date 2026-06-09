/**
 * Container subpath barrel (`@noocodex/dagonizer/container`).
 *
 * Exports the full container surface: pool-lifecycle base, channel request
 * correlator, isolate-side host runtime, task and outcome value types,
 * instrumentation forwarding, and transport error codes.
 *
 * Subclasses extend DagContainerBase<TState, TWorker> and implement the
 * four abstract seams: createEntry, attachDeathListeners, terminateWorker,
 * awaitWorkerExit. The base owns pool growth, semaphore waiting, lazy init,
 * death eviction, and graceful shutdown.
 */

export { DagTask } from './DagTask.js';
export { DagHost } from './DagHost.js';
export type { DagHostOptions } from './DagHost.js';
export { DagContainerBase } from './DagContainerBase.js';
export type {
  DagContainerOptions,
  InitMessageShape,
  InstrumentationSink,
  PoolEntry,
} from './DagContainerBase.js';
export { DEFAULT_SHUTDOWN_GRACE_MS } from './DagContainerBase.js';
export { DagContainerError } from './DagContainerError.js';
export { DagOutcome } from './DagOutcome.js';
export { ForwardingInstrumentation } from './ForwardingInstrumentation.js';
export {
  DAG_CONTAINER_TRANSPORT,
  DAG_CONTAINER_WORKER_DIED,
  TransportErrorCode,
} from './TransportErrorCode.js';
