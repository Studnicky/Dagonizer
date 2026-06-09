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
 *   instrumentation  — forwarded to DagContainerBase
 *   command          — override spawn command (default: process.execPath)
 *   args             — override spawn args (default: [spawnEntry.js path])
 *   entryUrl         — override the default spawnEntry.js URL (for tests)
 *
 * All properties initialised in constructor for V8 hidden-class stability.
 */

import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';

import { DagContainerBase, DAG_CONTAINER_WORKER_DIED } from '@noocodex/dagonizer/container';
import type { Instrumentation, MessageChannelInterface } from '@noocodex/dagonizer/contracts';
import type { JsonObject } from '@noocodex/dagonizer/entities';
import { RecommendedWorkerCountConfigDefault } from '@noocodex/dagonizer/entities';

import { NdjsonChannel } from './NdjsonChannel.js';
import { NodeSystemInfo } from './NodeSystemInfo.js';

// ---------------------------------------------------------------------------
// SpawnContainerOptions
// ---------------------------------------------------------------------------

export interface SpawnContainerOptions {
  readonly registryModule: string;
  readonly registryVersion: string;
  readonly servicesConfig?: JsonObject;
  readonly poolSize?: number;
  readonly instrumentation?: Instrumentation;
  readonly command?: string;
  readonly args?: readonly string[];
  readonly entryUrl?: URL;
}

// ---------------------------------------------------------------------------
// SpawnPoolEntry
// ---------------------------------------------------------------------------

interface SpawnPoolEntry {
  child: ChildProcess;
  channel: NdjsonChannel;
  initialized: boolean;
}

// ---------------------------------------------------------------------------
// SpawnContainer
// ---------------------------------------------------------------------------

export class SpawnContainer extends DagContainerBase {
  readonly #registryModule: string;
  readonly #registryVersion: string;
  readonly #servicesConfig: JsonObject;
  readonly #poolSize: number;
  readonly #command: string;
  readonly #args: readonly string[];
  readonly #entryUrl: URL;

  readonly #pool: SpawnPoolEntry[];
  readonly #free: SpawnPoolEntry[];
  #waiters: Array<() => void>;
  #destroyed: boolean;

  constructor(options: SpawnContainerOptions) {
    super(options.instrumentation !== undefined ? { 'instrumentation': options.instrumentation } : {});
    this.#registryModule = options.registryModule;
    this.#registryVersion = options.registryVersion;
    this.#servicesConfig = options.servicesConfig ?? {};
    this.#entryUrl = options.entryUrl ?? new URL('./spawnEntry.js', import.meta.url);

    const sysInfo = new NodeSystemInfo();
    const defaultPoolSize = sysInfo.recommendedWorkerCount({
      ...RecommendedWorkerCountConfigDefault,
      'maximumWorkers': 8,
    });
    this.#poolSize = options.poolSize ?? defaultPoolSize;

    this.#command = options.command ?? process.execPath;
    this.#args = options.args ?? [this.#entryUrl.pathname];

    this.#pool = [];
    this.#free = [];
    this.#waiters = [];
    this.#destroyed = false;
  }

  protected async acquireChannel(): Promise<MessageChannelInterface> {
    if (this.#destroyed) {
      throw new Error('SpawnContainer: destroyed');
    }

    if (this.#free.length === 0 && this.#pool.length < this.#poolSize) {
      const entry = this.#spawnProcess();
      this.#pool.push(entry);
      this.#free.push(entry);
    }

    if (this.#free.length === 0) {
      await this.#waitForSlot();
    }

    const entry = this.#free.pop();
    if (entry === undefined) {
      throw new Error('SpawnContainer: no free slot after wait');
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
          this.#waitForChildExit(entry.child),
          new Promise<void>((resolve) => setTimeout(resolve, 2000)),
        ]),
      ),
    );

    for (const entry of this.#pool) {
      try { entry.child.kill('SIGKILL'); } catch { /* suppress */ }
      entry.channel.close();
    }

    this.#pool.length = 0;
    this.#free.length = 0;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  #spawnProcess(): SpawnPoolEntry {
    const child = spawn(this.#command, [...this.#args], {
      'stdio': ['pipe', 'pipe', 'inherit'],
    });

    const { stdin, stdout } = child;
    if (stdin === null || stdout === null) {
      throw new Error('SpawnContainer: spawned process has no stdio pipes');
    }

    const channel = new NdjsonChannel(stdout, stdin);
    const entry: SpawnPoolEntry = { 'child': child, 'channel': channel, 'initialized': false };

    // Death detection (parent backstop, Law 4): a spawned process that dies or
    // whose stdout closes/errors mid-request must fail its in-flight request
    // and be evicted. NDJSON has no IPC 'disconnect'; the readable 'close' is
    // the equivalent end-of-transport signal. #destroyed gates teardown.
    child.on('error', (err: Error) => {
      this.#handleDeath(entry, `spawned process error: ${err.message}`);
    });
    child.on('exit', () => {
      if (this.#destroyed) return;
      this.#handleDeath(entry, 'spawned process exited unexpectedly');
    });
    stdout.on('close', () => {
      if (this.#destroyed) return;
      this.#handleDeath(entry, 'spawned process stdout closed');
    });
    stdout.on('error', (err: Error) => {
      this.#handleDeath(entry, `spawned process stdout error: ${err.message}`);
    });

    return entry;
  }

  /** Fail the dead process's in-flight request and evict its pool entry. */
  #handleDeath(entry: SpawnPoolEntry, reason: string): void {
    if (this.#destroyed) return;
    this.failChannel(entry.channel, DAG_CONTAINER_WORKER_DIED, reason);
    this.#evict(entry);
  }

  /** Remove a dead entry from #pool and #free, then wake a slot waiter. */
  #evict(entry: SpawnPoolEntry): void {
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

  #waitForChildExit(child: ChildProcess): Promise<void> {
    return new Promise<void>((resolve) => {
      child.once('exit', () => resolve());
    });
  }
}
