/**
 * ClusterContainer: DagContainerBase over node:cluster workers.
 *
 * Uses `cluster.fork()` to spawn workers inheriting the primary's listener
 * handles — the appropriate choice for HTTP/TCP server applications needing
 * port-sharing workers. The protocol is identical to ForkContainer; only worker
 * provenance differs.
 *
 * Construction calls `cluster.setupPrimary({ exec: entryPath })` once. All
 * workers run the forkEntry bootstrap over IPC.
 *
 * Constructor options:
 *   registryModule   — URL string passed to DagHost init
 *   registryVersion  — version for the init ↔ ready handshake
 *   servicesConfig   — opaque JSON passed to createBundle (default: {})
 *   poolSize         — number of cluster workers (default: NodeSystemInfo)
 *   instrumentation  — forwarded to DagContainerBase
 *   entryUrl         — override the default forkEntry.js URL (for tests)
 *
 * All properties initialised in constructor for V8 hidden-class stability.
 */

import cluster from 'node:cluster';
import type { Worker } from 'node:cluster';

import { DagContainerBase, DAG_CONTAINER_WORKER_DIED } from '@noocodex/dagonizer/container';
import type { Instrumentation, MessageChannelInterface } from '@noocodex/dagonizer/contracts';
import type { JsonObject } from '@noocodex/dagonizer/entities';
import { RecommendedWorkerCountConfigDefault } from '@noocodex/dagonizer/entities';

import { IpcChannel } from './IpcChannel.js';
import { NodeSystemInfo } from './NodeSystemInfo.js';

// ---------------------------------------------------------------------------
// ClusterContainerOptions
// ---------------------------------------------------------------------------

export interface ClusterContainerOptions {
  readonly registryModule: string;
  readonly registryVersion: string;
  readonly servicesConfig?: JsonObject;
  readonly poolSize?: number;
  readonly instrumentation?: Instrumentation;
  readonly entryUrl?: URL;
}

// ---------------------------------------------------------------------------
// ClusterPoolEntry
// ---------------------------------------------------------------------------

interface ClusterPoolEntry {
  worker: Worker;
  channel: IpcChannel;
  initialized: boolean;
}

// ---------------------------------------------------------------------------
// ClusterContainer
// ---------------------------------------------------------------------------

export class ClusterContainer extends DagContainerBase {
  readonly #registryModule: string;
  readonly #registryVersion: string;
  readonly #servicesConfig: JsonObject;
  readonly #poolSize: number;
  readonly #entryUrl: URL;
  #setupDone: boolean;

  readonly #pool: ClusterPoolEntry[];
  readonly #free: ClusterPoolEntry[];
  #waiters: Array<() => void>;
  #destroyed: boolean;

  constructor(options: ClusterContainerOptions) {
    super(options.instrumentation !== undefined ? { 'instrumentation': options.instrumentation } : {});
    this.#registryModule = options.registryModule;
    this.#registryVersion = options.registryVersion;
    this.#servicesConfig = options.servicesConfig ?? {};
    this.#entryUrl = options.entryUrl ?? new URL('./forkEntry.js', import.meta.url);
    this.#setupDone = false;

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
      throw new Error('ClusterContainer: destroyed');
    }

    if (!this.#setupDone) {
      cluster.setupPrimary({ 'exec': this.#entryUrl.pathname });
      this.#setupDone = true;
    }

    if (this.#free.length === 0 && this.#pool.length < this.#poolSize) {
      const entry = this.#spawnWorker();
      this.#pool.push(entry);
      this.#free.push(entry);
    }

    if (this.#free.length === 0) {
      await this.#waitForSlot();
    }

    const entry = this.#free.pop();
    if (entry === undefined) {
      throw new Error('ClusterContainer: no free slot after wait');
    }

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

    for (const entry of this.#pool) {
      if (entry.initialized) {
        try {
          entry.channel.send({ 'kind': 'shutdown' });
        } catch { /* suppress */ }
      }
    }

    await Promise.allSettled(
      this.#pool.map((entry) =>
        Promise.race([
          this.#waitForWorkerExit(entry.worker),
          new Promise<void>((resolve) => setTimeout(resolve, 2000)),
        ]),
      ),
    );

    for (const entry of this.#pool) {
      try { entry.worker.kill('SIGKILL'); } catch { /* suppress */ }
      entry.channel.close();
    }

    this.#pool.length = 0;
    this.#free.length = 0;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  #spawnWorker(): ClusterPoolEntry {
    const worker = cluster.fork();

    const sendFn = (message: unknown): void => { worker.send(message as object); };
    const onFn = (event: 'message', listener: (message: unknown) => void) => {
      worker.on(event, listener);
      return { 'send': sendFn, 'on': onFn };
    };

    const channel = new IpcChannel({ 'send': sendFn, 'on': onFn });
    const entry: ClusterPoolEntry = { 'worker': worker, 'channel': channel, 'initialized': false };

    // Death detection (parent backstop, Law 4): a cluster worker that dies,
    // errors, or disconnects without a result must fail its in-flight request
    // and be evicted. #destroyed gates the handlers off during destroy().
    worker.on('error', (err: Error) => {
      this.#handleDeath(entry, `cluster worker error: ${err.message}`);
    });
    worker.on('exit', () => {
      if (this.#destroyed) return;
      this.#handleDeath(entry, 'cluster worker exited unexpectedly');
    });
    worker.on('disconnect', () => {
      if (this.#destroyed) return;
      this.#handleDeath(entry, 'cluster worker IPC channel disconnected');
    });

    return entry;
  }

  /** Fail the dead worker's in-flight request and evict its pool entry. */
  #handleDeath(entry: ClusterPoolEntry, reason: string): void {
    if (this.#destroyed) return;
    this.failChannel(entry.channel, DAG_CONTAINER_WORKER_DIED, reason);
    this.#evict(entry);
  }

  /** Remove a dead entry from #pool and #free, then wake a slot waiter. */
  #evict(entry: ClusterPoolEntry): void {
    const poolIdx = this.#pool.indexOf(entry);
    if (poolIdx === -1) return;
    this.#pool.splice(poolIdx, 1);
    const freeIdx = this.#free.indexOf(entry);
    if (freeIdx !== -1) this.#free.splice(freeIdx, 1);
    try { entry.channel.close(); } catch { /* suppress */ }
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
