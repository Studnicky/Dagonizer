/**
 * Test utilities. Not part of the runtime; install in tests/replay only.
 *
 *   import { VirtualClockProvider, VirtualScheduler } from '@noocodex/dagonizer/testing';
 *   Clock.configure(new VirtualClockProvider());
 *   Scheduler.configure(new VirtualScheduler());
 */

export { VirtualClockProvider } from './VirtualClock.js';
export { VirtualScheduler } from './VirtualScheduler.js';
export { LoopbackChannel } from './LoopbackChannel.js';
export {
  buildConformanceBundle,
  ConformanceState,
  CONFORMANCE_CONTAINER_ROLE,
  CONFORMANCE_DAG,
  CONFORMANCE_REGISTRY_VERSION,
} from './ConformanceRegistry.js';
export { DagConformance } from './DagConformance.js';
export type {
  DagConformanceHarnessInterface,
  DagConformanceLawInterface,
} from './DagConformance.js';
