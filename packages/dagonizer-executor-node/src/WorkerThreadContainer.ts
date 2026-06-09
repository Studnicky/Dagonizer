/**
 * WorkerThreadContainer: DagContainerBase over a worker_threads pool.
 *
 * Maintains a pool of Worker instances running workerEntry.js. Each worker
 * hosts one DagHost over a MessagePortChannel. Requests are serialized
 * per-worker: a worker handles one request at a time; concurrent requests wait
 * in a promise-based semaphore queue for a free slot.
 *
 * Constructor options:
 *   registryModule      — URL string passed to DagHost init
 *   registryVersion     — version for the init ↔ ready handshake
 *   servicesConfig      — opaque JSON passed to createBundle (default: {})
 *   poolSize            — number of workers (default: NodeSystemInfo)
 *   instrumentation     — forwarded to DagContainerBase
 *   resourceLimits      — per-worker V8 heap budget
 *   entryUrl            — override the default workerEntry.js URL (for tests)
 *
 * All properties initialised in constructor for V8 hidden-class stability.
 */

import { Worker } from 'node:worker_threads';

import { DagContainerBase, DAG_CONTAINER_WORKER_DIED } from '@noocodex/dagonizer/container';
import type { Instrumentation, MessageChannelInterface } from '@noocodex/dagonizer/contracts';
import type { JsonObject } from '@noocodex/dagonizer/entities';
import { RecommendedWorkerCountConfigDefault } from '@noocodex/dagonizer/entities';

import { MessagePortChannel } from './MessagePortChannel.js';
import type { MessagePortLike } from './MessagePortChannel.js';
import { NodeSystemInfo } from './NodeSystemInfo.js';

// ---------------------------------------------------------------------------
// WorkerThreadResourceLimits
// ---------------------------------------------------------------------------

export interface WorkerThreadResourceLimits {
  readonly maxOldGenerationSizeMb?: number;
}

// ---------------------------------------------------------------------------
// WorkerThreadContainerOptions
// ---------------------------------------------------------------------------

export interface WorkerThreadContainerOptions {
  readonly registryModule: string;
  readonly registryVersion: string;
  readonly servicesConfig?: JsonObject;
  readonly poolSize?: number;
  readonly instrumentation?: Instrumentation;
  readonly resourceLimits?: WorkerThreadResourceLimits;
  readonly entryUrl?: URL;
}

// ---------------------------------------------------------------------------
// PoolEntry: tracks a worker and its channel
// ---------------------------------------------------------------------------

interface PoolEntry {
  worker: Worker;
  channel: MessagePortChannel;
  initialized: boolean;
}

// ---------------------------------------------------------------------------
// WorkerThreadContainer
// ---------------------------------------------------------------------------

export class WorkerThreadContainer extends DagContainerBase {
  readonly #registryModule: string;
  readonly #registryVersion: string;
  readonly #servicesConfig: JsonObject;
  readonly #poolSize: number;
  readonly #resourceLimits: WorkerThreadResourceLimits;
  readonly #entryUrl: URL;

  readonly #pool: PoolEntry[];
  readonly #free: PoolEntry[];
  #waiters: Array<() => void>;
  #destroyed: boolean;

  constructor(options: WorkerThreadContainerOptions) {
    super(options.instrumentation !== undefined ? { 'instrumentation': options.instrumentation } : {});
    this.#registryModule = options.registryModule;
    this.#registryVersion = options.registryVersion;
    this.#servicesConfig = options.servicesConfig ?? {};
    this.#resourceLimits = options.resourceLimits ?? {};
    this.#entryUrl = options.entryUrl ?? new URL('./workerEntry.js', import.meta.url);

    const sysInfo = new NodeSystemInfo();
    const defaultPoolSize = sysInfo.recommendedWorkerCount({
      ...RecommendedWorkerCountConfigDefault,
      'maximumWorkers': 8,
    });
    this.#poolSize = options.poolSize ?? defaultPoolSize;

    this.#pool = [];
    this.#free = [];
    this.#waiters = [];
    this.#destroyed = false;
  }

  protected async acquireChannel(): Promise<MessageChannelInterface> {
    if (this.#destroyed) {
      throw new Error('WorkerThreadContainer: destroyed');
    }

    // Grow pool up to #poolSize on demand.
    if (this.#free.length === 0 && this.#pool.length < this.#poolSize) {
      const entry = this.#spawnWorker();
      this.#pool.push(entry);
      this.#free.push(entry);
    }

    // Wait for a free slot.
    if (this.#free.length === 0) {
      await this.#waitForSlot();
    }

    const entry = this.#free.pop();
    if (entry === undefined) {
      throw new Error('WorkerThreadContainer: no free slot after wait');
    }

    // Initialize on first use.
    if (!entry.initialized) {
      await this.initializeChannel(entry.channel, {
        'registryModule': this.#registryModule,
        'registryVersion': this.#registryVersion,
        'servicesConfig': this.#servicesConfig,
      });
      entry.initialized = true;
    }

    return entry.channel;
  }

  protected releaseChannel(channel: MessageChannelInterface): void {
    const entry = this.#pool.find((e) => e.channel === channel);
    if (entry !== undefined && !this.#destroyed) {
      this.#free.push(entry);
      this.#releaseSlot();
    }
  }

  async destroy(): Promise<void> {
    if (this.#destroyed) return;
    this.#destroyed = true;

    // Send shutdown to all initialized workers.
    const shutdownPromises: Promise<void>[] = [];
    for (const entry of this.#pool) {
      if (entry.initialized) {
        try {
          entry.channel.send({ 'kind': 'shutdown' });
        } catch { /* suppress */ }
      }
      shutdownPromises.push(this.#waitForWorkerExit(entry.worker));
    }

    // Give workers a chance to exit cleanly; terminate stragglers.
    await Promise.allSettled(
      shutdownPromises.map((p) =>
        Promise.race([
          p,
          new Promise<void>((resolve) => setTimeout(resolve, 2000)),
        ]),
      ),
    );

    for (const entry of this.#pool) {
      try {
        await entry.worker.terminate();
      } catch { /* suppress */ }
      entry.channel.close();
    }

    this.#pool.length = 0;
    this.#free.length = 0;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  #spawnWorker(): PoolEntry {
    const resourceLimits: { maxOldGenerationSizeMb?: number } = {};
    if (this.#resourceLimits.maxOldGenerationSizeMb !== undefined) {
      resourceLimits.maxOldGenerationSizeMb = this.#resourceLimits.maxOldGenerationSizeMb;
    }

    const worker = new Worker(this.#entryUrl, {
      'resourceLimits': Object.keys(resourceLimits).length > 0 ? resourceLimits : undefined,
    });

    // Worker lacks `close()` (it uses `terminate()`). Wrap in a MessagePortLike
    // adapter; close() is a no-op here — the worker is terminated via destroy().
    const portLike: MessagePortLike = {
      'postMessage': (value: unknown) => worker.postMessage(value),
      'on': (event: 'message', listener: (value: unknown) => void) => {
        worker.on(event, listener);
        return portLike;
      },
      'close': () => { /* worker lifetime managed by container.destroy() */ },
    };

    const channel = new MessagePortChannel(portLike);
    const entry: PoolEntry = { 'worker': worker, 'channel': channel, 'initialized': false };

    // Death detection (parent backstop, Law 4): a worker that dies without
    // sending a result/error must fail its in-flight request and be evicted so
    // a fresh worker is spawned on the next acquire. Distinguish an unexpected
    // death from intentional teardown via #destroyed (destroy() terminates
    // workers deliberately and must not fail pending requests).
    worker.on('error', (err: Error) => {
      this.#handleDeath(entry, `worker error: ${err.message}`);
    });
    worker.on('exit', () => {
      if (this.#destroyed) return; // intentional shutdown during destroy()
      this.#handleDeath(entry, 'worker exited unexpectedly');
    });

    return entry;
  }

  /**
   * Fail the dead worker's in-flight request and evict its pool entry so it is
   * never re-acquired. Idempotent across the error+exit pair (eviction guards
   * against double processing).
   */
  #handleDeath(entry: PoolEntry, reason: string): void {
    if (this.#destroyed) return;
    this.failChannel(entry.channel, DAG_CONTAINER_WORKER_DIED, reason);
    this.#evict(entry);
  }

  /** Remove a dead entry from #pool and #free, then release a slot waiter. */
  #evict(entry: PoolEntry): void {
    const poolIdx = this.#pool.indexOf(entry);
    if (poolIdx === -1) return; // already evicted
    this.#pool.splice(poolIdx, 1);
    const freeIdx = this.#free.indexOf(entry);
    if (freeIdx !== -1) this.#free.splice(freeIdx, 1);
    try { entry.channel.close(); } catch { /* suppress */ }
    // Wake a waiter: acquireChannel will spawn a fresh worker (pool shrank).
    this.#releaseSlot();
  }

  #waitForSlot(): Promise<void> {
    return new Promise<void>((resolve) => {
      this.#waiters.push(resolve);
    });
  }

  #releaseSlot(): void {
    const waiter = this.#waiters.shift();
    if (waiter !== undefined) waiter();
  }

  #waitForWorkerExit(worker: Worker): Promise<void> {
    return new Promise<void>((resolve) => {
      worker.once('exit', () => resolve());
    });
  }
}
