import type { AbortableOptionsType } from './AbortableOptionsType.js';

/** Low-level scheduler backend. Implement to provide custom scheduling. */
export interface SchedulerProviderInterface {
  /** Resolves after `delayMs` from now. Cancellation via signal aborts with AbortError. */
  after(delayMs: number, options?: AbortableOptionsType): Promise<void>;
  /** Resolves at the given monotonic-ms timestamp. */
  at(atMs: number, options?: AbortableOptionsType): Promise<void>;
  /** Yields once per interval until `signal` fires. */
  every(intervalMs: number, options?: AbortableOptionsType): AsyncIterable<void>;
  /** Cancel all in-flight scheduled timers (controlled by this scheduler instance). */
  cancelAll(): void;
}
