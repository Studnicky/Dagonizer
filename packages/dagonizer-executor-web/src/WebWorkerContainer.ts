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
 * Pool lifecycle is owned by DagContainerBase: demand growth, semaphore
 * waiting, lazy init, death detection, eviction, graceful shutdown. This
 * class implements the four abstract seams only.
 *
 * All properties initialised in constructor for V8 shape stability.
 */

import {
  DagContainerBase,
  DAG_CONTAINER_WORKER_DIED,
} from '@studnicky/dagonizer/container';
import type {
  PoolEntry,
} from '@studnicky/dagonizer/container';
import type { JsonObject } from '@studnicky/dagonizer/entities';
import { RecommendedWorkerCountConfigDefault } from '@studnicky/dagonizer/entities';
import type { NodeStateInterface } from '@studnicky/dagonizer/types';

import { PostMessageChannel } from './PostMessageChannel.js';
import { DEFAULT_WEB_PROBES, WebSystemInfo } from './WebSystemInfo.js';
import type { WebWorkerLikeInterface } from './WebWorkerLike.js';

// ---------------------------------------------------------------------------
// WebWorkerContainerOptions
// ---------------------------------------------------------------------------

export interface WebWorkerContainerOptions {
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
// WebWorkerContainer
// ---------------------------------------------------------------------------

export class WebWorkerContainer extends DagContainerBase<NodeStateInterface, WebWorkerLikeInterface> {

  constructor(options: WebWorkerContainerOptions) {
    const poolSize = options.poolSize ?? WebWorkerContainer.#resolvePoolSize();
    const servicesConfig: JsonObject = options.servicesConfig ?? {};

    super({
      ...DagContainerBase.defaultOptions,
      'poolSize': poolSize,
      'init': {
        'registryModule': options.registryModule,
        'registryVersion': options.registryVersion,
        'servicesConfig': servicesConfig,
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Abstract seams
  // ---------------------------------------------------------------------------

  /**
   * Construct a fresh worker and its wired channel. Delegates worker creation
   * to `createWorker()` (the consumer override point). Returns a PoolEntry with
   * `initialized: false`; the base attaches death listeners and inits separately.
   */
  protected override createEntry(): PoolEntry<WebWorkerLikeInterface> {
    const worker = this.createWorker();
    const channel = new PostMessageChannel(worker);
    return { 'worker': worker, 'channel': channel, 'initialized': false };
  }

  /**
   * Attach the 'error' listener that fires `onTransportDeath` when the worker
   * throws an uncaught exception. This is the death-detection backstop (Law 4).
   */
  protected override attachDeathListeners(entry: PoolEntry<WebWorkerLikeInterface>): void {
    entry.worker.addEventListener('error', (event) => {
      const reason = `web worker error: ${event.message ?? 'uncaught error'}`;
      this.onTransportDeath(entry, DAG_CONTAINER_WORKER_DIED, reason);
    });
  }

  /**
   * Force-terminate the worker. Called during eviction and destroy. Must not throw.
   */
  protected override terminateWorker(worker: WebWorkerLikeInterface): void {
    worker.terminate();
  }

  /**
   * Web Workers have no exit event; `terminate()` is synchronous. Resolve
   * immediately so the base's graceful-shutdown race proceeds without delay.
   */
  protected override awaitWorkerExit(_worker: WebWorkerLikeInterface): Promise<void> {
    return Promise.resolve();
  }

  // ---------------------------------------------------------------------------
  // Worker construction (consumer override point)
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

  static #resolvePoolSize(): number {
    const info = new WebSystemInfo({ 'hardwareConcurrency': DEFAULT_WEB_PROBES.hardwareConcurrency });
    const config = { ...RecommendedWorkerCountConfigDefault, 'maximumWorkers': 8 };
    return info.recommendedWorkerCount(config);
  }
}
