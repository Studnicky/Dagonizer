import type { AbortableOptionsInterface } from './AbortableOptionsInterface.js';

/**
 * Options accepted by `execute` / `resume` for cancellation and deadline
 * enforcement. Extends `AbortableOptionsInterface` for the shared
 * `signal` field; adds `deadlineMs` for a wall-clock budget on the run.
 */
export interface ExecuteOptionsInterface extends AbortableOptionsInterface {
  /**
   * Wall-clock budget for the entire run in milliseconds. When elapsed, the
   * run is aborted and the result cursor points to the interrupted node.
   * Absent means no deadline.
   */
  deadlineMs?: number;
}
