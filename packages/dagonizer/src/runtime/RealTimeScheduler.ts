/**
 * RealTimeScheduler: promise-based scheduling backed by `globalThis.setTimeout`.
 *
 * Operates on monotonic-ms timestamps from `Clock.monotonicMs()`. This
 * is the ONLY place in Dagonizer's runtime where platform timer APIs
 * are called.
 *
 * Isomorphic by design: every Node 24+ runtime and every modern browser
 * exposes `setTimeout` / `clearTimeout` on `globalThis`, so the same
 * default works in both. The implementation wraps each delay in a
 * `Promise` and wires its own abort listener; no `node:timers/promises`
 * dependency, so consumers can bundle Dagonizer straight into a browser
 * build (Vite, esbuild, Rollup) without polyfills or aliases.
 */

import type { AbortableOptionsType } from '../contracts/AbortableOptionsType.js';
import type { SchedulerProviderInterface } from '../contracts/SchedulerProviderInterface.js';
import { ExecutionError } from '../errors/DAGError.js';

import { Clock } from './Clock.js';

// Platform timers, read straight off `globalThis` (already typed by the
// platform lib — no cast). The handle stays opaque as the platform's own
// `ReturnType`, identical between Node and the browser at this call site.
type TimerHandle = ReturnType<typeof globalThis.setTimeout>;

/**
 * Default `SchedulerProviderInterface`. The single permitted call site for
 * platform timer APIs in the runtime. Works in Node and the browser
 * unmodified; both expose `setTimeout` on `globalThis`.
 */
export class RealTimeScheduler implements SchedulerProviderInterface {
  readonly #activeHandles = new Set<TimerHandle>();

  async after(delayMs: number, options?: AbortableOptionsType): Promise<void> {
    const signal = options?.signal;
    return new Promise<void>((resolve, reject) => {
      if (signal?.aborted === true) {
        reject(ExecutionError.ofSignal(signal));
        return;
      }
      const handle = globalThis.setTimeout(() => {
        this.#activeHandles.delete(handle);
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }, Math.max(0, delayMs));
      this.#activeHandles.add(handle);

      const onAbort = (): void => {
        this.#activeHandles.delete(handle);
        globalThis.clearTimeout(handle);
        signal?.removeEventListener('abort', onAbort);
        reject(ExecutionError.ofSignal(signal));
      };
      signal?.addEventListener('abort', onAbort, { 'once': true });
    });
  }

  async at(atMs: number, options?: AbortableOptionsType): Promise<void> {
    return this.after(Math.max(0, atMs - Clock.monotonicMs()), options);
  }

  async *every(intervalMs: number, options?: AbortableOptionsType): AsyncIterable<void> {
    const signal = options?.signal;
    while (signal?.aborted !== true) {
      // Track the in-flight handle so a consumer `break` (which triggers the
      // generator's implicit `return`, not a throw) cancels the pending timer
      // immediately rather than leaving it to fire naturally after `intervalMs`.
      // The handle is `TimerHandle | undefined` until the timer is scheduled.
      let pendingHandle: TimerHandle | undefined;
      try {
        await new Promise<void>((resolve, reject) => {
          if (signal?.aborted === true) {
            reject(new Error('aborted'));
            return;
          }
          const handle = globalThis.setTimeout(() => {
            this.#activeHandles.delete(handle);
            signal?.removeEventListener('abort', onAbort);
            resolve();
          }, Math.max(0, intervalMs));
          pendingHandle = handle;
          this.#activeHandles.add(handle);
          const onAbort = (): void => {
            this.#activeHandles.delete(handle);
            globalThis.clearTimeout(handle);
            signal?.removeEventListener('abort', onAbort);
            reject(new Error('aborted'));
          };
          signal?.addEventListener('abort', onAbort, { 'once': true });
        });
      } catch {
        return;
      } finally {
        // Clear the timer if the consumer broke the for-await loop before the
        // timer fired (pendingHandle was already deleted on normal completion).
        if (pendingHandle !== undefined && this.#activeHandles.has(pendingHandle)) {
          this.#activeHandles.delete(pendingHandle);
          globalThis.clearTimeout(pendingHandle);
        }
      }
      yield;
    }
  }

  cancelAll(): void {
    for (const handle of this.#activeHandles) {
      globalThis.clearTimeout(handle);
    }
    this.#activeHandles.clear();
  }
}
