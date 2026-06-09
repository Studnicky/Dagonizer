/**
 * conformance.test.ts: DagConformance gate for WebWorkerContainer.
 *
 * Architecture:
 *   FakeWorker implements WebWorkerLikeInterface entirely in-process.
 *   Its "inside" is a WorkerScopeLikeInterface wired to a DagHost started via
 *   WebWorkerEntry.start(). Every postMessage hop applies structuredClone so
 *   serialization is fully exercised both directions.
 *
 *   The conformance registry is re-exported from:
 *     tests/unit/fixtures/registry.ts (compiled to dist-test/tests/unit/fixtures/registry.js)
 *   The DagHost dynamic-imports that URL so it reconstructs the identical bundle.
 *
 * Test groups:
 *   (1) DagConformance.laws() — Laws 1–6 and 9, full in-process serialization
 *   (2) Pool behavior — poolSize 2, 3 concurrent runDag calls → 3rd waits for a slot
 *   (3) destroy() — terminate called on every spawned worker
 *
 * Law 6 instrumentation note:
 *   DagContainerBase.runDag re-fires forwarded instrumentation via its own
 *   this.instrumentation field, which is set at construction time. For Law 6 to
 *   observe instrumentation on the parent dispatcher, the container must be
 *   constructed with the law's instrumentation — so createDispatcher creates a
 *   fresh WebWorkerContainer per law, injecting the instrumentation option.
 *   This mirrors the core package executor-conformance.test.ts pattern.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { setImmediate } from 'node:timers';
import { URL } from 'node:url';

import { Dagonizer } from '@noocodex/dagonizer';
import type { DagonizerInterface, DispatcherBundle, NodeStateInterface } from '@noocodex/dagonizer';
import type { DagContainerInterface, Instrumentation } from '@noocodex/dagonizer/contracts';
import {
  buildConformanceBundle,
  ConformanceState,
  CONFORMANCE_CONTAINER_ROLE,
  CONFORMANCE_DAG,
  CONFORMANCE_REGISTRY_VERSION,
  DagConformance,
} from '@noocodex/dagonizer/testing';
import type {
  DagConformanceHarnessInterface,
} from '@noocodex/dagonizer/testing';

import { WebWorkerContainer } from '../../src/WebWorkerContainer.js';
import type { WebWorkerContainerOptions } from '../../src/WebWorkerContainer.js';
import { WebWorkerEntry } from '../../src/webWorkerEntry.js';
import type { WebWorkerLikeInterface, WorkerScopeLikeInterface } from '../../src/WebWorkerLike.js';

// ---------------------------------------------------------------------------
// ConformanceRegistry module URL
//
// Resolves to the compiled fixtures/registry.js in dist-test. The DagHost
// inside FakeWorker dynamic-imports this URL to reconstruct the bundle.
// ---------------------------------------------------------------------------

function conformanceRegistryUrl(): string {
  return new URL('./fixtures/registry.js', import.meta.url).href;
}

// ---------------------------------------------------------------------------
// FakeWorker: in-process WebWorkerLikeInterface
//
// Pairs a main-side (WebWorkerLikeInterface) with a worker-side
// (WorkerScopeLikeInterface). Every postMessage hop applies structuredClone
// so non-serializable values fail honestly. The worker side boots a DagHost
// via WebWorkerEntry.start().
// ---------------------------------------------------------------------------

class FakeWorker implements WebWorkerLikeInterface {
  readonly #workerScope: FakeWorkerScope;
  #mainListeners: Array<(event: { 'data': unknown }) => void>;
  #errorListeners: Array<(event: { 'message'?: string }) => void>;
  #terminated: boolean;
  terminateCalled: boolean;

  constructor() {
    this.#mainListeners = [];
    this.#errorListeners = [];
    this.#terminated = false;
    this.terminateCalled = false;

    // Create the worker-scope side. It posts messages back to the main side.
    this.#workerScope = new FakeWorkerScope((message: unknown) => {
      if (this.#terminated) return;
      const cloned = structuredClone(message);
      setImmediate(() => {
        for (const listener of this.#mainListeners) {
          listener({ 'data': cloned });
        }
      });
    });

    // Boot the DagHost inside the fake worker immediately.
    // This mirrors what a real worker file does on load.
    const scope = this.#workerScope as unknown as WorkerScopeLikeInterface;
    void Promise.resolve().then(() => {
      WebWorkerEntry.start(scope);
    });
  }

  postMessage(message: unknown): void {
    if (this.#terminated) return;
    const cloned = structuredClone(message);
    setImmediate(() => {
      this.#workerScope.deliverFromMain({ 'data': cloned });
    });
  }

  addEventListener(type: 'message', listener: (event: { 'data': unknown }) => void): void;
  addEventListener(type: 'error', listener: (event: { 'message'?: string }) => void): void;
  addEventListener(
    type: 'message' | 'error',
    listener: ((event: { 'data': unknown }) => void) | ((event: { 'message'?: string }) => void),
  ): void {
    if (type === 'message') {
      this.#mainListeners.push(listener as (event: { 'data': unknown }) => void);
    } else {
      this.#errorListeners.push(listener as (event: { 'message'?: string }) => void);
    }
  }

  terminate(): void {
    this.#terminated = true;
    this.terminateCalled = true;
    this.#mainListeners = [];
    this.#errorListeners = [];
  }

  /**
   * Simulate an uncaught worker error WITHOUT sending any result/error message
   * — the web equivalent of a silent isolate death. Fires the 'error'
   * listeners so the container's death-detection backstop engages.
   */
  simulateError(message: string): void {
    if (this.#terminated) return;
    this.#terminated = true;
    const listeners = [...this.#errorListeners];
    for (const listener of listeners) {
      listener({ 'message': message });
    }
  }
}

/**
 * FakeWorkerScope: the inside-the-worker side.
 *
 * Implements WorkerScopeLikeInterface. Has an additional `deliverFromMain`
 * method that FakeWorker calls to push messages inward.
 */
class FakeWorkerScope {
  readonly #postToMain: (message: unknown) => void;
  #listeners: Array<(event: { 'data': unknown }) => void>;

  constructor(postToMain: (message: unknown) => void) {
    this.#postToMain = postToMain;
    this.#listeners = [];
  }

  postMessage(message: unknown): void {
    this.#postToMain(message);
  }

  addEventListener(_type: 'message', listener: (event: { 'data': unknown }) => void): void {
    this.#listeners.push(listener);
  }

  /** Called by FakeWorker to deliver a message from the main thread inward. */
  deliverFromMain(event: { 'data': unknown }): void {
    for (const listener of this.#listeners) {
      listener(event);
    }
  }
}

// ---------------------------------------------------------------------------
// FakeWebWorkerContainer: subclass overriding createWorker() to return an
// in-process FakeWorker. Extension is by subclass (zero callbacks), mirroring
// the production wiring where a consumer subclass returns `new Worker(url)`.
// Every spawned worker is recorded in `spawned` so destroy()/teardown tests can
// assert terminate() was called on each.
// ---------------------------------------------------------------------------

class FakeWebWorkerContainer extends WebWorkerContainer {
  readonly spawned: FakeWorker[] = [];

  protected override createWorker(): WebWorkerLikeInterface {
    const worker = new FakeWorker();
    this.spawned.push(worker);
    return worker;
  }
}

// ---------------------------------------------------------------------------
// buildContainer: factory for per-law FakeWebWorkerContainer
//
// Creates a fresh container with a FakeWorker pool size of 1. Injecting
// instrumentation ensures that DagContainerBase.runDag re-fires forwarded
// instrumentation messages via the law's instrumentation instance (necessary
// for Law 6).
// ---------------------------------------------------------------------------

function buildContainer(instrumentation?: Instrumentation): FakeWebWorkerContainer {
  const opts: WebWorkerContainerOptions = instrumentation !== undefined
    ? {
      'registryModule': conformanceRegistryUrl(),
      'registryVersion': CONFORMANCE_REGISTRY_VERSION,
      'poolSize': 1,
      'instrumentation': instrumentation,
    }
    : {
      'registryModule': conformanceRegistryUrl(),
      'registryVersion': CONFORMANCE_REGISTRY_VERSION,
      'poolSize': 1,
    };
  return new FakeWebWorkerContainer(opts);
}

// ---------------------------------------------------------------------------
// Per-law container tracking for teardown
// ---------------------------------------------------------------------------

const perLawContainers: FakeWebWorkerContainer[] = [];

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const harness: DagConformanceHarnessInterface = {
  'createDispatcher'(
    bundle: DispatcherBundle<NodeStateInterface, undefined>,
    _containers: Readonly<Record<string, DagContainerInterface>>,
    instrumentation?: Instrumentation,
  ): DagonizerInterface<NodeStateInterface, undefined> {
    // Create a fresh per-law container with the law's instrumentation so that
    // DagContainerBase.runDag fires forwarded instrumentation on the correct
    // instance (required for Law 6). Ignore the incoming _containers arg —
    // the sentinel harness.container is only a placeholder.
    const container = buildContainer(instrumentation);
    perLawContainers.push(container);
    const containers = { [CONFORMANCE_CONTAINER_ROLE]: container } as Readonly<Record<string, DagContainerInterface>>;
    const opts = instrumentation !== undefined
      ? { 'containers': containers, 'instrumentation': instrumentation }
      : { 'containers': containers };
    const dispatcher = new Dagonizer<NodeStateInterface, undefined>(opts);
    dispatcher.registerBundle(bundle);
    return dispatcher as DagonizerInterface<NodeStateInterface, undefined>;
  },
  'createState'(): ConformanceState {
    return new ConformanceState();
  },
  'containerRole': CONFORMANCE_CONTAINER_ROLE,
  // Sentinel container accessed only by laws that bypass createDispatcher (none currently).
  'container': buildContainer(),
  async teardown(): Promise<void> {
    for (const c of perLawContainers.splice(0)) {
      await c.destroy();
    }
  },
};

// ---------------------------------------------------------------------------
// (1) DagConformance.laws() — Laws 1–6 and 9, full in-process serialization
// ---------------------------------------------------------------------------

void describe('DagConformance — WebWorkerContainer (Laws 1–6, 9)', () => {
  for (const law of DagConformance.laws(harness)) {
    void it(law.name, async () => {
      await law.run();
      await harness.teardown();
    });
  }
});

// ---------------------------------------------------------------------------
// (2) Pool behavior: poolSize 2, three concurrent runDag calls → 3rd waits
// ---------------------------------------------------------------------------

void describe('WebWorkerContainer pool behavior', () => {
  void it('queues the third execute when poolSize is 2', async () => {
    const registryModule = conformanceRegistryUrl();

    const container = new FakeWebWorkerContainer({
      'registryModule': registryModule,
      'registryVersion': CONFORMANCE_REGISTRY_VERSION,
      'poolSize': 2,
    });

    const bundle = buildConformanceBundle().bundle as DispatcherBundle<NodeStateInterface, undefined>;
    const containers = { [CONFORMANCE_CONTAINER_ROLE]: container as DagContainerInterface };
    const dispatcher = new Dagonizer<NodeStateInterface, undefined>({ 'containers': containers });
    dispatcher.registerBundle(bundle);

    const state1 = new ConformanceState();
    const state2 = new ConformanceState();
    const state3 = new ConformanceState();

    // Launch 3 concurrent executes. With poolSize=2 the 3rd must queue.
    const completionOrder: number[] = [];

    const p1 = dispatcher.execute(CONFORMANCE_DAG.law1, state1).then(() => { completionOrder.push(1); });
    const p2 = dispatcher.execute(CONFORMANCE_DAG.law1, state2).then(() => { completionOrder.push(2); });
    const p3 = dispatcher.execute(CONFORMANCE_DAG.law1, state3).then(() => { completionOrder.push(3); });

    await Promise.all([p1, p2, p3]);

    assert.strictEqual(completionOrder.length, 3, 'all 3 executes must complete');
    // The 3rd must complete after at least one of the first two (it was queued).
    assert.ok(
      completionOrder.includes(1) && completionOrder.includes(2) && completionOrder.includes(3),
      'all 3 executes must appear in the completion log',
    );

    await container.destroy();
  });
});

// ---------------------------------------------------------------------------
// (3) destroy(): terminate called on every spawned worker
// ---------------------------------------------------------------------------

void describe('WebWorkerContainer destroy()', () => {
  void it('calls terminate() on every spawned worker after destroy()', async () => {
    const registryModule = conformanceRegistryUrl();

    const container = new FakeWebWorkerContainer({
      'registryModule': registryModule,
      'registryVersion': CONFORMANCE_REGISTRY_VERSION,
      'poolSize': 3,
    });
    const spawnedWorkers = container.spawned;

    const bundle = buildConformanceBundle().bundle as DispatcherBundle<NodeStateInterface, undefined>;
    const containers = { [CONFORMANCE_CONTAINER_ROLE]: container as DagContainerInterface };
    const dispatcher = new Dagonizer<NodeStateInterface, undefined>({ 'containers': containers });
    dispatcher.registerBundle(bundle);

    // Run 3 executes to spawn all pool workers.
    const state1 = new ConformanceState();
    const state2 = new ConformanceState();
    const state3 = new ConformanceState();

    await Promise.all([
      dispatcher.execute(CONFORMANCE_DAG.law1, state1),
      dispatcher.execute(CONFORMANCE_DAG.law1, state2),
      dispatcher.execute(CONFORMANCE_DAG.law1, state3),
    ]);

    assert.strictEqual(spawnedWorkers.length, 3, '3 workers should have been spawned');

    // Destroy the container.
    await container.destroy();

    // Every spawned worker must have had terminate() called.
    for (const worker of spawnedWorkers) {
      assert.strictEqual(worker.terminateCalled, true, 'terminate() must be called on every worker');
    }
  });
});
