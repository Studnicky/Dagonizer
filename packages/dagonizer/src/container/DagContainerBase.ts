/**
 * DagContainerBase: abstract pool-owning base for isolating DAG containers.
 *
 * Owns the full worker-pool lifecycle: demand-based growth, semaphore
 * waiting, lazy init, death detection, eviction, and graceful shutdown.
 * Subclasses implement four abstract seams to supply the worker type:
 *
 *   createEntry()            — construct worker + wired channel; initialized: false
 *   attachDeathListeners()   — wire death events → onTransportDeath()
 *   terminateWorker()        — force-kill the worker
 *   awaitWorkerExit()        — resolves when the worker process/thread exits
 *
 * Request routing is delegated to ChannelDispatch (one per channel). Death
 * detection calls failChannel() then evicts the entry; acquireChannel() wakes
 * parked waiters and regrows the pool on the next iteration.
 *
 * All properties initialised in constructor in declaration order (V8 shape).
 */

import type { DagContainerInterface } from '../contracts/DagContainerInterface.js';
import type { DagOutcomeInterface } from '../contracts/DagOutcomeInterface.js';
import type { DagTaskInterface } from '../contracts/DagTaskInterface.js';
import type { MessageChannelInterface } from '../contracts/MessageChannelInterface.js';
import type { ObserverRelay } from '../contracts/ObserverRelay.js';
import type { Batch } from '../entities/batch/Batch.js';
import type { Item } from '../entities/batch/Item.js';
import type { JsonObject } from '../entities/json.js';
import type { NodeStateInterface } from '../NodeStateBase.js';

import { ChannelDispatch } from './ChannelDispatch.js';
import type { InitMessageShape } from './ChannelDispatch.js';
import { DagContainerError } from './DagContainerError.js';
import { DagOutcome } from './DagOutcome.js';
import type { BatchRunResult } from './DagOutcome.js';
import { DAG_CONTAINER_TRANSPORT, DAG_CONTAINER_WORKER_DIED } from './TransportErrorCode.js';

// ---------------------------------------------------------------------------
// PoolEntry
// ---------------------------------------------------------------------------

/**
 * One slot in the container's worker pool. Carries the worker value,
 * its wired channel, and whether the channel has received a successful
 * init ↔ ready handshake.
 */
export interface PoolEntry<TWorker> {
  worker: TWorker;
  channel: MessageChannelInterface;
  initialized: boolean;
}

// ---------------------------------------------------------------------------
// DagContainerOptions
// ---------------------------------------------------------------------------

/** Default grace period (ms) before a shutdown worker is force-terminated. */
export const DEFAULT_SHUTDOWN_GRACE_MS = 2000;

/**
 * Module-level defaults for `DagContainerOptions`, following the codebase
 * `*_DEFAULTS` constant convention (cf. `BASE_STORE_DEFAULTS`). Subclasses
 * may spread this constant to fill optional fields without repeating values.
 */
export const DAG_CONTAINER_DEFAULTS = {
  'shutdownGraceMs': DEFAULT_SHUTDOWN_GRACE_MS,
} as const;

/** @internal Alias used by the constructor spread; keep in sync with DAG_CONTAINER_DEFAULTS. */
const CONTAINER_DEFAULTS = DAG_CONTAINER_DEFAULTS;

export interface DagContainerOptions {
  /** Maximum number of pool entries (workers) to maintain. */
  poolSize: number;
  /** Init shape forwarded to each DagHost on first channel use. */
  init: InitMessageShape;
  /**
   * Grace period (ms) before a shutting-down worker is force-terminated.
   * Defaults to `DEFAULT_SHUTDOWN_GRACE_MS` (2000 ms). Override by passing
   * a custom value; omit to accept the default.
   */
  shutdownGraceMs?: number;
}

// ---------------------------------------------------------------------------
// DagContainerBase
// ---------------------------------------------------------------------------

export abstract class DagContainerBase<
  TState extends NodeStateInterface = NodeStateInterface,
  TWorker = unknown,
> implements DagContainerInterface<TState> {

  // Channel → dispatch map. WeakMap so GC'd channels release their dispatches.
  readonly #dispatches: WeakMap<MessageChannelInterface, ChannelDispatch>;
  // Channel → pool entry reverse lookup. Used by releaseChannel and eviction.
  readonly #channelToEntry: WeakMap<MessageChannelInterface, PoolEntry<TWorker>>;
  // All live pool entries.
  readonly #pool: PoolEntry<TWorker>[];
  // Entries available for immediate checkout.
  readonly #free: PoolEntry<TWorker>[];
  // Promises waiting for a free slot to become available.
  // Each entry carries both a resolve (wake) and reject (abort) so a fired
  // signal can eject a parked waiter without waiting for a free slot.
  readonly #waiters: Array<{ resolve: () => void; reject: (err: Error) => void }>;
  #destroyed: boolean;
  readonly #poolSize: number;
  readonly #init: InitMessageShape;
  readonly #shutdownGraceMs: number;

  /**
   * Ergonomic spread defaults for `DagContainerOptions`. Sources from the
   * module-level `DAG_CONTAINER_DEFAULTS` constant. Subclasses may spread
   * `{ ...DagContainerBase.defaultOptions, poolSize, init, ...overrides }` for
   * explicit control; `shutdownGraceMs` is optional and resolved from
   * `DAG_CONTAINER_DEFAULTS` automatically when omitted.
   */
  static readonly defaultOptions: Pick<Required<DagContainerOptions>, 'shutdownGraceMs'> =
    DAG_CONTAINER_DEFAULTS;

  constructor(options: DagContainerOptions) {
    const { shutdownGraceMs } = { ...CONTAINER_DEFAULTS, ...options };
    this.#dispatches             = new WeakMap<MessageChannelInterface, ChannelDispatch>();
    this.#channelToEntry         = new WeakMap<MessageChannelInterface, PoolEntry<TWorker>>();
    this.#pool                   = [];
    this.#free                   = [];
    this.#waiters                = [];
    this.#destroyed              = false;
    this.#poolSize               = options.poolSize;
    this.#init                   = options.init;
    this.#shutdownGraceMs        = shutdownGraceMs;
  }

  // ---------------------------------------------------------------------------
  // Abstract seams — subclass implements, base orchestrates
  // ---------------------------------------------------------------------------

  /**
   * Construct a new worker and its wired channel. Must return a PoolEntry with
   * `initialized: false`. Must NOT attach death listeners or send init — the
   * base handles both.
   */
  protected abstract createEntry(): PoolEntry<TWorker>;

  /**
   * Attach death-detection event listeners to the given entry. Implementations
   * call `this.onTransportDeath(entry, DAG_CONTAINER_WORKER_DIED, reason)` when
   * the worker dies unexpectedly.
   */
  protected abstract attachDeathListeners(entry: PoolEntry<TWorker>): void;

  /**
   * Force-kill the worker. Called during eviction and destroy. Must not throw.
   */
  protected abstract terminateWorker(worker: TWorker): void;

  /**
   * Return a promise that resolves when the worker has fully exited.
   */
  protected abstract awaitWorkerExit(worker: TWorker): Promise<void>;

  // ---------------------------------------------------------------------------
  // Pool-lifecycle: acquireChannel / releaseChannel (base-concrete, not overridable)
  // ---------------------------------------------------------------------------

  /**
   * Acquire a channel ready for a single request. Grows the pool on demand,
   * lazy-inits channels on first use, and parks the caller if no slot is
   * available. Returns only after the channel has passed the init handshake.
   *
   * @param signal - AbortSignal from the calling task. If the signal fires
   *   while the caller is parked in the waiter queue, the parked promise
   *   rejects immediately with a DagContainerError('aborted') so the caller
   *   is not stranded until an unrelated slot frees.
   *
   * Correctness note: after waking from a wait, the loop re-checks #destroyed
   * and #free rather than assuming a specific state, so evictions and concurrent
   * destroys are handled uniformly.
   */
  protected async acquireChannel(signal: AbortSignal): Promise<MessageChannelInterface> {
    while (true) {
      if (this.#destroyed) throw new DagContainerError('container destroyed');
      if (signal.aborted) throw new DagContainerError('aborted');

      const free = this.#free.pop();
      if (free !== undefined) {
        await this.#ensureInitialized(free);
        return free.channel;
      }

      if (this.#pool.length < this.#poolSize) {
        const fresh = this.#grow();
        try {
          await this.#ensureInitialized(fresh);
        } catch (err) {
          this.#evict(fresh);
          throw err;
        }
        // Hand out checked-out; NOT pushed to #free.
        return fresh.channel;
      }

      await this.#waitForSlot(signal);
      // Loop re-checks: #destroyed? eviction shrank pool? another entry freed?
    }
  }

  /**
   * Return a channel to the free list after a request completes. Must not throw.
   * No-op if the container is destroyed or the entry was evicted.
   */
  protected releaseChannel(channel: MessageChannelInterface): void {
    if (this.#destroyed) return;
    const entry = this.#channelToEntry.get(channel);
    if (entry === undefined) return; // already evicted
    this.#free.push(entry);
    this.#wakeWaiter();
  }

  /**
   * Death-detection callback. Subclasses call this from their death listeners.
   * Fails all in-flight requests on the channel and evicts the pool entry so a
   * fresh worker is spawned on the next acquire.
   */
  protected onTransportDeath(entry: PoolEntry<TWorker>, code: string, reason: string): void {
    if (this.#destroyed) return;
    this.failChannel(entry.channel, code, reason);
    this.#evict(entry);
  }

  // ---------------------------------------------------------------------------
  // runDag
  // ---------------------------------------------------------------------------

  async runDag(task: DagTaskInterface<TState, unknown>, options?: { readonly relay?: ObserverRelay }): Promise<DagOutcomeInterface> {
    const relay: ObserverRelay | null = options?.relay ?? null;
    let acquiredChannel: MessageChannelInterface | null = null;

    try {
      acquiredChannel = await this.acquireChannel(task.context.signal);
      const channel = acquiredChannel;
      const dispatch = this.#dispatchFor(channel);
      const request = task.toRequest();

      const outcome = await dispatch.request(request, task.context.signal, relay);

      return outcome;
    } catch (err) {
      // R6: forward the real error message so callers see the root cause rather
      // than the generic transport-failure message.
      const message = err instanceof Error ? err.message : String(err);
      return DagOutcome.transportError(task.correlationId, { message });
    } finally {
      if (acquiredChannel !== null) {
        this.releaseChannel(acquiredChannel);
      }
    }
  }

  /**
   * Run a batch of items through the same DAG in a single transport round-trip.
   * Returns one `BatchRunResult` per item in the batch, preserving item order.
   *
   * `task` supplies the DAG name, placement path, timeout, and abort signal.
   * `batch` carries the per-item states. `task.state` is used only for the
   * abort signal and task identity; items come from `batch`.
   *
   * Never throws — transport failures resolve to transport-error `BatchRunResult`
   * entries, one per item.
   */
  async runDagBatch(
    task: DagTaskInterface<TState, unknown>,
    batch: Batch<TState>,
    options?: { readonly relay?: ObserverRelay },
  ): Promise<BatchRunResult[]> {
    const relay: ObserverRelay | null = options?.relay ?? null;
    let acquiredChannel: MessageChannelInterface | null = null;
    const correlationId = task.correlationId;

    try {
      acquiredChannel = await this.acquireChannel(task.context.signal);
      const channel = acquiredChannel;
      const dispatch = this.#dispatchFor(channel);

      const baseRequest = task.toRequest();
      const batchItems = batch.items().map((item: Item<TState>) => ({
        'id': item.id,
        'snapshot': item.state.snapshot() as { [key: string]: unknown },
      }));

      const batchRequest = {
        'dagName':       baseRequest.dagName,
        'placementPath': baseRequest.placementPath,
        'items':         batchItems,
        'timeoutMs':     baseRequest.timeoutMs,
        'correlationId': correlationId,
      };

      return await dispatch.requestBatch(batchRequest, task.context.signal, relay);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Return one transport-error result per item.
      return batch.items().map((item: Item<TState>) =>
        DagOutcome.batchItemTransportError(item.id, correlationId, { message }),
      );
    } finally {
      if (acquiredChannel !== null) {
        this.releaseChannel(acquiredChannel);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // destroy
  // ---------------------------------------------------------------------------

  async destroy(): Promise<void> {
    if (this.#destroyed) return;
    this.#destroyed = true;

    // Unblock all parked acquirers; they will re-check #destroyed and throw.
    this.#wakeAllWaiters();

    const snapshot = [...this.#pool];
    for (const entry of snapshot) {
      try { entry.channel.send({ 'kind': 'shutdown' }); } catch { /* suppress */ }
    }

    await Promise.allSettled(
      snapshot.map((entry) => {
        // R9: capture the grace handle so we can cancel it when the worker
        // exits cleanly — avoids leaking a timer into the next event-loop tick.
        let graceHandle: ReturnType<typeof setTimeout> | null = null;
        const gracePromise = new Promise<void>((resolve) => {
          graceHandle = setTimeout(resolve, this.#shutdownGraceMs);
        });
        return Promise.race([
          this.awaitWorkerExit(entry.worker).then(() => {
            if (graceHandle !== null) clearTimeout(graceHandle);
          }),
          gracePromise,
        ]).then(async () => {
          // CON-2: fail all in-flight ChannelDispatch entries before closing the
          // channel so concurrent runDag() callers awaiting dispatch.request()
          // resolve with a transport-error outcome instead of hanging forever.
          // The death path (onTransportDeath) calls failChannel too; making graceful
          // destroy consistent with the death path prevents the one-way gap.
          this.failChannel(entry.channel, DAG_CONTAINER_TRANSPORT, 'container destroyed');
          try { this.terminateWorker(entry.worker); } catch { /* suppress */ }
          try { entry.channel.close(); } catch { /* suppress */ }
        });
      }),
    );

    this.#pool.length = 0;
    this.#free.length = 0;
  }

  // ---------------------------------------------------------------------------
  // Protected channel helpers
  // ---------------------------------------------------------------------------

  /**
   * Send init and await ready. Rejects on version mismatch or error message.
   * Creates the ChannelDispatch for the channel (one onMessage handler) if
   * it does not yet exist.
   */
  protected initializeChannel(
    channel: MessageChannelInterface,
    init: InitMessageShape,
  ): Promise<void> {
    return this.#dispatchFor(channel).init(init);
  }

  /**
   * Fail every in-flight request on the given channel with a transport error.
   * No-op when no ChannelDispatch exists for the channel.
   */
  protected failChannel(channel: MessageChannelInterface, code: string, message: string): void {
    const dispatch = this.#dispatches.get(channel);
    if (dispatch === undefined) return;
    dispatch.failAll(code, message);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /** Grow the pool by one: createEntry → attachDeathListeners → register. */
  #grow(): PoolEntry<TWorker> {
    const entry = this.createEntry();
    this.attachDeathListeners(entry);
    this.#pool.push(entry);
    this.#channelToEntry.set(entry.channel, entry);
    return entry;
  }

  /** Send init to the entry's channel if it has not been initialized yet. */
  async #ensureInitialized(entry: PoolEntry<TWorker>): Promise<void> {
    if (!entry.initialized) {
      await this.initializeChannel(entry.channel, this.#init);
      entry.initialized = true;
    }
  }

  /**
   * Remove an entry from #pool and #free (idempotent). Closes the channel and
   * force-terminates the worker. Wakes one waiter so a parked acquirer can
   * regrow the pool.
   */
  #evict(entry: PoolEntry<TWorker>): void {
    const poolIdx = this.#pool.indexOf(entry);
    if (poolIdx === -1) return; // already evicted
    this.#pool.splice(poolIdx, 1);
    const freeIdx = this.#free.indexOf(entry);
    if (freeIdx !== -1) this.#free.splice(freeIdx, 1);
    this.#channelToEntry.delete(entry.channel);
    try { entry.channel.close(); } catch { /* suppress */ }
    try { this.terminateWorker(entry.worker); } catch { /* suppress */ }
    // Wake one waiter: the pool shrank so a parked acquirer can regrow.
    this.#wakeWaiter();
  }

  /**
   * Park the caller until a slot becomes available (free or pool shrank).
   *
   * If `signal` fires while the caller is parked, the waiter entry is removed
   * from the queue and the promise rejects with DagContainerError('aborted').
   * The abort listener is always removed in a finally block to prevent leaks.
   */
  #waitForSlot(signal: AbortSignal): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const entry = { resolve, reject };
      this.#waiters.push(entry);

      const onAbort = (): void => {
        const idx = this.#waiters.indexOf(entry);
        if (idx !== -1) this.#waiters.splice(idx, 1);
        reject(new DagContainerError('aborted'));
      };
      signal.addEventListener('abort', onAbort, { 'once': true });

      // Wrap resolve so we always clean up the abort listener.
      const originalResolve = entry.resolve;
      entry.resolve = (): void => {
        signal.removeEventListener('abort', onAbort);
        originalResolve();
      };
    });
  }

  /** Wake the oldest parked acquirer, if any. */
  #wakeWaiter(): void {
    const waiter = this.#waiters.shift();
    if (waiter !== undefined) waiter.resolve();
  }

  /** Wake every parked acquirer. Used by destroy(). */
  #wakeAllWaiters(): void {
    while (this.#waiters.length > 0) {
      const waiter = this.#waiters.shift();
      if (waiter !== undefined) waiter.resolve();
    }
  }

  /**
   * Get or create the ChannelDispatch for the given channel. Creating it
   * installs exactly one onMessage handler on the channel for its lifetime.
   */
  #dispatchFor(channel: MessageChannelInterface): ChannelDispatch {
    const existing = this.#dispatches.get(channel);
    if (existing !== undefined) return existing;
    const dispatch = new ChannelDispatch(channel);
    this.#dispatches.set(channel, dispatch);
    return dispatch;
  }

}

// Re-export transport error codes so subclasses can reference them in
// attachDeathListeners and other seams without a separate import.
export { DAG_CONTAINER_TRANSPORT, DAG_CONTAINER_WORKER_DIED };

// Convenience re-exports so subclass files need only one import from this module.
export type { InitMessageShape };
export type { JsonObject };
