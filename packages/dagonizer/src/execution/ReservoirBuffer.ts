/**
 * ReservoirBuffer: buffer-then-release pool for reservoir scatter execution.
 *
 * When a ScatterNode has `reservoir: { keyField, capacity }`, items are buffered
 * by key and released as a batch when capacity is reached (capacity release) or
 * when the source is drained (complete-flush). Each released batch of N items
 * is dispatched as one executeBatch call, then acked as one ackBatch call.
 *
 * The non-reservoir path (ScatterWorkerPool) is NOT used here. This class has
 * its own pull/buffer/dispatch loop with the same semaphore semantics as
 * ScatterWorkerPool but at batch granularity.
 */

import type { ScatterInboxItem } from '../entities/scatter/ScatterProgress.js';
import { ExecutionError } from '../errors/index.js';
import type { NodeStateInterface } from '../NodeStateBase.js';

import type { ScatterItemResult } from './ScatterWorkerPool.js';

// V8-stable buffered item shape. Module-private; not exported.
type BufferedItem = {
  index: number;
  item: unknown;
  bufferKey: string;
};

/**
 * Result envelope for a batch execution. One result per item in the batch.
 */
export type ScatterItemBatchResult<TState extends NodeStateInterface> = {
  results: ScatterItemResult<TState>[];
};

/**
 * Adapter contract that `ReservoirBuffer` calls for batch execution and ack.
 * Implemented by `_ScatterPoolDriverImpl` in Dagonizer.ts.
 */
export interface ReservoirDriverInterface<TState extends NodeStateInterface> {
  executeBatch(items: { index: number; item: unknown; bufferKey: string }[]): Promise<ScatterItemBatchResult<TState>>;
  ackBatch(batchResult: ScatterItemBatchResult<TState>): Promise<void>;
}

/**
 * Options for constructing a `ReservoirBuffer`.
 */
export type ReservoirBufferOptions = {
  concurrencyLimit: number;
  inbox: ScatterInboxItem[];
  freshIter: AsyncIterator<unknown>;
  nextIndex: number;
  signal: AbortSignal | null;
  reservoir: { keyField: string; capacity: number; idleMs?: number };
  accessor: { get(obj: unknown, path: string): unknown };
};

/**
 * Bounded reservoir buffer for scatter execution.
 *
 * Constructed with fixed options and a `ReservoirDriverInterface`. Call
 * `drain()` to drive the buffer to completion.
 *
 * V8 shape stability: all fields are initialised in declaration order in the
 * constructor. No fields are added or deleted after construction.
 */
export class ReservoirBuffer<TState extends NodeStateInterface> {
  readonly #driver: ReservoirDriverInterface<TState>;
  readonly #concurrencyLimit: number;
  readonly #inbox: ScatterInboxItem[];
  readonly #freshIter: AsyncIterator<unknown>;
  readonly #signal: AbortSignal | null;
  readonly #reservoir: { keyField: string; capacity: number; idleMs?: number };
  readonly #accessor: { get(obj: unknown, path: string): unknown };
  readonly #activeBuffers: Map<string, BufferedItem[]>;
  readonly #poolErrors: unknown[];
  #nextIndex: number;
  #freshDone: boolean;
  #activeWorkers: number;
  #slotResolve: (() => void) | null;

  constructor(driver: ReservoirDriverInterface<TState>, options: ReservoirBufferOptions) {
    this.#driver = driver;
    this.#concurrencyLimit = options.concurrencyLimit;
    this.#inbox = options.inbox;
    this.#freshIter = options.freshIter;
    this.#signal = options.signal;
    this.#reservoir = options.reservoir;
    this.#accessor = options.accessor;
    this.#activeBuffers = new Map<string, BufferedItem[]>();
    this.#poolErrors = [];
    this.#nextIndex = options.nextIndex;
    this.#freshDone = false;
    this.#activeWorkers = 0;
    this.#slotResolve = null;
  }

  /** Resolve any pending waitForSlot promise when a slot becomes free. */
  #releaseSlot(): void {
    const fn = this.#slotResolve;
    this.#slotResolve = null;
    fn?.();
  }

  /** Resolve when a batch slot is free (blocks when pool is at capacity). */
  #waitForSlot(): Promise<void> {
    return new Promise<void>((res) => { this.#slotResolve = res; });
  }

  #workerDone(): void {
    this.#activeWorkers--;
    this.#releaseSlot();
  }

  #spawnBatchWorker(items: BufferedItem[]): void {
    this.#activeWorkers++;
    const workerPromise = this.#driver.executeBatch(items).then(
      (batchResult) => this.#driver.ackBatch(batchResult).then(
        () => { this.#workerDone(); },
        (err: unknown) => {
          this.#poolErrors.push(err);
          this.#workerDone();
        },
      ),
      (err: unknown) => {
        this.#poolErrors.push(err);
        this.#workerDone();
      },
    );
    workerPromise.catch(() => { /* handled above */ });
  }

  /**
   * On resume: rebuild buffers from inbox items that have `bufferKey` set.
   * Release any group already at capacity immediately.
   */
  replayBuffers(): void {
    const { keyField, capacity } = this.#reservoir;
    for (const inboxItem of this.#inbox) {
      // A reservoir run always stamps `bufferKey` when it buffers an item, so a
      // resumed inbox carries it. The fallback recomputes the key from the item
      // (defense-in-depth: a checkpoint written by a prior non-reservoir run, or
      // any future pre-scan path) so an inbox item is never silently dropped.
      const key = inboxItem.bufferKey ?? String(this.#accessor.get(inboxItem.item, keyField) ?? '');
      const buf = this.#activeBuffers.get(key);
      const buffered: BufferedItem = { 'index': inboxItem.index, 'item': inboxItem.item, 'bufferKey': key };
      if (buf !== undefined) {
        buf.push(buffered);
      } else {
        this.#activeBuffers.set(key, [buffered]);
      }
    }
    // Release any groups already at capacity (synchronous dispatch).
    for (const [key, buf] of this.#activeBuffers) {
      if (buf.length >= capacity) {
        const batch = buf.splice(0, capacity);
        if (buf.length === 0) this.#activeBuffers.delete(key);
        this.#spawnBatchWorker(batch);
      }
    }
  }

  /**
   * Drive the reservoir to completion: pull items, buffer by key, release when
   * capacity is reached, flush all remaining buffers on source exhaustion.
   */
  async drain(): Promise<void> {
    // Resume path: rebuild buffers from inbox items with bufferKey.
    this.replayBuffers();

    const { keyField, capacity } = this.#reservoir;

    // Pull loop: fill buffers until source is exhausted, errors accumulate, or aborted.
    while (this.#poolErrors.length === 0 && this.#signal?.aborted !== true) {
      if (this.#activeWorkers >= this.#concurrencyLimit) {
        await this.#waitForSlot();
        continue;
      }
      if (this.#freshDone) break;

      const step = await this.#freshIter.next();
      if (step.done) {
        this.#freshDone = true;
        break;
      }

      const itemValue = step.value;
      const index = this.#nextIndex++;

      // Resolve buffer key from item.
      const rawKey = this.#accessor.get(itemValue, keyField);
      const bufferKey = String(rawKey ?? '');

      // Push to inbox with bufferKey set (at-least-once: durable before buffering).
      this.#inbox.push({ index, 'item': itemValue, bufferKey });

      // Buffer the item by key.
      const existing = this.#activeBuffers.get(bufferKey);
      const buffered: BufferedItem = { index, "item": itemValue, bufferKey };
      if (existing !== undefined) {
        existing.push(buffered);
        if (existing.length >= capacity) {
          // Capacity release: dispatch this key's buffer as a batch.
          const batch = existing.splice(0, capacity);
          if (existing.length === 0) this.#activeBuffers.delete(bufferKey);
          this.#spawnBatchWorker(batch);
        }
      } else {
        this.#activeBuffers.set(bufferKey, [buffered]);
        if (capacity === 1) {
          // Capacity of 1: release immediately.
          const batch = [buffered];
          this.#activeBuffers.delete(bufferKey);
          this.#spawnBatchWorker(batch);
        }
      }
    }

    // Complete-flush: source drained, dispatch every non-empty buffer as partial batch.
    if (this.#freshDone && this.#poolErrors.length === 0 && this.#signal?.aborted !== true) {
      for (const [key, buf] of this.#activeBuffers) {
        if (buf.length > 0) {
          // Wait for a slot before dispatching.
          while (this.#activeWorkers >= this.#concurrencyLimit) {
            await this.#waitForSlot();
          }
          const batch = [...buf];
          this.#activeBuffers.delete(key);
          this.#spawnBatchWorker(batch);
        }
      }
    }

    // Wait for all in-flight batch workers to settle.
    while (this.#activeWorkers > 0) {
      await this.#waitForSlot();
    }

    // Abort: throw before caller calls ScatterCheckpoint.clear() so checkpoint is preserved.
    if (this.#signal?.aborted === true && this.#poolErrors.length === 0) {
      throw ExecutionError.fromSignal(this.#signal);
    }

    if (this.#poolErrors.length > 0) {
      const first = this.#poolErrors[0];
      throw first instanceof Error ? first : new ExecutionError(String(first));
    }
  }
}
