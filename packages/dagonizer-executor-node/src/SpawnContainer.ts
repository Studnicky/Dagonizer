/**
 * SpawnContainer: DagContainerBase over child_process.spawn + NdjsonChannel.
 *
 * The child process communicates via NDJSON-over-stdio. The default command is
 * process.execPath running spawnEntry.js — any runtime that can read NDJSON
 * from stdin and write NDJSON to stdout works as a replacement by overriding
 * `command` and `args` in the options. This is the polyglot door.
 *
 * Constructor options:
 *   registryModule   — URL string passed to DagHost init
 *   registryVersion  — version for the init ↔ ready handshake
 *   servicesConfig   — opaque JSON passed to createBundle (default: {})
 *   poolSize         — number of processes (default: NodeSystemInfo)
 *   command          — override spawn command (default: process.execPath)
 *   args             — override spawn args (default: [spawnEntry.js path])
 *   entryUrl         — override the default spawnEntry.js URL (for tests)
 *
 * All properties initialised in constructor for V8 hidden-class stability.
 */

import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';

import { DAG_CONTAINER_WORKER_DIED } from '@studnicky/dagonizer/container';
import type { PoolEntry } from '@studnicky/dagonizer/container';

import { NdjsonChannel } from './NdjsonChannel.js';
import { NodeContainerBase } from './NodeContainerBase.js';
import type { NodeContainerBaseOptions } from './NodeContainerBase.js';

// ---------------------------------------------------------------------------
// SpawnContainerOptions
// ---------------------------------------------------------------------------

export interface SpawnContainerOptions extends NodeContainerBaseOptions {
  readonly command?: string;
  readonly args?: readonly string[];
}

// ---------------------------------------------------------------------------
// SpawnContainer
// ---------------------------------------------------------------------------

export class SpawnContainer extends NodeContainerBase<ChildProcess> {
  readonly #command: string;
  readonly #args: readonly string[];
  readonly #entryUrl: URL;

  constructor(options: SpawnContainerOptions) {
    super(NodeContainerBase.resolveOptions(options));
    this.#entryUrl = options.entryUrl ?? new URL('./spawnEntry.js', import.meta.url);
    this.#command = options.command ?? process.execPath;
    this.#args = options.args ?? [this.#entryUrl.pathname];
  }

  // ---------------------------------------------------------------------------
  // Abstract seam implementations
  // ---------------------------------------------------------------------------

  /**
   * createEntry: spawn a child process + construct an NdjsonChannel, initialized: false.
   * No death listeners, no init handshake — the base handles both.
   */
  protected override createEntry(): PoolEntry<ChildProcess> {
    const child = spawn(this.#command, [...this.#args], {
      'stdio': ['pipe', 'pipe', 'inherit'],
    });

    const { stdin, stdout } = child;
    if (stdin === null || stdout === null) {
      throw new Error('SpawnContainer: spawned process has no stdio pipes');
    }

    const channel = new NdjsonChannel(stdout, stdin);
    return { 'worker': child, 'channel': channel, 'initialized': false };
  }

  /**
   * attachDeathListeners: wire child error/exit and stdout/stdin error/close events → onTransportDeath().
   * NDJSON has no IPC 'disconnect'; stdout 'close' is the equivalent end-of-transport signal.
   * Called unconditionally; the base's #destroyed guard prevents spurious
   * eviction during intentional teardown.
   */
  protected override attachDeathListeners(entry: PoolEntry<ChildProcess>): void {
    const { stdin, stdout } = entry.worker;

    entry.worker.on('error', (err: Error) => {
      this.onTransportDeath(entry, DAG_CONTAINER_WORKER_DIED, `spawned process error: ${err.message}`);
    });
    entry.worker.on('exit', () => {
      this.onTransportDeath(entry, DAG_CONTAINER_WORKER_DIED, 'spawned process exited unexpectedly');
    });
    if (stdout !== null) {
      stdout.on('close', () => {
        this.onTransportDeath(entry, DAG_CONTAINER_WORKER_DIED, 'spawned process stdout closed');
      });
      stdout.on('error', (err: Error) => {
        this.onTransportDeath(entry, DAG_CONTAINER_WORKER_DIED, `spawned process stdout error: ${err.message}`);
      });
    }
    if (stdin !== null) {
      stdin.on('error', (err: Error) => {
        this.onTransportDeath(entry, DAG_CONTAINER_WORKER_DIED, `spawned process stdin error: ${err.message}`);
      });
    }
  }

  /**
   * terminateWorker: force-kill the spawned process. Must not throw.
   */
  protected override terminateWorker(worker: ChildProcess): void {
    worker.kill('SIGKILL');
  }

  /**
   * awaitWorkerExit: resolves when the spawned process's 'exit' event fires.
   */
  protected override awaitWorkerExit(worker: ChildProcess): Promise<void> {
    return new Promise<void>((resolve) => {
      worker.once('exit', () => { resolve(); });
    });
  }
}
