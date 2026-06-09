/**
 * ForkContainer: DagContainerBase over a child_process.fork pool.
 *
 * Each pool slot is a forked child process running forkEntry.js. IPC is the
 * transport; IpcChannel wraps the child's send/on. Requests are serialized
 * per-child: each child handles one request at a time; concurrent requests
 * queue until a slot is free.
 *
 * Constructor options:
 *   registryModule   — URL string passed to DagHost init
 *   registryVersion  — version for the init ↔ ready handshake
 *   servicesConfig   — opaque JSON passed to createBundle (default: {})
 *   poolSize         — number of child processes (default: NodeSystemInfo)
 *   instrumentation  — forwarded to DagContainerBase
 *   entryUrl         — override the default forkEntry.js URL (for tests)
 *
 * All properties initialised in constructor for V8 hidden-class stability.
 */

import { fork } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';

import { DagContainerBase, DAG_CONTAINER_WORKER_DIED } from '@noocodex/dagonizer/container';
import type { Instrumentation, MessageChannelInterface } from '@noocodex/dagonizer/contracts';
import type { JsonObject } from '@noocodex/dagonizer/entities';
import { RecommendedWorkerCountConfigDefault } from '@noocodex/dagonizer/entities';

import { IpcChannel } from './IpcChannel.js';
import { NodeSystemInfo } from './NodeSystemInfo.js';

// ---------------------------------------------------------------------------
// ForkContainerOptions
// ---------------------------------------------------------------------------

export interface ForkContainerOptions {
  readonly registryModule: string;
  readonly registryVersion: string;
  readonly servicesConfig?: JsonObject;
  readonly poolSize?: number;
  readonly instrumentation?: Instrumentation;
  readonly entryUrl?: URL;
}

// ---------------------------------------------------------------------------
// ForkPoolEntry
// ---------------------------------------------------------------------------

interface ForkPoolEntry {
  child: ChildProcess;
  channel: IpcChannel;
  initialized: boolean;
}

// ---------------------------------------------------------------------------
// ForkContainer
// ---------------------------------------------------------------------------

export class ForkContainer extends DagContainerBase {
  readonly #registryModule: string;
  readonly #registryVersion: string;
  readonly #servicesConfig: JsonObject;
  readonly #poolSize: number;
  readonly #entryUrl: URL;

  readonly #pool: ForkPoolEntry[];
  readonly #free: ForkPoolEntry[];
  #waiters: Array<() => void>;
  #destroyed: boolean;

  constructor(options: ForkContainerOptions) {
    super(options.instrumentation !== undefined ? { 'instrumentation': options.instrumentation } : {});
    this.#registryModule = options.registryModule;
    this.#registryVersion = options.registryVersion;
    this.#servicesConfig = options.servicesConfig ?? {};
    this.#entryUrl = options.entryUrl ?? new URL('./forkEntry.js', import.meta.url);

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
      throw new Error('ForkContainer: destroyed');
    }

    if (this.#free.length === 0 && this.#pool.length < this.#poolSize) {
      const entry = this.#spawnChild();
      this.#pool.push(entry);
      this.#free.push(entry);
    }

    if (this.#free.length === 0) {
      await this.#waitForSlot();
    }

    const entry = this.#free.pop();
    if (entry === undefined) {
      throw new Error('ForkContainer: no free slot after wait');
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

  #spawnChild(): ForkPoolEntry {
    // Fork the entry module. IPC is enabled by default for fork().
    // No execArgv override needed: the package.json "type": "module" makes
    // the compiled .js output ESM.
    const child = fork(this.#entryUrl.pathname, []);

    // child.send expects Serializable; BridgeMessage is JSON-serializable so
    // casting to object satisfies Serializable at this IPC ingest boundary.
    const sendFn = (message: unknown): void => { child.send(message as object); };
    const onFn = (event: 'message', listener: (message: unknown) => void) => {
      child.on(event, listener);
      return { 'send': sendFn, 'on': onFn };
    };

    const channel = new IpcChannel({ 'send': sendFn, 'on': onFn });
    const entry: ForkPoolEntry = { 'child': child, 'channel': channel, 'initialized': false };

    // Death detection (parent backstop, Law 4): a child that dies, errors, or
    // disconnects without sending a result must fail its in-flight request and
    // be evicted. destroy() kills children deliberately (SIGKILL after
    // shutdown), so #destroyed gates the handlers off during teardown.
    child.on('error', (err: Error) => {
      this.#handleDeath(entry, `child error: ${err.message}`);
    });
    child.on('exit', () => {
      if (this.#destroyed) return;
      this.#handleDeath(entry, 'child exited unexpectedly');
    });
    child.on('disconnect', () => {
      if (this.#destroyed) return;
      this.#handleDeath(entry, 'child IPC channel disconnected');
    });

    return entry;
  }

  /** Fail the dead child's in-flight request and evict its pool entry. */
  #handleDeath(entry: ForkPoolEntry, reason: string): void {
    if (this.#destroyed) return;
    this.failChannel(entry.channel, DAG_CONTAINER_WORKER_DIED, reason);
    this.#evict(entry);
  }

  /** Remove a dead entry from #pool and #free, then wake a slot waiter. */
  #evict(entry: ForkPoolEntry): void {
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
