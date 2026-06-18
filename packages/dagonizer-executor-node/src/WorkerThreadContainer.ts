/**
 * WorkerThreadContainer: DagContainerBase over a worker_threads pool.
 *
 * Maintains a pool of Worker instances running workerEntry.js. Each worker
 * hosts one DagHost over a MessagePortChannel. Requests are serialized
 * per-worker: a worker handles one request at a time; concurrent requests wait
 * in the base's semaphore queue for a free slot.
 *
 * Constructor options:
 *   registryModule      — URL string passed to DagHost init
 *   registryVersion     — version for the init ↔ ready handshake
 *   servicesConfig      — opaque JSON passed to instantiate (default: {})
 *   poolSize            — number of workers (default: NodeSystemInfo)
 *   resourceLimits      — per-worker V8 heap budget
 *   entryUrl            — override the default workerEntry.js URL (for tests)
 *
 * All properties initialised in constructor for V8 hidden-class stability.
 */

import { Worker } from 'node:worker_threads';

import { DAG_CONTAINER_WORKER_DIED } from '@studnicky/dagonizer/container';
import type { PoolEntry } from '@studnicky/dagonizer/container';

import { MessagePortChannel } from './MessagePortChannel.js';
import type { MessagePortLike } from './MessagePortChannel.js';
import { NodeContainerBase } from './NodeContainerBase.js';
import type { NodeContainerBaseOptions } from './NodeContainerBase.js';

// ---------------------------------------------------------------------------
// WorkerThreadResourceLimits
// ---------------------------------------------------------------------------

export interface WorkerThreadResourceLimits {
  readonly maxOldGenerationSizeMb?: number;
}

// ---------------------------------------------------------------------------
// WorkerThreadContainerOptions
// ---------------------------------------------------------------------------

export interface WorkerThreadContainerOptions extends NodeContainerBaseOptions {
  readonly resourceLimits?: WorkerThreadResourceLimits;
}

// ---------------------------------------------------------------------------
// WorkerThreadContainer
// ---------------------------------------------------------------------------

export class WorkerThreadContainer extends NodeContainerBase<Worker> {
  readonly #resourceLimits: WorkerThreadResourceLimits;
  readonly #entryUrl: URL;

  constructor(options: WorkerThreadContainerOptions) {
    super(NodeContainerBase.resolveOptions(options));
    this.#resourceLimits = options.resourceLimits ?? {};
    this.#entryUrl = options.entryUrl ?? new URL('./workerEntry.js', import.meta.url);
  }

  // ---------------------------------------------------------------------------
  // Abstract seam implementations
  // ---------------------------------------------------------------------------

  /**
   * composeEntry: construct a Worker + MessagePortChannel, initialized: false.
   * No death listeners, no init handshake — the base handles both.
   */
  protected override composeEntry(): PoolEntry<Worker> {
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
      'close': () => { /* worker lifetime managed by base destroy() */ },
    };

    const channel = new MessagePortChannel(portLike);
    return { 'worker': worker, 'channel': channel, 'initialized': false };
  }

  /**
   * attachDeathListeners: wire worker error/exit events → onTransportDeath().
   * Called unconditionally; the base's #destroyed guard prevents spurious
   * eviction during intentional teardown.
   */
  protected override attachDeathListeners(entry: PoolEntry<Worker>): void {
    entry.worker.on('error', (err: Error) => {
      this.onTransportDeath(entry, DAG_CONTAINER_WORKER_DIED, `worker error: ${err.message}`);
    });
    entry.worker.on('exit', () => {
      this.onTransportDeath(entry, DAG_CONTAINER_WORKER_DIED, 'worker exited unexpectedly');
    });
  }

  /**
   * terminateWorker: force-kill the Worker. Must not throw.
   */
  protected override terminateWorker(worker: Worker): void {
    void worker.terminate();
  }

  /**
   * awaitWorkerExit: resolves when the Worker's 'exit' event fires.
   */
  protected override awaitWorkerExit(worker: Worker): Promise<void> {
    return new Promise<void>((resolve) => {
      worker.once('exit', () => { resolve(); });
    });
  }
}
