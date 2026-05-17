/**
 * RealTimeScheduler — promise-based scheduling backed by `globalThis.setTimeout`.
 *
 * Operates on monotonic-ms timestamps from `Clock.monotonicMs()`. This
 * is the ONLY place in Dagonizer's runtime where platform timer APIs
 * are called.
 *
 * Isomorphic by design: every Node 24+ runtime and every modern browser
 * exposes `setTimeout` / `clearTimeout` on `globalThis`, so the same
 * default works in both. The implementation wraps each delay in a
 * `Promise` and wires its own abort listener — no `node:timers/promises`
 * dependency, so consumers can bundle Dagonizer straight into a browser
 * build (Vite, esbuild, Rollup) without polyfills or aliases.
 */

import type { SchedulerProvider } from '../contracts/SchedulerProvider.js';

import { Clock } from './Clock.js';

type TimerGlobals = typeof globalThis & {
  setTimeout(handler: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
};

const G = globalThis as TimerGlobals;

/**
 * Default `SchedulerProvider`. The single permitted call site for
 * platform timer APIs in the runtime. Works in Node and the browser
 * unmodified — both expose `setTimeout` on `globalThis`.
 */
export class RealTimeScheduler implements SchedulerProvider {
  readonly #activeHandles = new Set<unknown>();

  async after(delayMs: number, signal?: AbortSignal): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (signal?.aborted === true) {
        reject(this.#abortReason(signal));
        return;
      }
      const handle = G.setTimeout(() => {
        this.#activeHandles.delete(handle);
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }, Math.max(0, delayMs));
      this.#activeHandles.add(handle);

      const onAbort = (): void => {
        this.#activeHandles.delete(handle);
        G.clearTimeout(handle);
        signal?.removeEventListener('abort', onAbort);
        reject(this.#abortReason(signal));
      };
      signal?.addEventListener('abort', onAbort, { 'once': true });
    });
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
    for (const handle of this.#activeHandles) {
      G.clearTimeout(handle);
    }
    this.#activeHandles.clear();
  }

  #abortReason(signal?: AbortSignal): Error {
    const reason = signal?.reason;
    if (reason instanceof Error) return reason;
    return new Error(typeof reason === 'string' ? reason : 'aborted');
  }
}
