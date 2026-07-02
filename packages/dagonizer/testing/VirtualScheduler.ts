/**
 * VirtualScheduler: in-memory deterministic scheduler for tests and replay.
 *
 * Test-only. Install via `Scheduler.configure(new VirtualScheduler())`.
 *
 * Backed by `@studnicky/scheduler`'s min-heap `VirtualScheduler`, paired with
 * its own `VirtualTimeCounter`. Time is virtual: no platform timers are used.
 * Advance via `advance(ms)` (inherited), `runUntil(atMs)` (inherited), or
 * `runAll()` (inherited). This subclass adds the Promise/`AbortSignal` layer
 * (`after`/`at`/`every`) that substrate's callback-based `scheduleAt` does
 * not provide, plus abort-aware bookkeeping so `cancelAll()` rejects every
 * pending `after`/`at` promise (substrate's `cancelAll()` only marks tasks
 * cancelled — it never invokes their `fire` callback).
 */

import { VirtualTimeCounter } from '@studnicky/clock';
import * as SchedulerPkg from '@studnicky/scheduler';

import type { SchedulerProviderInterface } from '../dist/contracts/SchedulerProviderInterface.js';

class SchedulerAbortError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AbortError';
  }
}

type PendingRejectType = {
  readonly reject: (reason: Error) => void;
};

export class VirtualScheduler extends SchedulerPkg.VirtualScheduler implements SchedulerProviderInterface {
  readonly #counter: VirtualTimeCounter;
  readonly #pending = new Map<string, PendingRejectType>();

  constructor(initialAtMs: number = 0) {
    const counter = VirtualTimeCounter.create({ 'startMs': initialAtMs });
    super(counter);
    this.#counter = counter;
  }

  /** Current virtual time in ms. */
  get virtualNow(): number { return this.#counter.nowMs(); }

  /** Number of active pending `after`/`at` entries. Useful in tests. */
  get pendingCount(): number { return this.#pending.size; }

  after(delayMs: number, options?: { signal?: AbortSignal }): Promise<void> {
    return this.at(this.#counter.nowMs() + Math.max(0, delayMs), options);
  }

  at(atMs: number, options?: { signal?: AbortSignal }): Promise<void> {
    const signal = options?.signal;
    return new Promise<void>((resolve, reject) => {
      if (signal?.aborted === true) {
        reject(signal.reason instanceof Error ? signal.reason : new SchedulerAbortError('aborted'));
        return;
      }

      const task = this.scheduleAt(atMs, () => {
        this.#pending.delete(task.id);
        signal?.removeEventListener('abort', onAbort);
        resolve();
      });
      this.#pending.set(task.id, { reject });

      const onAbort = (): void => {
        this.#pending.delete(task.id);
        task.cancel();
        signal?.removeEventListener('abort', onAbort);
        reject(signal?.reason instanceof Error ? signal.reason : new SchedulerAbortError('aborted'));
      };
      signal?.addEventListener('abort', onAbort, { 'once': true });
    });
  }

  async *every(intervalMs: number, options?: { signal?: AbortSignal }): AsyncIterable<void> {
    const signal = options?.signal;
    while (signal?.aborted !== true) {
      try {
        await this.after(intervalMs, options);
      } catch {
        return;
      }
      yield;
    }
  }

  override cancelAll(): void {
    super.cancelAll();
    for (const entry of this.#pending.values()) {
      entry.reject(new SchedulerAbortError('cancelled'));
    }
    this.#pending.clear();
  }
}
