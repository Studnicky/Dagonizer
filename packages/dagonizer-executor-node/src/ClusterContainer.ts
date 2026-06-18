/**
 * ClusterContainer: DagContainerBase over node:cluster workers.
 *
 * Uses `cluster.fork()` to spawn workers inheriting the primary's listener
 * handles — the appropriate choice for HTTP/TCP server applications needing
 * port-sharing workers. The protocol is identical to ForkContainer; only worker
 * provenance differs.
 *
 * Construction calls `cluster.setupPrimary({ exec: entryPath })` once (lazily
 * on first createEntry). All workers run the forkEntry bootstrap over IPC.
 *
 * Constructor options:
 *   registryModule   — URL string passed to DagHost init
 *   registryVersion  — version for the init ↔ ready handshake
 *   servicesConfig   — opaque JSON passed to createBundle (default: {})
 *   poolSize         — number of cluster workers (default: NodeSystemInfo)
 *   entryUrl         — override the default forkEntry.js URL (for tests)
 *
 * All properties initialised in constructor for V8 hidden-class stability.
 */

import cluster from 'node:cluster';
import type { Worker } from 'node:cluster';

import { DagContainerBase, DAG_CONTAINER_WORKER_DIED } from '@studnicky/dagonizer/container';
import type { PoolEntry } from '@studnicky/dagonizer/container';
import type { JsonObject } from '@studnicky/dagonizer/entities';
import { RecommendedWorkerCountConfigDefault } from '@studnicky/dagonizer/entities';
import type { NodeStateInterface } from '@studnicky/dagonizer/types';

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
  readonly entryUrl?: URL;
}

// ---------------------------------------------------------------------------
// ClusterContainer
// ---------------------------------------------------------------------------

export class ClusterContainer extends DagContainerBase<NodeStateInterface, Worker> {
  readonly #entryUrl: URL;
  #setupDone: boolean;

  constructor(options: ClusterContainerOptions) {
    const sysInfo = new NodeSystemInfo();
    const defaultPoolSize = sysInfo.recommendedWorkerCount({
      ...RecommendedWorkerCountConfigDefault,
      'maximumWorkers': 8,
    });
    super({
      ...DagContainerBase.defaultOptions,
      'poolSize': options.poolSize ?? defaultPoolSize,
      'init': {
        'registryModule': options.registryModule,
        'registryVersion': options.registryVersion,
        'servicesConfig': options.servicesConfig ?? {},
      },
    });
    this.#entryUrl = options.entryUrl ?? new URL('./forkEntry.js', import.meta.url);
    this.#setupDone = false;
  }

  // ---------------------------------------------------------------------------
  // Abstract seam implementations
  // ---------------------------------------------------------------------------

  /**
   * createEntry: configure cluster primary (once) and fork a worker, initialized: false.
   * No death listeners, no init handshake — the base handles both.
   */
  protected override createEntry(): PoolEntry<Worker> {
    if (!this.#setupDone) {
      cluster.setupPrimary({ 'exec': this.#entryUrl.pathname });
      this.#setupDone = true;
    }

    const worker = cluster.fork();
    const channel = IpcChannel.fromChildProcess(worker);
    return { 'worker': worker, 'channel': channel, 'initialized': false };
  }

  /**
   * attachDeathListeners: wire cluster worker error/exit/disconnect events → onTransportDeath().
   * Called unconditionally; the base's #destroyed guard prevents spurious
   * eviction during intentional teardown.
   */
  protected override attachDeathListeners(entry: PoolEntry<Worker>): void {
    entry.worker.on('error', (err: Error) => {
      this.onTransportDeath(entry, DAG_CONTAINER_WORKER_DIED, `cluster worker error: ${err.message}`);
    });
    entry.worker.on('exit', () => {
      this.onTransportDeath(entry, DAG_CONTAINER_WORKER_DIED, 'cluster worker exited unexpectedly');
    });
    entry.worker.on('disconnect', () => {
      this.onTransportDeath(entry, DAG_CONTAINER_WORKER_DIED, 'cluster worker IPC channel disconnected');
    });
  }

  /**
   * terminateWorker: force-kill the cluster worker. Must not throw.
   */
  protected override terminateWorker(worker: Worker): void {
    worker.kill('SIGKILL');
  }

  /**
   * awaitWorkerExit: resolves when the cluster worker's 'exit' event fires.
   */
  protected override awaitWorkerExit(worker: Worker): Promise<void> {
    return new Promise<void>((resolve) => {
      worker.once('exit', () => { resolve(); });
    });
  }
}
