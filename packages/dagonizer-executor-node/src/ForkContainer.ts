/**
 * ForkContainer: DagContainerBase over a child_process.fork pool.
 *
 * Each pool slot is a forked child process running forkEntry.js. IPC is the
 * transport; IpcChannel wraps the child's send/on. Requests are serialized
 * per-child: each child handles one request at a time; concurrent requests
 * queue in the base's semaphore until a slot is free.
 *
 * Constructor options:
 *   registryModule   — URL string passed to DagHost init
 *   registryVersion  — version for the init ↔ ready handshake
 *   servicesConfig   — opaque JSON passed to createBundle (default: {})
 *   poolSize         — number of child processes (default: NodeSystemInfo)
 *   entryUrl         — override the default forkEntry.js URL (for tests)
 *
 * All properties initialised in constructor for V8 hidden-class stability.
 */

import { fork } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';

import { DAG_CONTAINER_WORKER_DIED } from '@studnicky/dagonizer/container';
import type { PoolEntry } from '@studnicky/dagonizer/container';

import { IpcChannel } from './IpcChannel.js';
import { NodeContainerBase } from './NodeContainerBase.js';
import type { NodeContainerBaseOptions } from './NodeContainerBase.js';

// ---------------------------------------------------------------------------
// ForkContainerOptions
// ---------------------------------------------------------------------------

export type ForkContainerOptions = NodeContainerBaseOptions;

// ---------------------------------------------------------------------------
// ForkContainer
// ---------------------------------------------------------------------------

export class ForkContainer extends NodeContainerBase<ChildProcess> {
  readonly #entryUrl: URL;

  constructor(options: ForkContainerOptions) {
    super(NodeContainerBase.resolveOptions(options));
    this.#entryUrl = options.entryUrl ?? new URL('./forkEntry.js', import.meta.url);
  }

  // ---------------------------------------------------------------------------
  // Abstract seam implementations
  // ---------------------------------------------------------------------------

  /**
   * createEntry: fork a child process + construct an IpcChannel, initialized: false.
   * No death listeners, no init handshake — the base handles both.
   */
  protected override createEntry(): PoolEntry<ChildProcess> {
    // Fork the entry module. IPC is enabled by default for fork().
    // No execArgv override needed: package.json "type": "module" makes
    // the compiled .js output ESM.
    const child = fork(this.#entryUrl.pathname, []);
    const channel = IpcChannel.fromChildProcess(child);
    return { 'worker': child, 'channel': channel, 'initialized': false };
  }

  /**
   * attachDeathListeners: wire child error/exit/disconnect events → onTransportDeath().
   * Called unconditionally; the base's #destroyed guard prevents spurious
   * eviction during intentional teardown.
   */
  protected override attachDeathListeners(entry: PoolEntry<ChildProcess>): void {
    entry.worker.on('error', (err: Error) => {
      this.onTransportDeath(entry, DAG_CONTAINER_WORKER_DIED, `child error: ${err.message}`);
    });
    entry.worker.on('exit', () => {
      this.onTransportDeath(entry, DAG_CONTAINER_WORKER_DIED, 'child exited unexpectedly');
    });
    entry.worker.on('disconnect', () => {
      this.onTransportDeath(entry, DAG_CONTAINER_WORKER_DIED, 'child IPC channel disconnected');
    });
  }

  /**
   * terminateWorker: force-kill the child process. Must not throw.
   */
  protected override terminateWorker(worker: ChildProcess): void {
    worker.kill('SIGKILL');
  }

  /**
   * awaitWorkerExit: resolves when the child process's 'exit' event fires.
   */
  protected override awaitWorkerExit(worker: ChildProcess): Promise<void> {
    return new Promise<void>((resolve) => {
      worker.once('exit', () => { resolve(); });
    });
  }
}
