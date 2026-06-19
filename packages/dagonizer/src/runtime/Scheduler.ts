/**
 * Scheduler: engine-owned monotonic timer provider.
 *
 * Same principle as `Clock`: time is monotonic. All scheduling is in
 * milliseconds-since-arbitrary-origin (derived from `Clock.monotonicMs()`).
 * No wall-clock anywhere.
 *
 * `at(monotonicMs, signal)` resolves at or after the given monotonic
 * timestamp; `after(delayMs, signal)` is the relative-delay form
 * (most use cases). Raw `setTimeout` / `setInterval` are ONLY permitted
 * inside `RealTimeScheduler.ts`.
 *
 * Static class; no instances, no free helpers.
 */

import type { SchedulerProviderInterface } from '../contracts/SchedulerProviderInterface.js';

import { RealTimeScheduler } from './RealTimeScheduler.js';

let activeProvider: SchedulerProviderInterface = new RealTimeScheduler();

/**
 * Engine-owned monotonic timer. All scheduling goes through
 * `Scheduler.current()`. Install a `VirtualScheduler` in tests to drive
 * time deterministically. Call `Scheduler.reset()` to restore the default.
 */
export class Scheduler {
  private constructor() { /* static class */ }

  /**
   * Get the current scheduler provider. Returns the active provider directly;
   * no wrapper is allocated. This call is on the hot path (per node with a
   * timeout, per scatter clone).
   */
  static current(): SchedulerProviderInterface {
    return activeProvider;
  }

  /** Install a scheduler provider. Engine-only; called at boot or in tests. */
  static configure(provider: SchedulerProviderInterface): void {
    activeProvider = provider;
  }

  /**
   * Reset to the default RealTimeScheduler. Cancels all in-flight timers on
   * the current provider before replacing it (R10).
   */
  static reset(): void {
    activeProvider.cancelAll();
    activeProvider = new RealTimeScheduler();
  }
}
