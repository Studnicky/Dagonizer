/**
 * virtual-clock/dags: re-exports the virtual time providers and RetryPolicy
 * so examples/virtual-clock.ts can import them from a single location.
 *
 * Pure module: no side effects, no freestanding functions, no dispatcher.
 * Imported by examples/virtual-clock.ts (the executable entry point).
 */

// #region virtual-time
export { BackoffStrategy, Clock, RetryPolicy, Scheduler } from '@studnicky/dagonizer/runtime';
export { VirtualClockProvider, VirtualScheduler } from '@studnicky/dagonizer/testing';
// #endregion virtual-time
