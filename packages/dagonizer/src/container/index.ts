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
// CON-13: DagTaskInterface canonical source (class-shape interface taxonomy).
export type { DagTaskInterface } from './DagTask.js';
export { DagHost } from './DagHost.js';
export type { DagHostOptions } from './DagHost.js';
export { DagContainerBase } from './DagContainerBase.js';
export type {
  DagContainerOptions,
  InitMessageShape,
  PoolEntry,
} from './DagContainerBase.js';
export { DEFAULT_SHUTDOWN_GRACE_MS } from './DagContainerBase.js';
export { DagContainerError } from './DagContainerError.js';
export { DagOutcome } from './DagOutcome.js';
// CON-13: DagOutcomeInterface canonical source (entity-narrowing interface taxonomy).
export type { DagOutcomeInterface } from './DagOutcome.js';
export { ForwardingInstrumentation } from './ForwardingInstrumentation.js';
// CTR-4: InstrumentationSink re-exported from its contracts/ source, not via
// the implementation file. Mirrors the runtime/ barrel pattern.
export type { InstrumentationSink } from '../contracts/InstrumentationSink.js';
export {
  DAG_CONTAINER_TRANSPORT,
  DAG_CONTAINER_WORKER_DIED,
  TransportErrorCode,
} from './TransportErrorCode.js';
