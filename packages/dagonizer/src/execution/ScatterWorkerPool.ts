/**
 * ScatterWorkerPool: bounded worker-pool for scatter execution.
 *
 * Delegates concurrency gating to an owned `Semaphore` instance (one permit
 * per `concurrencyLimit` slot). Owns the error accumulator and the drain loop
 * that drives concurrent item execution. Item body execution and
 * acknowledgment are delegated to a `ScatterPoolDriverInterface`
 * instance so the pool has no knowledge of DAG internals; it only manages
 * concurrency.
 *
 * Each pulled item is dispatched immediately as a single-item execution.
 *
 * When `throttle` is set (non-`null`), dispatch is additionally gated through
 * an owned `Throttle` instance (`@studnicky/throttle`) as a second, independent
 * concurrency window wrapping `driver.executeItem`. The `Semaphore` remains the
 * hard cap on pulling ahead of dispatch capacity; the `Throttle`, when present,
 * further paces the actual item-execution calls. `throttle: null` (the default)
 * means no second gate: behavior is unchanged from the semaphore-only path.
 *
 * Semantics preserved from the inline implementation:
 * - True backpressure: a new item is only pulled once a worker slot is free.
 * - At-least-once delivery: items enter the inbox before execution; ack removes
 *   them from the inbox. Crashes leave un-acked items for resume reprocessing.
 * - Abort safety: the pull loop stops when the signal is aborted; in-flight
 *   workers drain before the abort error is thrown.
 * - Error accumulation: all worker errors are collected; none are silently dropped.
 *   The first error is thrown after draining; the rest remain available on `errors`.
 */

import { Semaphore } from '@studnicky/concurrency/semaphore';
import { Throttle } from '@studnicky/throttle';

import type { ScatterPoolDriverInterface, ScatterItemResultType } from '../contracts/ScatterPoolDriver.js';
import type { ScatterThrottleOptionsType } from '../entities/dag/ScatterNode.js';
import type { ScatterInboxItemType } from '../entities/scatter/ScatterProgress.js';
import { DAGError } from '../errors/index.js';
/**
 * Options for constructing a `ScatterWorkerPool`.
 *
 * All fields are required; defaults must be resolved by the caller before
 * construction (see `ScatterWorkerPool` JSDoc).
 */
export type ScatterWorkerPoolOptionsType = {
  /** Maximum number of items executing concurrently. */
  concurrencyLimit: number;
  /** Inbox items from a prior run (priority source). */
  inbox: ScatterInboxItemType[];
  /** Fresh items from the scatter source (secondary source, post-pre-scan). */
  freshIter: AsyncIterator<unknown>;
  /**
   * Next index to assign to a fresh item. Caller must set this to one past
   * the highest index seen in the current checkpoint.
   */
  nextIndex: number;
  /** Run-level abort signal. `null` when no cancellation was requested. */
  signal: AbortSignal | null;
  /**
   * Optional second concurrency gate wrapping `driver.executeItem` dispatch.
   * `null` means no throttle: only the `concurrencyLimit` semaphore gates
   * dispatch (unchanged from the pre-throttle behavior).
   */
  throttle: ScatterThrottleOptionsType;
};

/**
 * Bounded worker pool for scatter execution.
 *
 * Constructed with fixed options and a `ScatterPoolDriverInterface`. Call
 * `drain()` to drive the pool to completion; inspect `errors` after `drain()`
 * resolves to check for accumulated worker failures (drain throws on error,
 * but `errors` is also available for aggregate diagnostics).
 *
 * V8 shape stability: all fields are initialised in declaration order in the
 * constructor. No fields are added or deleted after construction.
 */
export class ScatterWorkerPool {
  readonly #driver: ScatterPoolDriverInterface;
  readonly #semaphore: Semaphore;
  readonly #throttle: Throttle | null;
  readonly #inbox: ScatterInboxItemType[];
  readonly #inboxIter: AsyncIterator<ScatterInboxItemType, undefined>;
  readonly #freshIter: AsyncIterator<unknown>;
  readonly #signal: AbortSignal | null;
  readonly #workerPromises: Promise<void>[];
  #nextIndex: number;
  #inboxDone: boolean;
  #freshDone: boolean;
  readonly #poolErrors: unknown[];

  constructor(driver: ScatterPoolDriverInterface, options: ScatterWorkerPoolOptionsType) {
    this.#driver = driver;
    this.#semaphore = Semaphore.builder().withPermits(options.concurrencyLimit).build();
    this.#throttle = options.throttle !== null
      ? Throttle.builder().withConcurrencyLimit(options.throttle.concurrencyLimit).build()
      : null;
    this.#inbox = options.inbox;
    this.#freshIter = options.freshIter;
    this.#signal = options.signal;
    this.#nextIndex = options.nextIndex;
    this.#inboxDone = false;
    this.#freshDone = false;
    this.#workerPromises = [];
    this.#poolErrors = [];
    // Inbox iterator: a stateful cursor over the #inbox array.
    // The inbox may grow (gap-filling during pre-scan) before drain() is called;
    // the cursor is reset to 0 at construction and advances sequentially.
    // inboxPos is a local var closed over by the iterator so it is private
    // to the iterator and not a field (avoids double-tracking with the iterator).
    let inboxPos = 0;
    const inbox = this.#inbox;
    this.#inboxIter = {
      next(): Promise<IteratorResult<ScatterInboxItemType, undefined>> {
        if (inboxPos >= inbox.length) {
          return Promise.resolve({ 'value': undefined, 'done': true });
        }
        const entry = inbox[inboxPos++];
        if (entry === undefined) {
          return Promise.resolve({ 'value': undefined, 'done': true });
        }
        return Promise.resolve({ 'value': entry, 'done': false });
      },
    };
  }

  /**
   * Accumulated worker errors. Available after `drain()` throws or resolves.
   * The first error is thrown by `drain()`; all errors are preserved here for
   * aggregate diagnostics.
   */
  get errors(): readonly unknown[] {
    return this.#poolErrors;
  }

  /**
   * Pull the next item from the inbox (priority) then fresh source.
   * Returns `null` when both sources are exhausted.
   * A pulled inbox item has `type: 'inbox'`; its index comes from
   * `ScatterInboxItem.index`. A fresh item has `type: 'fresh'`; its
   * index is assigned from `#nextIndex`.
   */
  async #pullNext(): Promise<
    | { 'type': 'inbox'; 'index': number; 'item': unknown }
    | { 'type': 'fresh'; 'index': number; 'item': unknown }
    | null
  > {
    if (!this.#inboxDone) {
      const step = await this.#inboxIter.next();
      if (!step.done) {
        return { 'type': 'inbox', 'index': step.value.index, 'item': step.value.item };
      }
      this.#inboxDone = true;
    }
    if (!this.#freshDone) {
      const step = await this.#freshIter.next();
      if (!step.done) {
        const index = this.#nextIndex++;
        // Add to inbox immediately (durable: pulled but not yet acked).
        this.#inbox.push({ index, 'item': step.value });
        return { 'type': 'fresh', index, 'item': step.value };
      }
      this.#freshDone = true;
    }
    return null;
  }

  /**
   * Dispatch one item's body execution, routed through the owned `Throttle`
   * when one is configured, else called directly. `Throttle.execute` resolves
   * to `undefined` only when the throttle itself has been aborted or drained —
   * this pool never calls `abort()`/`drain()` on its throttle, so that branch
   * is an invariant violation, surfaced as a `DAGError` rather than silently
   * dropping the item.
   */
  #dispatchItem(index: number, item: unknown): Promise<ScatterItemResultType> {
    if (this.#throttle === null) {
      return this.#driver.executeItem(index, item);
    }
    return this.#throttle.execute(() => this.#driver.executeItem(index, item)).then((result) => {
      if (result === undefined) {
        throw new DAGError('Throttle detached scatter item execution unexpectedly', { 'code': 'EXECUTION_ERROR' });
      }
      return result;
    });
  }

  /**
   * Spawn a single-item worker holding an already-acquired semaphore permit.
   * `release` returns the permit to the pool (or hands it to the next queued
   * waiter) once the item's execute+ack cycle settles.
   */
  #spawnWorker(index: number, item: unknown, release: () => void): void {
    const workerPromise: Promise<void> = this.#dispatchItem(index, item).then(
      (res) => this.#driver.ackItem(res).then(
        () => { release(); },
        (err: unknown) => {
          this.#poolErrors.push(err);
          release();
        },
      ),
      (err: unknown) => {
        // R7: push to accumulator — never overwrite; concurrent failures all preserved.
        this.#poolErrors.push(err);
        release();
      },
    );
    this.#workerPromises.push(workerPromise);
  }

  /**
   * Drive the pool to completion: pull items, spawn single-item workers up to
   * `concurrencyLimit`, wait for all workers to settle, and throw if any errors
   * occurred or the run-level signal was aborted.
   *
   * Semantics:
   * - R1: exits the pull loop on abort BEFORE pulling more items, so items
   *   that never ran their body are not acked.
   * - Error throw is BEFORE checkpoint clear — the checkpoint is preserved
   *   when the pool exits via error or abort.
   * - On clean completion, returns normally. The caller clears the checkpoint.
   */
  async drain(): Promise<void> {
    // Pull loop: fills slots until sources are exhausted, a worker error
    // accumulates, or the run-level signal is aborted.
    // Acquire a permit BEFORE pulling so fresh items are only pushed to the
    // inbox when a worker slot is available (preserves inbox-empty-after-ack
    // invariant with concurrency=1); `acquire()` blocks when the pool is at
    // capacity and resolves as soon as a permit frees up. The error/abort
    // check runs AFTER `acquire()` resolves (not just at loop entry) so a
    // worker error recorded while this iteration was queued for a permit is
    // observed before the next item is pulled.
    for (;;) {
      const release = await this.#semaphore.acquire();
      if (this.#poolErrors.length > 0 || this.#signal?.aborted === true) {
        release();
        break;
      }
      const pulled = await this.#pullNext();
      if (pulled === null) {
        release();
        break; // both sources exhausted
      }
      this.#spawnWorker(pulled.index, pulled.item, release);
    }

    // Wait for all spawned workers to settle.
    await Promise.all(this.#workerPromises);

    // R1: if the signal was aborted and no worker error caused the exit,
    // throw BEFORE the caller calls ScatterCheckpoint.clear() so the
    // checkpoint is preserved on state for resume.
    if (this.#signal?.aborted === true && this.#poolErrors.length === 0) {
      throw DAGError.ofSignal(this.#signal);
    }

    if (this.#poolErrors.length > 0) {
      // Throw the first error; remaining errors are preserved in `this.errors`
      // for aggregate diagnostics.
      const first = this.#poolErrors[0];
      throw first instanceof Error ? first : new DAGError(String(first), { 'code': 'EXECUTION_ERROR' });
    }
  }
}
