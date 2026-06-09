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
import type { Instrumentation } from '../contracts/Instrumentation.js';
import type { InstrumentationSink } from '../contracts/InstrumentationSink.js';
import type { MessageChannelInterface } from '../contracts/MessageChannelInterface.js';
import type { BridgeMessage } from '../entities/executor/BridgeMessage.js';
import type { JsonObject } from '../entities/json.js';
import type { NodeStateInterface } from '../NodeStateBase.js';
import { NoopInstrumentation } from '../runtime/NoopInstrumentation.js';

import { ChannelDispatch } from './ChannelDispatch.js';
import type { InitMessageShape } from './ChannelDispatch.js';
import { DagContainerError } from './DagContainerError.js';
import { DagOutcome } from './DagOutcome.js';
import { DAG_CONTAINER_WORKER_DIED } from './TransportErrorCode.js';

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

export interface DagContainerOptions {
  /**
   * Instrumentation sink. Pass `new NoopInstrumentation()` to suppress
   * observability. Required — subclasses pass through without conditional spread.
   * Use `DagContainerBase.defaultOptions` to spread ergonomic defaults.
   */
  readonly instrumentation: Instrumentation;
  /** Maximum number of pool entries (workers) to maintain. */
  readonly poolSize: number;
  /** Init shape forwarded to each DagHost on first channel use. */
  readonly init: InitMessageShape;
  /**
   * Grace period (ms) before a shutting-down worker is force-terminated.
   * Required. Pass `DEFAULT_SHUTDOWN_GRACE_MS` or a custom value.
   * Use `DagContainerBase.defaultOptions` to spread ergonomic defaults.
   */
  readonly shutdownGraceMs: number;
}

// ---------------------------------------------------------------------------
// DagContainerBase
// ---------------------------------------------------------------------------

export abstract class DagContainerBase<
  TState extends NodeStateInterface = NodeStateInterface,
  TWorker = unknown,
> implements DagContainerInterface<TState> {

  // Instrumentation sink (public for subclass read via protected accessor).
  protected readonly instrumentation: Instrumentation;

  // Channel → dispatch map. WeakMap so GC'd channels release their dispatches.
  readonly #dispatches: WeakMap<MessageChannelInterface, ChannelDispatch>;
  // Channel → pool entry reverse lookup. Used by releaseChannel and eviction.
  readonly #channelToEntry: WeakMap<MessageChannelInterface, PoolEntry<TWorker>>;
  // All live pool entries.
  readonly #pool: PoolEntry<TWorker>[];
  // Entries available for immediate checkout.
  readonly #free: PoolEntry<TWorker>[];
  // Promises waiting for a free slot to become available.
  readonly #waiters: Array<() => void>;
  #destroyed: boolean;
  readonly #poolSize: number;
  readonly #init: InitMessageShape;
  readonly #shutdownGraceMs: number;

  /**
   * Ergonomic spread defaults for `DagContainerOptions`. Subclasses pass
   * `{ ...DagContainerBase.defaultOptions, poolSize, init, ...overrides }` so
   * the required `instrumentation` and `shutdownGraceMs` fields are filled
   * without forcing every subclass to import `NoopInstrumentation` and the
   * default constant.
   */
  static readonly defaultOptions: Pick<DagContainerOptions, 'instrumentation' | 'shutdownGraceMs'> = {
    "instrumentation": new NoopInstrumentation(),
    "shutdownGraceMs": DEFAULT_SHUTDOWN_GRACE_MS,
  };

  constructor(options: DagContainerOptions) {
    this.instrumentation         = options.instrumentation;
    this.#dispatches             = new WeakMap<MessageChannelInterface, ChannelDispatch>();
    this.#channelToEntry         = new WeakMap<MessageChannelInterface, PoolEntry<TWorker>>();
    this.#pool                   = [];
    this.#free                   = [];
    this.#waiters                = [];
    this.#destroyed              = false;
    this.#poolSize               = options.poolSize;
    this.#init                   = options.init;
    this.#shutdownGraceMs        = options.shutdownGraceMs;
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
   * Correctness note: after waking from a wait, the loop re-checks #destroyed
   * and #free rather than assuming a specific state, so evictions and concurrent
   * destroys are handled uniformly.
   */
  protected async acquireChannel(): Promise<MessageChannelInterface> {
    while (true) {
      if (this.#destroyed) throw new DagContainerError('container destroyed');

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

      await this.#waitForSlot();
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

  async runDag(task: DagTaskInterface<TState, unknown>): Promise<DagOutcomeInterface> {
    let acquiredChannel: MessageChannelInterface | null = null;

    try {
      acquiredChannel = await this.acquireChannel();
      const channel = acquiredChannel;
      const dispatch = this.#dispatchFor(channel);
      const request = task.toRequest();

      const sink = new InstrumentationSinkImpl(this.instrumentation, task.state as TState);
      const outcome = await dispatch.request(request, task.context.signal, sink);

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
        let graceHandle: ReturnType<typeof setTimeout> | undefined;
        const gracePromise = new Promise<void>((resolve) => {
          graceHandle = setTimeout(resolve, this.#shutdownGraceMs);
        });
        return Promise.race([
          this.awaitWorkerExit(entry.worker).then(() => {
            if (graceHandle !== undefined) clearTimeout(graceHandle);
          }),
          gracePromise,
        ]).then(async () => {
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

  /** Park the caller until a slot becomes available (free or pool shrank). */
  #waitForSlot(): Promise<void> {
    return new Promise<void>((resolve) => {
      this.#waiters.push(resolve);
    });
  }

  /** Wake the oldest parked acquirer, if any. */
  #wakeWaiter(): void {
    const waiter = this.#waiters.shift();
    if (waiter !== undefined) waiter();
  }

  /** Wake every parked acquirer. Used by destroy(). */
  #wakeAllWaiters(): void {
    while (this.#waiters.length > 0) {
      const waiter = this.#waiters.shift();
      if (waiter !== undefined) waiter();
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

// ---------------------------------------------------------------------------
// InstrumentationSinkImpl
// ---------------------------------------------------------------------------

/**
 * Concrete InstrumentationSink used by DagContainerBase.runDag().
 * Delegates to the DagContainerBase private fire helper via closure-free
 * construction: holds a reference to both the outer instance's fire method
 * and the task state so no callback is captured from outside the class.
 */
class InstrumentationSinkImpl<TState extends NodeStateInterface> implements InstrumentationSink {
  readonly #instrumentation: Instrumentation<TState>;
  readonly #state: TState;

  constructor(instrumentation: Instrumentation<TState>, state: TState) {
    this.#instrumentation = instrumentation;
    this.#state          = state;
  }

  onInstrumentation(msg: BridgeMessage & { kind: 'instrumentation' }): void {
    const instr = this.#instrumentation;
    const state = this.#state;
    const path  = msg.placementPath;
    switch (msg.hook) {
      case 'nodeStart':
        instr.nodeStart(msg.dagName, msg.nodeName, state, path);
        break;
      case 'nodeEnd':
        instr.nodeEnd(msg.dagName, msg.nodeName, msg.output, state, path);
        break;
      case 'phaseEnter':
        if (msg.phase !== '') {
          instr.phaseEnter(msg.dagName, msg.phase, msg.nodeName, state, path);
        }
        break;
      case 'phaseExit':
        if (msg.phase !== '') {
          instr.phaseExit(msg.dagName, msg.phase, msg.nodeName, state, path);
        }
        break;
      case 'contractWarning':
        instr.contractWarning(msg.message);
        break;
      case 'error':
        instr.error(msg.dagName, msg.nodeName, new Error(msg.message), state, path);
        break;
      default:
        break;
    }
  }
}

// Re-export DAG_CONTAINER_WORKER_DIED so subclasses can reference it in
// attachDeathListeners without a separate import of TransportErrorCode.
export { DAG_CONTAINER_WORKER_DIED };

// Convenience re-exports so subclass files need only one import from this module.
export type { InitMessageShape };
export type { InstrumentationSink };
export type { JsonObject };
