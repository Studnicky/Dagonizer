/**
 * Public scheduling surface returned by `Scheduler.current()`.
 * Identical shape to `SchedulerProvider`; exposed as a separate interface
 * so the distinction between the provider (backend) and the handle (consumer
 * surface) remains explicit.
 */
export interface SchedulerHandle {
  /** Resolves after `delayMs` from now. Cancellation via signal aborts with AbortError. */
  after(delayMs: number, options?: { signal?: AbortSignal }): Promise<void>;
  /** Resolves at the given monotonic-ms timestamp. */
  at(atMs: number, options?: { signal?: AbortSignal }): Promise<void>;
  /** Yields once per interval until `signal` fires. */
  every(intervalMs: number, options?: { signal?: AbortSignal }): AsyncIterable<void>;
  /** Cancel all in-flight scheduled timers (controlled by this scheduler instance). */
  cancelAll(): void;
}
