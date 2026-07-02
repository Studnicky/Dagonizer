/**
 * ReservoirBuffer: buffer-then-release pool for reservoir scatter execution.
 *
 * When a ScatterNode has `reservoir: { keyField, capacity }`, items are buffered
 * by key and released as a batch when capacity is reached (capacity release) or
 * when the source is drained (complete-flush). Each released batch of N items
 * is dispatched as one executeBatch call, then acked as one ackBatch call.
 *
 * When `reservoir.idleMs` is set, a key whose buffer is non-empty and has
 * received no new item for `idleMs` releases its partial batch (idle release).
 * All idle timers are cancelled when `drain()` transitions past the pull loop,
 * preventing any idle release from firing during complete-flush or after drain.
 *
 * The non-reservoir path (ScatterWorkerPool) is NOT used here. This class has
 * its own pull/buffer/dispatch loop at batch granularity, delegating
 * concurrency gating to an owned `Semaphore` instance (one permit per
 * `concurrencyLimit` slot) — the same real-semaphore approach ScatterWorkerPool
 * uses at item granularity. Every batch dispatch (pull-loop capacity release,
 * idle release, complete-flush release, and resume replay) acquires a permit
 * before executing and releases it once the batch settles, so `concurrencyLimit`
 * is a hard cap on concurrently in-flight batches everywhere, including resume
 * replay and idle-timer releases.
 */

import { Semaphore } from '@studnicky/concurrency/semaphore';

import type { ReservoirDriverInterface } from '../contracts/ReservoirDriver.js';
import type { StateAccessorInterface } from '../contracts/StateAccessorInterface.js';
import type { ScatterInboxItemType } from '../entities/scatter/ScatterProgress.js';
import { DAGError } from '../errors/index.js';
import { Scheduler } from '../runtime/Scheduler.js';

// V8-stable buffered item shape. Module-private; not exported.
type BufferedItem = {
  index: number;
  item: unknown;
  bufferKey: string;
};

/**
 * Options for constructing a `ReservoirBuffer`.
 */
export type ReservoirBufferOptionsType = {
  concurrencyLimit: number;
  inbox: ScatterInboxItemType[];
  freshIter: AsyncIterator<unknown>;
  nextIndex: number;
  signal: AbortSignal | null;
  reservoir: { keyField: string; capacity: number; idleMs?: number };
  accessor: StateAccessorInterface;
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
export class ReservoirBuffer {
  readonly #driver: ReservoirDriverInterface;
  readonly #semaphore: Semaphore;
  readonly #inbox: ScatterInboxItemType[];
  readonly #freshIter: AsyncIterator<unknown>;
  readonly #signal: AbortSignal | null;
  readonly #reservoir: { keyField: string; capacity: number; idleMs?: number };
  readonly #accessor: StateAccessorInterface;
  readonly #activeBuffers: Map<string, BufferedItem[]>;
  readonly #poolErrors: unknown[];
  readonly #keyGeneration: Map<string, number>;
  readonly #idleAbort: AbortController | null;
  readonly #workerPromises: Promise<void>[];
  #nextIndex: number;
  #freshDone: boolean;

  constructor(driver: ReservoirDriverInterface, options: ReservoirBufferOptionsType) {
    this.#driver = driver;
    this.#semaphore = Semaphore.builder().withPermits(options.concurrencyLimit).build();
    this.#inbox = options.inbox;
    this.#freshIter = options.freshIter;
    this.#signal = options.signal;
    this.#reservoir = options.reservoir;
    this.#accessor = options.accessor;
    this.#activeBuffers = new Map<string, BufferedItem[]>();
    this.#poolErrors = [];
    this.#keyGeneration = new Map<string, number>();
    this.#idleAbort = options.reservoir.idleMs !== undefined ? new AbortController() : null;
    this.#workerPromises = [];
    this.#nextIndex = options.nextIndex;
    this.#freshDone = false;
  }

  /**
   * Resolve the reservoir buffer key from a scatter item via the canonical
   * `StateAccessorInterface`. Scatter items are `unknown` at the buffer boundary; the
   * accessor reads paths only on objects, so a non-object item yields `null`
   * (an empty buffer key, grouped under the `''` partition).
   */
  #resolveKey(item: unknown, keyField: string): unknown {
    if (typeof item !== 'object' || item === null) return null;
    return this.#accessor.get(item, keyField);
  }

  /**
   * Block until at least one semaphore permit is available, without holding
   * it — used by the pull/flush loops to pace pulling ahead of dispatch
   * capacity. Acquires then immediately releases: functionally "wait for a
   * free slot," with no ownership transferred to the caller.
   */
  async #waitForCapacity(): Promise<void> {
    const release = await this.#semaphore.acquire();
    release();
  }

  /**
   * Acquire a semaphore permit, execute the batch, ack it, then release the
   * permit once the execute+ack cycle settles. The acquire is awaited inside
   * this method (fire-and-forget from the caller's perspective) so every call
   * site — pull-loop capacity release, idle release, complete-flush release,
   * and resume replay — is gated by the same real concurrency cap.
   */
  #spawnBatchWorker(items: BufferedItem[]): void {
    const workerPromise = this.#semaphore.acquire().then((release) =>
      this.#driver.executeBatch(items).then(
        (batchResult) => this.#driver.ackBatch(batchResult).then(
          () => { release(); },
          (err: unknown) => {
            this.#poolErrors.push(err);
            release();
          },
        ),
        (err: unknown) => {
          this.#poolErrors.push(err);
          release();
        },
      ),
    );
    this.#workerPromises.push(workerPromise);
  }

  /**
   * Bump the generation for a key and arm a fresh idle timer for the new
   * generation. If the timer fires and the generation is still current, release
   * the key's partial buffer. Called only when `idleMs` is set.
   */
  #armIdleTimer(key: string): void {
    const idleMs = this.#reservoir.idleMs;
    // Guard: only arm when idleMs is configured and idleAbort is live.
    if (idleMs === undefined || this.#idleAbort === null) return;

    const gen = (this.#keyGeneration.get(key) ?? 0) + 1;
    this.#keyGeneration.set(key, gen);

    Scheduler.current()
      .after(idleMs, { 'signal': this.#idleAbort.signal })
      .then(() => { this.#onIdle(key, gen); })
      .catch(() => { /* idleAbort cancelled the timer — expected, no action needed */ });
  }

  /**
   * Idle timer callback. Releases the key's partial buffer if the generation
   * is still current and the buffer is non-empty. No-ops if stale, aborted,
   * or already released by capacity or complete-flush.
   */
  #onIdle(key: string, gen: number): void {
    // Bail if the pull loop has exited (idleAbort is already aborted).
    if (this.#idleAbort?.signal.aborted === true) return;
    // Bail if run is aborted or errors have accumulated.
    if (this.#signal?.aborted === true) return;
    if (this.#poolErrors.length > 0) return;
    // Bail if a newer item arrived or the key was already released.
    if (this.#keyGeneration.get(key) !== gen) return;

    const buf = this.#activeBuffers.get(key);
    if (buf === undefined || buf.length === 0) return;

    // Release the partial buffer as an idle batch.
    const batch = buf.splice(0);
    this.#activeBuffers.delete(key);
    // Bump generation so any racing timer (impossible here, but defensive) is stale.
    this.#keyGeneration.set(key, gen + 1);
    this.#spawnBatchWorker(batch);
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
      const key = inboxItem.bufferKey ?? String(this.#resolveKey(inboxItem.item, keyField) ?? '');
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
      if (this.#semaphore.available === 0) {
        await this.#waitForCapacity();
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
      const rawKey = this.#resolveKey(itemValue, keyField);
      const bufferKey = String(rawKey ?? '');

      // Push to inbox with bufferKey set (at-least-once: durable before buffering).
      this.#inbox.push({ index, 'item': itemValue, bufferKey });

      // Buffer the item by key.
      const existing = this.#activeBuffers.get(bufferKey);
      const buffered: BufferedItem = { index, "item": itemValue, bufferKey };
      if (existing !== undefined) {
        existing.push(buffered);
        if (existing.length >= capacity) {
          // Capacity release: bump generation (invalidates any pending idle timer),
          // then dispatch this key's buffer as a batch.
          this.#keyGeneration.set(bufferKey, (this.#keyGeneration.get(bufferKey) ?? 0) + 1);
          const batch = existing.splice(0, capacity);
          if (existing.length === 0) {
            this.#activeBuffers.delete(bufferKey);
          } else {
            // Items remain after capacity release; arm a new idle timer.
            this.#armIdleTimer(bufferKey);
          }
          this.#spawnBatchWorker(batch);
        } else {
          // Item appended but capacity not reached; arm (or re-arm) idle timer.
          this.#armIdleTimer(bufferKey);
        }
      } else {
        this.#activeBuffers.set(bufferKey, [buffered]);
        if (capacity === 1) {
          // Capacity of 1: bump generation and release immediately.
          this.#keyGeneration.set(bufferKey, (this.#keyGeneration.get(bufferKey) ?? 0) + 1);
          const batch = [buffered];
          this.#activeBuffers.delete(bufferKey);
          this.#spawnBatchWorker(batch);
        } else {
          // First item for a new key; arm idle timer.
          this.#armIdleTimer(bufferKey);
        }
      }
    }

    // Pull loop has exited (source drained, error, or run-abort).
    // Cancel all pending idle timers so none can fire during complete-flush,
    // worker-wait, or after drain() returns.
    this.#idleAbort?.abort();

    // Complete-flush: source drained, dispatch every non-empty buffer as partial batch.
    if (this.#freshDone && this.#poolErrors.length === 0 && this.#signal?.aborted !== true) {
      for (const [key, buf] of this.#activeBuffers) {
        if (buf.length > 0) {
          // Wait for a slot before dispatching.
          while (this.#semaphore.available === 0) {
            await this.#waitForCapacity();
          }
          const batch = [...buf];
          this.#activeBuffers.delete(key);
          this.#spawnBatchWorker(batch);
        }
      }
    }

    // Wait for all in-flight batch workers to settle.
    await Promise.all(this.#workerPromises);

    // Abort: throw before caller calls ScatterCheckpoint.clear() so checkpoint is preserved.
    if (this.#signal?.aborted === true && this.#poolErrors.length === 0) {
      throw DAGError.ofSignal(this.#signal);
    }

    if (this.#poolErrors.length > 0) {
      const first = this.#poolErrors[0];
      throw first instanceof Error ? first : new DAGError(String(first), { 'code': 'EXECUTION_ERROR' });
    }
  }
}
