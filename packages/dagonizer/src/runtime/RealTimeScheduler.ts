/**
 * RealTimeScheduler: promise-based scheduling backed by `@studnicky/scheduler`'s
 * `RealTimeScheduler` (itself `setTimeout`/`setInterval`-backed).
 *
 * Substrate's `SchedulerProviderType` is callback-and-handle based
 * (`scheduleAt(atMs, fire): ScheduledTaskType`, `cancel()`); it has no
 * relative-delay `after()` and no `AbortSignal` integration. This class
 * subclasses substrate's `RealTimeScheduler` and adds exactly that: a
 * Promise/`AbortSignal` layer built on the inherited `scheduleAt` +
 * `ScheduledTaskType.cancel()` primitives. This is the class-extension seam
 * this repo mandates for genuinely new behavior — no wrapper functions, no
 * callbacks passed in.
 *
 * Isomorphic by design: substrate's `RealTimeScheduler` reads `setTimeout` /
 * `setInterval` straight off the module scope, which resolves to
 * `globalThis` in both Node 24+ and every modern browser.
 */

import * as SchedulerPkg from '@studnicky/scheduler';

import type { AbortableOptionsType } from '../contracts/AbortableOptionsType.js';
import type { SchedulerProviderInterface } from '../contracts/SchedulerProviderInterface.js';
import { DAGError } from '../errors/DAGError.js';

/**
 * Default `SchedulerProviderInterface`. Adds `after`/`at`/`every` (Promise +
 * `AbortSignal` based) on top of substrate's callback-based `scheduleAt`.
 * Works in Node and the browser unmodified.
 */
export class RealTimeScheduler extends SchedulerPkg.RealTimeScheduler implements SchedulerProviderInterface {
  constructor() {
    super();
  }

  async after(delayMs: number, options?: AbortableOptionsType): Promise<void> {
    const signal = options?.signal;
    return new Promise<void>((resolve, reject) => {
      if (signal?.aborted === true) {
        reject(DAGError.ofSignal(signal));
        return;
      }

      const task = this.scheduleAt(Date.now() + Math.max(0, delayMs), () => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      });

      const onAbort = (): void => {
        task.cancel();
        signal?.removeEventListener('abort', onAbort);
        reject(DAGError.ofSignal(signal));
      };
      signal?.addEventListener('abort', onAbort, { 'once': true });
    });
  }

  async at(atMs: number, options?: AbortableOptionsType): Promise<void> {
    return this.after(Math.max(0, atMs - Date.now()), options);
  }

  async *every(intervalMs: number, options?: AbortableOptionsType): AsyncIterable<void> {
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
}
