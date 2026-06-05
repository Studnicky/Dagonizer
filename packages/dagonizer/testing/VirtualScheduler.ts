/**
 * VirtualScheduler: in-memory deterministic scheduler for tests and replay.
 *
 * Stores pending resolvers in a sorted array ordered by monotonic-ms. Time is
 * virtual: no platform timers are used. Advance via `advance(ms)`,
 * `runUntil(atMs)`, or `runAll()`. Pair with `VirtualClockProvider` so
 * `Clock` and the scheduler observe the same virtual time.
 *
 * Test-only. Install via `Scheduler.configure(new VirtualScheduler())`.
 */

import type { SchedulerProvider } from '../dist/contracts/SchedulerProvider.js';

class SchedulerAbortError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SchedulerAbortError';
  }
}

interface PendingType {
  readonly atMs: number;
  readonly resolve: () => void;
  readonly reject: (reason: Error) => void;
  readonly signal: AbortSignal | undefined;
}

export class VirtualScheduler implements SchedulerProvider {
  #virtualNow: number;
  readonly #pending: PendingType[] = [];   // sorted by atMs ascending

  constructor(initialAtMs: number = 0) {
    this.#virtualNow = initialAtMs;
  }

  /** Current virtual time in ms. */
  get virtualNow(): number { return this.#virtualNow; }

  after(delayMs: number, signal?: AbortSignal): Promise<void> {
    return this.at(this.#virtualNow + Math.max(0, delayMs), signal);
  }

  at(atMs: number, signal?: AbortSignal): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (signal?.aborted === true) {
        reject(signal.reason instanceof Error ? signal.reason : new SchedulerAbortError('aborted'));
        return;
      }

      const entry: PendingType = { atMs, resolve, reject, signal };
      this.#insert(entry);

      if (signal !== undefined) {
        signal.addEventListener('abort', () => {
          this.#remove(entry);
          reject(signal.reason instanceof Error ? signal.reason : new SchedulerAbortError('aborted'));
        }, { 'once': true });
      }
    });
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
    while (this.#pending.length > 0) {
      const entry = this.#pending.shift();
      entry?.reject(new SchedulerAbortError('cancelled'));
    }
  }

  /** Test API: advance virtual time by `deltaMs`. */
  advance(deltaMs: number): void { this.runUntil(this.#virtualNow + deltaMs); }

  /** Advance virtual time to `atMs`, resolving all pending entries due by then. */
  runUntil(atMs: number): void {
    let head = this.#pending[0];
    while (head !== undefined && head.atMs <= atMs) {
      this.#pending.shift();
      this.#virtualNow = head.atMs;
      head.resolve();
      head = this.#pending[0];
    }
    this.#virtualNow = atMs;
  }

  /** Resolve all remaining pending entries in order. */
  runAll(): void {
    while (this.#pending.length > 0) {
      const head = this.#pending[0];
      if (head === undefined) break;
      this.runUntil(head.atMs);
    }
  }

  /** Number of active pending entries. Useful in tests. */
  get pendingCount(): number {
    return this.#pending.length;
  }

  #insert(entry: PendingType): void {
    let index = 0;
    while (index < this.#pending.length) {
      const current = this.#pending[index];
      if (current === undefined || current.atMs > entry.atMs) break;
      index++;
    }
    this.#pending.splice(index, 0, entry);
  }

  #remove(entry: PendingType): void {
    const index = this.#pending.indexOf(entry);
    if (index !== -1) this.#pending.splice(index, 1);
  }
}
