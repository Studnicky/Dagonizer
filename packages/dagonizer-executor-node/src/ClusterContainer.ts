/**
 * ClusterContainer: DagContainerBase over node:cluster workers.
 *
 * Uses `cluster.fork()` to spawn workers inheriting the primary's listener
 * handles — the appropriate choice for HTTP/TCP server applications needing
 * port-sharing workers. The protocol is identical to ForkContainer; only worker
 * provenance differs.
 *
 * Construction calls `cluster.setupPrimary({ exec: entryPath })` once (lazily
 * on first composeEntry). All workers run the forkEntry bootstrap over IPC.
 *
 * Constructor options:
 *   registryModule   — URL string passed to DagHost init
 *   registryVersion  — version for the init ↔ ready handshake
 *   servicesConfig   — opaque JSON passed to instantiate (default: {})
 *   poolSize         — number of cluster workers (default: NodeSystemInfo)
 *   entryUrl         — override the default forkEntry.js URL (for tests)
 *
 * All properties initialised in constructor for V8 hidden-class stability.
 */

import cluster from 'node:cluster';
import type { Worker } from 'node:cluster';

import { DAG_CONTAINER_WORKER_DIED } from '@studnicky/dagonizer/container';
import type { PoolEntryType } from '@studnicky/dagonizer/container';

import { IpcChannel } from './IpcChannel.js';
import { NodeContainerBase } from './NodeContainerBase.js';
import type { NodeContainerBaseOptionsType } from './NodeContainerBase.js';

// ---------------------------------------------------------------------------
// ClusterContainerOptionsType
// ---------------------------------------------------------------------------

export type ClusterContainerOptionsType = NodeContainerBaseOptionsType;

// ---------------------------------------------------------------------------
// ClusterContainer
// ---------------------------------------------------------------------------

export class ClusterContainer extends NodeContainerBase<Worker> {
  readonly #entryUrl: URL;
  #setupDone: boolean;

  constructor(options: ClusterContainerOptionsType) {
    super(NodeContainerBase.resolveOptions(options));
    this.#entryUrl = options.entryUrl ?? new URL('./forkEntry.js', import.meta.url);
    this.#setupDone = false;
  }

  // ---------------------------------------------------------------------------
  // Abstract seam implementations
  // ---------------------------------------------------------------------------

  /**
   * composeEntry: configure cluster primary (once) and fork a worker, initialized: false.
   * No death listeners, no init handshake — the base handles both.
   */
  protected override composeEntry(): PoolEntryType<Worker> {
    if (!this.#setupDone) {
      cluster.setupPrimary({ 'exec': this.#entryUrl.pathname });
      this.#setupDone = true;
    }

    const worker = cluster.fork();
    const channel = IpcChannel.ofChildProcess(worker);
    return { 'worker': worker, 'channel': channel, 'initialized': false };
  }

  /**
   * attachDeathListeners: wire cluster worker error/exit/disconnect events → onTransportDeath().
   * Called unconditionally; the base's #destroyed guard prevents spurious
   * eviction during intentional teardown.
   */
  protected override attachDeathListeners(entry: PoolEntryType<Worker>): void {
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
