import type { AbortableOptionsType } from './AbortableOptionsType.js';

/**
 * Options accepted by `execute` / `resume` for cancellation and deadline
 * enforcement. Extends `AbortableOptionsType` for the shared
 * `signal` field; adds `deadlineMs` for a wall-clock budget on the run.
 */
export type ExecuteOptionsType = AbortableOptionsType & {
  /**
   * Wall-clock budget for the entire run in milliseconds. When elapsed, the
   * run is aborted and the result cursor points to the interrupted node.
   * Absent means no deadline.
   */
  deadlineMs?: number;
};