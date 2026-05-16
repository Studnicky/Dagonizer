/**
 * RealTimeScheduler — wraps `node:timers/promises` for promise-based scheduling.
 *
 * Operates on monotonic-ms timestamps from `Clock.monotonicMs()`. This is
 * the ONLY place in Dagonizer's runtime where platform timer APIs are called.
 */

import { setTimeout as sleep } from 'node:timers/promises';

import type { SchedulerProvider } from '../contracts/SchedulerProvider.js';

import { Clock } from './Clock.js';

/**
 * Default `SchedulerProvider` backed by `node:timers/promises`.
 * This is the only permitted call site for platform timer APIs in the runtime.
 */
export class RealTimeScheduler implements SchedulerProvider {
  readonly #activeControllers: Set<AbortController> = new Set();

  async after(delayMs: number, signal?: AbortSignal): Promise<void> {
    const controller = new AbortController();
    this.#activeControllers.add(controller);
    const composed = this.#compose(controller.signal, signal);
    try {
      await sleep(Math.max(0, delayMs), undefined, { 'signal': composed });
    } finally {
      this.#activeControllers.delete(controller);
    }
  }

  async at(atMs: number, signal?: AbortSignal): Promise<void> {
    return this.after(Math.max(0, atMs - Clock.monotonicMs()), signal);
  }

  async *every(intervalMs: number, signal?: AbortSignal): AsyncIterable<void> {
    while (signal?.aborted !== true) {
      try {
        await this.after(intervalMs, signal);
      } catch {
        return;
      }
      yield;
    }
  }

  cancelAll(): void {
    for (const controller of this.#activeControllers) {
      controller.abort();
    }
    this.#activeControllers.clear();
  }

  #compose(internal: AbortSignal, external?: AbortSignal): AbortSignal {
    if (external === undefined) return internal;
    return AbortSignal.any([internal, external]);
  }
}
