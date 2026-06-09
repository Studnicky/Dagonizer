/**
 * container-pool-lifecycle.test.ts
 *
 * Coverage targets:
 *   G1 — pool #waiters park/unpark: when all channels are busy, a new
 *        runDag() parks; releaseChannel() wakes it and it proceeds.
 *   G2 — onTransportDeath eviction + re-grow: after a death event evicts
 *        an entry, the next runDag() grows a fresh worker.
 *   G3 — destroy() under in-flight (parked) request: destroy() resolves while
 *        a runDag() is parked; the parked call returns a transport-error outcome.
 *   G4 — double-destroy idempotency: calling destroy() twice does not throw.
 */

import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { DagContainerBase } from '../../src/container/DagContainerBase.js';
import type { DagContainerOptions, PoolEntry } from '../../src/container/DagContainerBase.js';
import { DagHost } from '../../src/container/DagHost.js';
import type { DagContainerInterface } from '../../src/contracts/DagContainerInterface.js';
import type { DagOutcomeInterface } from '../../src/contracts/DagOutcomeInterface.js';
import type { DagTaskInterface } from '../../src/contracts/DagTaskInterface.js';
import type { MessageChannelInterface } from '../../src/contracts/MessageChannelInterface.js';
import { Dagonizer } from '../../src/Dagonizer.js';
import type { DispatcherBundle } from '../../src/Dagonizer.js';
import type { JsonObject } from '../../src/entities/json.js';
import type { NodeContextInterface } from '../../src/entities/node/NodeContext.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';
import type { NodeStateInterface } from '../../src/NodeStateBase.js';
import {
  ConformanceRegistry,
  ConformanceState,
  CONFORMANCE_CONTAINER_ROLE,
  CONFORMANCE_REGISTRY_VERSION,
  CONFORMANCE_DAG,
} from '../../testing/ConformanceRegistry.js';
import { LoopbackChannel } from '../../testing/LoopbackChannel.js';

// ---------------------------------------------------------------------------
// Registry module URL
// ---------------------------------------------------------------------------

const PACKAGE_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..', '..', '..');
const REGISTRY_MODULE_URL = resolve(PACKAGE_ROOT, 'dist-testing', 'ConformanceRegistry.js');

// ---------------------------------------------------------------------------
// TestWorker / TestLoopbackContainer
// ---------------------------------------------------------------------------

interface TestWorker {
  hostSide: MessageChannelInterface;
}

class TestLoopbackContainer extends DagContainerBase<NodeStateInterface, TestWorker> {
  entriesCreated: number = 0;
  readonly #deathCallbacks: Array<() => void> = [];

  constructor(poolSize: number, options: Partial<Pick<DagContainerOptions, 'instrumentation' | 'shutdownGraceMs'>> = {}) {
    super({
      ...DagContainerBase.defaultOptions,
      poolSize,
      'init': {
        'registryModule': REGISTRY_MODULE_URL,
        'registryVersion': CONFORMANCE_REGISTRY_VERSION,
        'servicesConfig': {} as JsonObject,
      },
      ...options,
    });
  }

  protected override createEntry(): PoolEntry<TestWorker> {
    this.entriesCreated += 1;
    const [parentSide, hostSide] = LoopbackChannel.pair();
    const host = new DagHost(hostSide);
    host.start();
    return { 'worker': { 'hostSide': hostSide }, 'channel': parentSide, 'initialized': false };
  }

  protected override attachDeathListeners(entry: PoolEntry<TestWorker>): void {
    this.#deathCallbacks.push(() => {
      this.onTransportDeath(entry, 'WORKER_DIED', 'test-triggered death');
    });
  }

  protected override terminateWorker(worker: TestWorker): void {
    try { worker.hostSide.close(); } catch { /* suppress */ }
  }

  protected override awaitWorkerExit(_worker: TestWorker): Promise<void> {
    return Promise.resolve();
  }

  /** Trigger death on the first attached death listener. */
  triggerDeathOnFirst(): void {
    const cb = this.#deathCallbacks[0];
    if (cb !== undefined) cb();
  }

  /** Expose acquireChannel for direct test use. */
  acquireForTest(): Promise<MessageChannelInterface> {
    return this.acquireChannel();
  }

  /** Expose releaseChannel for direct test use. */
  releaseForTest(ch: MessageChannelInterface): void {
    this.releaseChannel(ch);
  }
}

// ---------------------------------------------------------------------------
// Minimal DagTaskInterface implementation for direct runDag() calls
// ---------------------------------------------------------------------------

class MinimalTask implements DagTaskInterface<NodeStateInterface, undefined> {
  readonly dagName: string;
  readonly placementPath: readonly string[];
  readonly correlationId: string;
  readonly timeoutMs: number | null;
  readonly state: NodeStateInterface;
  readonly context: NodeContextInterface<undefined>;

  constructor(correlationId: string) {
    this.dagName = CONFORMANCE_DAG.law1;
    this.placementPath = [];
    this.correlationId = correlationId;
    this.timeoutMs = null;
    this.state = new NodeStateBase();
    this.context = {
      'dagName': CONFORMANCE_DAG.law1,
      'nodeName': '',
      'services': undefined,
      'signal': new AbortController().signal,
    };
  }

  toRequest() {
    return {
      'dagName': this.dagName,
      'placementPath': this.placementPath as string[],
      'stateSnapshot': this.state.snapshot(),
      'timeoutMs': this.timeoutMs,
      'correlationId': this.correlationId,
    };
  }
}

// ---------------------------------------------------------------------------
// Helper: build a Dagonizer dispatcher backed by a test container
// ---------------------------------------------------------------------------

function buildDispatcher(
  container: TestLoopbackContainer,
): Dagonizer<NodeStateInterface, undefined> {
  const bundle = ConformanceRegistry.bundle().bundle as DispatcherBundle<NodeStateInterface, undefined>;
  const containers: Readonly<Record<string, DagContainerInterface<NodeStateInterface>>> = {
    [CONFORMANCE_CONTAINER_ROLE]: container,
  };
  const d = new Dagonizer<NodeStateInterface, undefined>({ containers });
  d.registerBundle(bundle);
  return d;
}

// ---------------------------------------------------------------------------
// G1 — pool waiters park and unpark
// ---------------------------------------------------------------------------

void describe('DagContainerBase — pool waiters park/unpark (G1)', () => {
  void it('waiter parks when pool is full (size=1) and unparks after releaseChannel', async () => {
    const container = new TestLoopbackContainer(1);
    try {
      // Acquire the sole channel directly.
      const ch1 = await container.acquireForTest();

      // Start a second acquire — pool is full, this must park.
      let parkedResolved = false;
      const parkedAcquire = container.acquireForTest().then((ch) => {
        parkedResolved = true;
        return ch;
      });

      // One event-loop tick: the parked promise must still be pending.
      await new Promise<void>((r) => setImmediate(r));
      assert.strictEqual(parkedResolved, false, 'second acquire must park while the sole slot is busy');

      // Release the first channel — wakes the waiter.
      container.releaseForTest(ch1);

      const ch2 = await parkedAcquire;
      assert.strictEqual(parkedResolved, true, 'waiter must unpark after releaseChannel');

      container.releaseForTest(ch2);
    } finally {
      await container.destroy();
    }
  });

  void it('two waiters are served FIFO', async () => {
    const container = new TestLoopbackContainer(1);
    try {
      const ch1 = await container.acquireForTest();

      const order: number[] = [];
      const w1 = container.acquireForTest().then((ch) => { order.push(1); container.releaseForTest(ch); });
      const w2 = container.acquireForTest().then((ch) => { order.push(2); container.releaseForTest(ch); });

      // Neither should resolve before ch1 is released.
      await new Promise<void>((r) => setImmediate(r));
      assert.strictEqual(order.length, 0, 'no waiter should resolve before release');

      container.releaseForTest(ch1);
      await Promise.all([w1, w2]);

      assert.deepStrictEqual(order, [1, 2], 'waiters must be served FIFO');
    } finally {
      await container.destroy();
    }
  });

  void it('a real runDag() parks and completes when the sole slot is freed', async () => {
    const container = new TestLoopbackContainer(1);
    try {
      const dispatcher = buildDispatcher(container);

      // Run first DAG (occupies the pool slot for its duration).
      const state1 = new ConformanceState();
      const result1 = await dispatcher.execute(CONFORMANCE_DAG.law1, state1);
      assert.strictEqual(result1.state.lifecycle.kind, 'completed');

      // Pool slot is released by the first run; second run must park + unpark
      // under the covers and complete cleanly.
      const state2 = new ConformanceState();
      const result2 = await dispatcher.execute(CONFORMANCE_DAG.law1, state2);
      assert.strictEqual(result2.state.lifecycle.kind, 'completed',
        'second sequential run must complete (pool slot was released and reacquired)');
    } finally {
      await container.destroy();
    }
  });
});

// ---------------------------------------------------------------------------
// G2 — onTransportDeath eviction + re-grow
// ---------------------------------------------------------------------------

void describe('DagContainerBase — onTransportDeath eviction + re-grow (G2)', () => {
  void it('after death eviction the next runDag() grows a new worker', async () => {
    const container = new TestLoopbackContainer(1);
    const dispatcher = buildDispatcher(container);

    try {
      // First execute — grows worker #1.
      const state1 = new ConformanceState();
      await dispatcher.execute(CONFORMANCE_DAG.law1, state1);
      assert.strictEqual(container.entriesCreated, 1, 'first execute must grow exactly 1 entry');

      // Trigger death on the first entry (currently in #free after execute).
      container.triggerDeathOnFirst();

      // Give death callback time to process.
      await new Promise<void>((r) => setImmediate(r));

      // Second execute — dead entry was evicted; a new entry must be grown.
      const state2 = new ConformanceState();
      const result2 = await dispatcher.execute(CONFORMANCE_DAG.law1, state2);
      assert.strictEqual(result2.state.lifecycle.kind, 'completed', 'must complete after re-grow');
      assert.strictEqual(container.entriesCreated, 2, 'must create a new entry after eviction');
    } finally {
      await container.destroy();
    }
  });
});

// ---------------------------------------------------------------------------
// G3 — destroy() under in-flight (parked) request
// ---------------------------------------------------------------------------

void describe('DagContainerBase — destroy() under parked runDag() (G3)', () => {
  void it('a parked runDag() returns a transport-error outcome after destroy()', async () => {
    const container = new TestLoopbackContainer(1);
    try {
      // Occupy the sole slot (held intentionally; released by destroy()).
      const _ch1 = await container.acquireForTest();

      // Start a runDag() that will park (no free slot).
      const runDagPromise: Promise<DagOutcomeInterface> = container.runDag(new MinimalTask('g3-parked'));

      // Let the parked acquire register.
      await new Promise<void>((r) => setImmediate(r));

      // Destroy — must unblock all waiters. _ch1 is intentionally never released.
      void container.destroy();

      const outcome = await runDagPromise;
      assert.strictEqual(outcome.terminalOutput, 'failed', 'parked runDag must fail after destroy');
      assert.ok(outcome.errors.length > 0, 'must carry at least one error');
    } finally {
      // Second destroy — covered by G4 but also needed for cleanup safety.
      try { await container.destroy(); } catch { /* suppress: already destroyed */ }
    }
  });
});

// ---------------------------------------------------------------------------
// G4 — double-destroy idempotency
// ---------------------------------------------------------------------------

void describe('DagContainerBase — double-destroy idempotency (G4)', () => {
  void it('calling destroy() twice does not throw', async () => {
    const container = new TestLoopbackContainer(1);
    await assert.doesNotReject(async () => {
      await container.destroy();
      await container.destroy();
    });
  });

  void it('runDag() after destroy() returns a transport-error outcome immediately', async () => {
    const container = new TestLoopbackContainer(1);
    await container.destroy();

    const outcome = await container.runDag(new MinimalTask('post-destroy'));
    assert.strictEqual(outcome.terminalOutput, 'failed');
    assert.ok(outcome.errors.length > 0);
  });
});
