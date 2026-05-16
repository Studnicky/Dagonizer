/**
 * Scheduler — engine-owned monotonic timer provider.
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
 * Static class — no instances, no free helpers.
 */

import type { SchedulerHandle } from '../contracts/SchedulerHandle.js';
import type { SchedulerProvider } from '../contracts/SchedulerProvider.js';

import { RealTimeScheduler } from './RealTimeScheduler.js';

class SchedulerHandleImpl implements SchedulerHandle {
  readonly #provider: SchedulerProvider;

  constructor(provider: SchedulerProvider) {
    this.#provider = provider;
  }

  after(delayMs: number, signal?: AbortSignal): Promise<void> {
    return this.#provider.after(delayMs, signal);
  }

  at(atMs: number, signal?: AbortSignal): Promise<void> {
    return this.#provider.at(atMs, signal);
  }

  every(intervalMs: number, signal?: AbortSignal): AsyncIterable<void> {
    return this.#provider.every(intervalMs, signal);
  }

  cancelAll(): void {
    this.#provider.cancelAll();
  }
}

let _provider: SchedulerProvider = new RealTimeScheduler();

/**
 * Engine-owned monotonic timer. All scheduling goes through
 * `Scheduler.current()`. Install a `VirtualScheduler` in tests to drive
 * time deterministically. Call `Scheduler.reset()` to restore the default.
 */
export class Scheduler {
  private constructor() { /* static class */ }

  /** Get the current scheduler handle. */
  static current(): SchedulerHandle {
    return new SchedulerHandleImpl(_provider);
  }

  /** Install a scheduler provider. Engine-only — called at boot or in tests. */
  static configure(provider: SchedulerProvider): void {
    _provider = provider;
  }

  /** Reset to the default RealTimeScheduler. */
  static reset(): void {
    _provider = new RealTimeScheduler();
  }
}
