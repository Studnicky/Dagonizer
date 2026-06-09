/**
 * WebWorkerContainer: DagContainerBase over a pool of Web Workers.
 *
 * Each pool slot is a fresh WebWorkerLikeInterface created by the protected
 * `createWorker()` method. This package cannot construct browser workers itself
 * — `new Worker(url)` requires a browser context and a real module URL only the
 * consumer knows — so the base `createWorker()` throws. Consumers extend
 * WebWorkerContainer and override `createWorker()` to return a real worker.
 * Extension is by subclass (zero callbacks, zero function-pass-in).
 *
 * Consumer wiring (browser):
 *
 *   class AppWorkerContainer extends WebWorkerContainer {
 *     protected override createWorker(): WebWorkerLikeInterface {
 *       return new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
 *     }
 *   }
 *
 *   const container = new AppWorkerContainer({
 *     registryModule: new URL('./registry.js', import.meta.url).href,
 *     registryVersion: '1.2.3',
 *   });
 *
 * Pool lifecycle:
 *   - Workers are created lazily on first `runDag` call.
 *   - `acquireChannel()` pops from the idle pool or waits via a promise queue.
 *   - `releaseChannel()` pushes back to the idle pool and resolves the next waiter.
 *   - `destroy()` sends `shutdown` to every spawned worker then terminates it.
 *
 * All properties initialised in constructor for V8 shape stability.
 */

import { DagContainerBase, DAG_CONTAINER_WORKER_DIED } from '@noocodex/dagonizer/container';
import type { DagContainerOptions } from '@noocodex/dagonizer/container';
import type { MessageChannelInterface } from '@noocodex/dagonizer/contracts';
import type { JsonObject } from '@noocodex/dagonizer/entities';
import { RecommendedWorkerCountConfigDefault } from '@noocodex/dagonizer/entities';

import { PostMessageChannel } from './PostMessageChannel.js';
import { WebSystemInfo } from './WebSystemInfo.js';
import type { WebWorkerLikeInterface } from './WebWorkerLike.js';

// ---------------------------------------------------------------------------
// WebWorkerContainerOptions
// ---------------------------------------------------------------------------

export interface WebWorkerContainerOptions extends DagContainerOptions {
  /**
   * Module URL forwarded to the DagHost via the `init` message.
   * The host dynamic-imports this URL to load the registry.
   */
  readonly registryModule: string;
  /**
   * Semantic version string forwarded in `init` and verified against `ready`.
   */
  readonly registryVersion: string;
  /**
   * Services config forwarded to the DagHost's registry module.
   * Defaults to an empty object.
   */
  readonly servicesConfig?: JsonObject;
  /**
   * Number of workers in the pool.
   * Defaults to `WebSystemInfo.recommendedWorkerCount` with
   * `RecommendedWorkerCountConfigDefault` and `hardwareConcurrency`
   * from `navigator` when available, falling back to 2.
   */
  readonly poolSize?: number;
}

// ---------------------------------------------------------------------------
// PoolSlot — tracks the channel and the underlying worker together
// ---------------------------------------------------------------------------

interface PoolSlot {
  readonly channel: MessageChannelInterface;
  readonly worker: WebWorkerLikeInterface;
}

// ---------------------------------------------------------------------------
// WebWorkerContainer
// ---------------------------------------------------------------------------

export class WebWorkerContainer extends DagContainerBase {
  readonly #registryModule: string;
  readonly #registryVersion: string;
  readonly #servicesConfig: JsonObject;
  readonly #poolSize: number;
  /** All spawned slots (idle + in-use). Parallel to pool state. */
  readonly #allSlots: PoolSlot[];
  /** Idle slots available for acquisition. */
  readonly #idleSlots: PoolSlot[];
  /** Resolve callbacks for callers waiting for a free slot. */
  readonly #waiters: Array<(slot: PoolSlot) => void>;
  /** Set by destroy(); gates death handlers off during intentional teardown. */
  #destroyed: boolean;

  constructor(options: WebWorkerContainerOptions) {
    super(options.instrumentation !== undefined
      ? { 'instrumentation': options.instrumentation }
      : {});
    this.#registryModule = options.registryModule;
    this.#registryVersion = options.registryVersion;
    this.#servicesConfig = options.servicesConfig ?? {};
    this.#poolSize = options.poolSize ?? WebWorkerContainer.#defaultPoolSize();
    this.#allSlots = [];
    this.#idleSlots = [];
    this.#waiters = [];
    this.#destroyed = false;
  }

  // ---------------------------------------------------------------------------
  // DagContainerBase abstract implementation
  // ---------------------------------------------------------------------------

  protected async acquireChannel(): Promise<MessageChannelInterface> {
    // Fast path: take from the idle pool.
    const idle = this.#idleSlots.pop();
    if (idle !== undefined) {
      return idle.channel;
    }

    // Grow path: spawn a new worker if the pool is not full yet.
    if (this.#allSlots.length < this.#poolSize) {
      const slot = await this.#spawnSlot();
      return slot.channel;
    }

    // Wait path: block until a slot is released.
    return new Promise<MessageChannelInterface>((resolve) => {
      this.#waiters.push((slot) => resolve(slot.channel));
    });
  }

  protected releaseChannel(channel: MessageChannelInterface): void {
    // Find the slot by channel reference.
    const slot = this.#allSlots.find((s) => s.channel === channel);
    if (slot === undefined) return;

    const waiter = this.#waiters.shift();
    if (waiter !== undefined) {
      // Hand directly to the next waiter.
      waiter(slot);
    } else {
      this.#idleSlots.push(slot);
    }
  }

  async destroy(): Promise<void> {
    this.#destroyed = true;
    // Send shutdown to every spawned worker then terminate.
    for (const slot of this.#allSlots) {
      try {
        slot.channel.send({
          'kind': 'shutdown',
        });
      } catch {
        // Suppress — terminate unconditionally below.
      }
      try {
        slot.worker.terminate();
      } catch {
        // Suppress — worker may already be dead.
      }
    }

    this.#allSlots.length = 0;
    this.#idleSlots.length = 0;
    this.#waiters.length = 0;
  }

  // ---------------------------------------------------------------------------
  // Worker construction (override point)
  // ---------------------------------------------------------------------------

  /**
   * Create a fresh worker for a pool slot. The base implementation throws:
   * this package cannot reference `new Worker(url)` because the module URL
   * belongs to the consumer's bundle and `Worker` requires a browser context.
   *
   * Subclass WebWorkerContainer and override this method to return a real
   * worker, for example:
   *
   *   protected override createWorker(): WebWorkerLikeInterface {
   *     return new Worker(new URL('./your-entry.js', import.meta.url), { type: 'module' });
   *   }
   */
  protected createWorker(): WebWorkerLikeInterface {
    throw new Error(
      'WebWorkerContainer.createWorker() must be overridden — subclass ' +
      'WebWorkerContainer and implement createWorker() to return ' +
      "`new Worker(new URL('./your-entry.js', import.meta.url), { type: 'module' })`.",
    );
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  async #spawnSlot(): Promise<PoolSlot> {
    const worker = this.createWorker();
    const channel = new PostMessageChannel(worker);

    // Death detection (parent backstop, Law 4): a worker that throws an
    // uncaught error fires 'error'. Fail its in-flight request and evict the
    // slot so a fresh worker spawns on the next acquire. #destroyed gates the
    // handler off during intentional teardown (terminate() emits no 'error').
    worker.addEventListener('error', (event) => {
      if (this.#destroyed) return;
      this.#handleDeath(channel, `web worker error: ${event.message ?? 'uncaught error'}`);
    });

    await this.initializeChannel(channel, {
      'registryModule': this.#registryModule,
      'registryVersion': this.#registryVersion,
      'servicesConfig': this.#servicesConfig,
    });

    const slot: PoolSlot = { 'channel': channel, 'worker': worker };
    this.#allSlots.push(slot);
    return slot;
  }

  /**
   * Fail the dead worker's in-flight request and evict its slot from the pool
   * so it is never re-acquired.
   */
  #handleDeath(channel: MessageChannelInterface, reason: string): void {
    if (this.#destroyed) return;
    this.failChannel(channel, DAG_CONTAINER_WORKER_DIED, reason);
    this.#evict(channel);
  }

  /** Remove the dead slot from #allSlots and #idleSlots, then terminate it. */
  #evict(channel: MessageChannelInterface): void {
    const slotIdx = this.#allSlots.findIndex((s) => s.channel === channel);
    if (slotIdx === -1) return;
    const slot = this.#allSlots[slotIdx];
    if (slot === undefined) return;
    this.#allSlots.splice(slotIdx, 1);
    const idleIdx = this.#idleSlots.indexOf(slot);
    if (idleIdx !== -1) this.#idleSlots.splice(idleIdx, 1);
    try { slot.worker.terminate(); } catch { /* suppress */ }
    try { slot.channel.close(); } catch { /* suppress */ }
  }

  static #defaultPoolSize(): number {
    // Safe probe: navigator is unavailable in Node test environments.
    // Access through globalThis to avoid a DOM-lib type dependency.
    const nav = (globalThis as Record<string, unknown>)['navigator'];
    const concurrency = (
      nav !== null &&
      nav !== undefined &&
      typeof (nav as Record<string, unknown>)['hardwareConcurrency'] === 'number'
    )
      ? (nav as Record<string, unknown>)['hardwareConcurrency'] as number
      : 2;

    const info = new WebSystemInfo({ 'hardwareConcurrency': concurrency });
    const config = { ...RecommendedWorkerCountConfigDefault, 'maximumWorkers': 8 };
    return info.recommendedWorkerCount(config);
  }
}
