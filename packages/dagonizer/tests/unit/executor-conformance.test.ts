/**
 * executor-conformance.test.ts
 *
 * Run the dag-containment conformance suite (Laws 1–6, 9) against a
 * LoopbackContainer — a minimal in-test DagContainerBase subclass whose
 * acquireChannel() returns one end of a LoopbackChannel whose other end
 * drives an in-process DagHost.
 *
 * Full structuredClone serialization is exercised because LoopbackChannel
 * uses structuredClone on every message delivery. This proves:
 *   - The transport encoding is correct (no functions, no live references).
 *   - State round-trips through snapshot/transport/restore.
 *   - Observer relay hook events arrive at the parent with correct placementPath.
 *
 * The ConformanceRegistry module URL (dist-testing/ConformanceRegistry.js) is
 * the registry module DagHost dynamic-imports on init.
 */

import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { describe, it, afterEach } from 'node:test';
import { fileURLToPath } from 'node:url';

import { DagContainerBase } from '../../src/container/DagContainerBase.js';
import type { DagContainerOptions, PoolEntry } from '../../src/container/DagContainerBase.js';
import { DagHost } from '../../src/container/DagHost.js';
import type { DagOutcomeInterface } from '../../src/container/DagOutcome.js';
import type { DagTaskInterface } from '../../src/container/DagTask.js';
import { DAG_CONTAINER_TRANSPORT } from '../../src/container/TransportErrorCode.js';
import type { DagContainerInterface } from '../../src/contracts/DagContainerInterface.js';
import type { MessageChannelInterface } from '../../src/contracts/MessageChannelInterface.js';
import { Dagonizer, SCATTER_PROGRESS_KEY } from '../../src/Dagonizer.js';
import type { DispatcherBundle, ObserverRelay, ScatterProgress } from '../../src/Dagonizer.js';
import type { JsonObject } from '../../src/entities/json.js';
import type { NodeError } from '../../src/entities/node/NodeError.js';
import type { NodeStateInterface } from '../../src/NodeStateBase.js';
import {
  ConformanceRegistry,
  ConformanceState,
  CONFORMANCE_CONTAINER_ROLE,
  CONFORMANCE_REGISTRY_VERSION,
  CONFORMANCE_DAG,
} from '../../testing/ConformanceRegistry.js';
import {
  DagConformance,
} from '../../testing/DagConformance.js';
import { LoopbackChannel } from '../../testing/LoopbackChannel.js';

// ---------------------------------------------------------------------------
// Registry module URL
// ---------------------------------------------------------------------------

// The compiled test file is at: dist-test/tests/unit/executor-conformance.test.js
// The conformance registry is at: dist-testing/ConformanceRegistry.js (package root)
const PACKAGE_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..', '..', '..');
const REGISTRY_MODULE_URL = resolve(PACKAGE_ROOT, 'dist-testing', 'ConformanceRegistry.js');

// ---------------------------------------------------------------------------
// LoopbackWorker: the "worker" value held in PoolEntry for test containers.
// Carries the host-side channel so terminateWorker can close it.
// ---------------------------------------------------------------------------

interface LoopbackWorker {
  hostSide: MessageChannelInterface;
}

// ---------------------------------------------------------------------------
// LoopbackContainer: DagContainerBase subclass backed by a single DagHost
// connected over a LoopbackChannel. Uses poolSize:1.
// ---------------------------------------------------------------------------

class LoopbackContainer extends DagContainerBase<NodeStateInterface, LoopbackWorker> {
  constructor(registryModuleUrl: string, options: Partial<DagContainerOptions> = {}) {
    super({
      ...DagContainerBase.defaultOptions,
      'poolSize': 1,
      'init': {
        'registryModule': registryModuleUrl,
        'registryVersion': CONFORMANCE_REGISTRY_VERSION,
        'servicesConfig': {} as JsonObject,
      },
      ...(options.shutdownGraceMs !== undefined ? { 'shutdownGraceMs': options.shutdownGraceMs } : {}),
    });
  }

  protected override createEntry(): PoolEntry<LoopbackWorker> {
    const [parentSide, hostSide] = LoopbackChannel.pair();
    const host = new DagHost(hostSide);
    host.start();
    return { 'worker': { hostSide }, 'channel': parentSide, 'initialized': false };
  }

  protected override attachDeathListeners(_entry: PoolEntry<LoopbackWorker>): void {
    // In-process DagHost — no death events to attach.
  }

  protected override terminateWorker(worker: LoopbackWorker): void {
    try { worker.hostSide.close(); } catch { /* suppress */ }
  }

  protected override awaitWorkerExit(_worker: LoopbackWorker): Promise<void> {
    // In-process host; no real process exit to await.
    return Promise.resolve();
  }
}

// ---------------------------------------------------------------------------
// Per-law container registry — all containers created during a law's run
// are tracked here and destroyed in afterEach.
// ---------------------------------------------------------------------------

interface Destroyable { destroy(): Promise<void>; }

const perLawContainers: Destroyable[] = [];

async function teardownPerLawContainers(): Promise<void> {
  for (const c of perLawContainers.splice(0)) {
    await c.destroy();
  }
}

// ---------------------------------------------------------------------------
// createDispatcherForLaw
//
// Called per-law by DagConformance.laws() internals (via dispatcherFor).
// Creates a fresh LoopbackContainer per dispatcher call and binds it to the
// container role. The DagConformance harness passes an optional observer
// factory; Law 6 uses this to wire a Dagonizer subclass whose hooks fire for
// worker nodes. The harness interface now accepts an observerFactory instead
// of an Instrumentation plugin.
// ---------------------------------------------------------------------------

function createDispatcherForLaw(
  bundle: DispatcherBundle<NodeStateInterface, undefined>,
  _containers: Readonly<Record<string, DagContainerInterface<NodeStateInterface>>>,
): Dagonizer<NodeStateInterface, undefined> {
  // LoopbackContainer demand-grows its pool on first runDag(); no async init
  // needed in the synchronous factory. The base's acquireChannel loop handles
  // lazy entry creation and init on first use.
  const container = new LoopbackContainer(REGISTRY_MODULE_URL);
  perLawContainers.push(container);

  const containers = { [CONFORMANCE_CONTAINER_ROLE]: container } as Readonly<Record<string, DagContainerInterface<NodeStateInterface>>>;
  const dispatcher = new Dagonizer<NodeStateInterface, undefined>({ containers });
  dispatcher.registerBundle(bundle);
  return dispatcher;
}

// LazyLoopbackContainer is an alias for LoopbackContainer: the pool-lifecycle
// base already handles lazy entry creation on first acquire. The type alias
// keeps the harness sentinel construction readable.
const LazyLoopbackContainer = LoopbackContainer;
type LazyLoopbackContainer = LoopbackContainer;

// ---------------------------------------------------------------------------
// Harness — sentinel container for harness.container getter.
// Laws that go through createDispatcher will use LazyLoopbackContainer
// (constructed per-law), so the sentinel is only accessed by laws that
// bypass createDispatcher (none in the current suite).
// ---------------------------------------------------------------------------

let sentinelContainer: LazyLoopbackContainer | null = null;

// The harness is passed to DagConformance.laws(). DagConformanceHarnessInterface
// lives in testing/ which compiles against dist/ types. We bridge via unknown
// cast because the src/ and dist/ Execution<T> private-field brands diverge
// in the dual-compilation world. The runtime shapes are identical.
const harnessRaw = {
  'containerRole': CONFORMANCE_CONTAINER_ROLE,

  get 'container'(): DagContainerInterface {
    if (sentinelContainer === null) {
      // Lazily build a sentinel so the getter never returns null.
      sentinelContainer = new LazyLoopbackContainer(REGISTRY_MODULE_URL);
      perLawContainers.push(sentinelContainer);
    }
    return sentinelContainer;
  },

  createState(): ConformanceState {
    return new ConformanceState();
  },

  'createDispatcher': createDispatcherForLaw,

  // Law 7: build a dispatcher WITHOUT the container role bound so
  // resolveContainer(CONFORMANCE_CONTAINER_ROLE) returns null → inline path.
  createInProcessDispatcher(
    bundle: DispatcherBundle<NodeStateInterface, undefined>,
  ): Dagonizer<NodeStateInterface, undefined> {
    const dispatcher = new Dagonizer<NodeStateInterface, undefined>();
    dispatcher.registerBundle(bundle);
    return dispatcher;
  },

  async teardown(): Promise<void> {
    sentinelContainer = null;
    await teardownPerLawContainers();
  },
};

// Constructs intentionally-invalid input (at the type level): harnessRaw's src/ Execution<T> brand
// diverges from the dist/-compiled DagConformanceHarnessInterface brand; runtime shapes are identical.
const laws = DagConformance.laws(harnessRaw as unknown as Parameters<typeof DagConformance.laws>[0]);

// ---------------------------------------------------------------------------
// Conformance test suite
// ---------------------------------------------------------------------------

describe('DagConformance (LoopbackContainer, structuredClone boundary)', () => {
  afterEach(async () => {
    await harnessRaw.teardown();
  });

  for (const law of laws) {
    const lawName = law.name;
    it(lawName, async () => {
      await law.run();
    });
  }
});

// ---------------------------------------------------------------------------
// Additional direct assertion: state round-trip fixed point (Law 9 explicit)
// ---------------------------------------------------------------------------

describe('LoopbackContainer — state round-trip fixed point (Law 9 direct)', () => {
  it('seed→snapshot→transport→restore→run→snapshot→apply is lossless', async () => {
    // Pool lifecycle handled by base; no explicit initialize() needed.
    const container = new LoopbackContainer(REGISTRY_MODULE_URL);

    try {
      const bundle = ConformanceRegistry.bundle().bundle as DispatcherBundle<NodeStateInterface, undefined>;
      const containers = { [CONFORMANCE_CONTAINER_ROLE]: container } as Readonly<Record<string, DagContainerInterface<NodeStateInterface>>>;
      const dispatcher = new Dagonizer<NodeStateInterface, undefined>({ containers });
      dispatcher.registerBundle(bundle);

      const initialState = new ConformanceState();
      initialState.value = 42; // Seed a non-default value.

      const result = await dispatcher.execute(CONFORMANCE_DAG.law9, initialState);

      assert.strictEqual(result.state, initialState, 'state identity must be preserved');
      assert.strictEqual(
        (result.state as ConformanceState).value, 99,
        'mutator must have set value=99 through snapshot round-trip',
      );
    } finally {
      await container.destroy();
    }
  });
});

// ---------------------------------------------------------------------------
// Law 8 — RETURNS-transport-error path (no throw).
//
// The existing executor-node Law 8 uses a wrapper that THROWS on the 2nd
// runDag (in-process-style reject path). It never exercised the path where
// container.runDag RETURNS a transport-error DagOutcomeInterface (the real
// behavior of DagContainerBase: runDag never throws). This test closes that
// gap directly at the core level.
//
// ReturnTransportErrorAfterOneContainer: routes the FIRST runDag through a real
// LoopbackContainer (so item 0 completes and acks), then RETURNS a transport-
// error outcome (DAG_CONTAINER_TRANSPORT) on every subsequent call WITHOUT
// throwing. The scatter's infra-failure discriminator must convert that into a
// poolError (item left un-acked), so the checkpoint retains the un-acked items
// and a resume on a healthy container reprocesses exactly those items.
// ---------------------------------------------------------------------------

class ReturnTransportErrorAfterOneContainer implements DagContainerInterface<NodeStateInterface> {
  readonly #inner: LazyLoopbackContainer;
  #callCount: number;

  constructor(inner: LazyLoopbackContainer) {
    this.#inner = inner;
    this.#callCount = 0;
  }

  async runDag(task: DagTaskInterface<NodeStateInterface, unknown>, options?: { readonly relay?: ObserverRelay }): Promise<DagOutcomeInterface> {
    this.#callCount += 1;
    if (this.#callCount === 1) {
      // First item: run for real so it acks.
      return this.#inner.runDag(task, options);
    }
    // Subsequent items: RETURN a transport-error outcome (do NOT throw).
    const error: NodeError = {
      'code': DAG_CONTAINER_TRANSPORT,
      'context': {},
      'message': `simulated transport loss for request ${task.correlationId}`,
      'operation': 'runDag',
      'recoverable': false,
      'timestamp': new Date().toISOString(),
    };
    return {
      'terminalOutput': 'failed',
      'errors': [error],
      'stateSnapshot': null,
      'intermediates': [],
    };
  }

  async destroy(): Promise<void> {
    await this.#inner.destroy();
  }
}

describe('DagConformance Law 8 — returns-transport-error mid-scatter (no throw)', () => {
  afterEach(async () => {
    await teardownPerLawContainers();
  });

  it('un-acked items survive a returned transport error; resume reprocesses them', async () => {
    const inner = new LazyLoopbackContainer(REGISTRY_MODULE_URL);
    const failing = new ReturnTransportErrorAfterOneContainer(inner);
    perLawContainers.push(failing);

    const bundle = ConformanceRegistry.bundle().bundle as DispatcherBundle<NodeStateInterface, undefined>;

    // Phase 1: scatter through the failing container. Item 0 acks; item 1
    // returns a transport error → scatter throws (poolError) → item 1 stays
    // un-acked in the inbox; the checkpoint is NOT cleared.
    const state = new ConformanceState();
    state.scatterItems = [10, 20, 30];

    const failingContainers = {
      [CONFORMANCE_CONTAINER_ROLE]: failing,
    } as Readonly<Record<string, DagContainerInterface<NodeStateInterface>>>;
    const failingDispatcher = new Dagonizer<NodeStateInterface, undefined>({ 'containers': failingContainers });
    failingDispatcher.registerBundle(bundle);

    // The dispatcher catches the scatter pool error internally and finalizes a
    // failed lifecycle (it does not rethrow to the caller). What matters for
    // at-least-once is that the infra-failure discriminator threw BEFORE
    // ScatterCheckpoint.clear, so the checkpoint survives with un-acked items.
    const result1 = await failingDispatcher.execute(CONFORMANCE_DAG.law8, state);
    assert.notStrictEqual(
      result1.state.lifecycle.kind, 'completed',
      'phase-1 flow must NOT complete cleanly when an item hit a transport error',
    );

    // The checkpoint must still be present (NOT cleared) and must NOT record
    // all items as acked — the transport-failed item was left un-acked, so
    // ScatterCheckpoint.clear never ran. With an array source, resume
    // reconstructs the un-acked items from the acked-index gap; with a stream
    // source they live in the persisted inbox. Either way the un-acked item is
    // recoverable: the discriminator threw before clear, preserving the
    // checkpoint with fewer than all items acked.
    const progress = state.getMetadata<Record<string, ScatterProgress>>(SCATTER_PROGRESS_KEY);
    const fan = (progress ?? {})['fan'];
    assert.ok(fan !== undefined, 'checkpoint must survive — ScatterCheckpoint.clear must NOT run on infra failure');
    const ackedCount = fan?.ackedResults.length ?? 0;
    assert.strictEqual(ackedCount, 1, `exactly one item must have acked before the transport error, got ${ackedCount}`);
    assert.ok(ackedCount < 3, 'the transport-failed item must NOT be acked (no silent loss)');

    // Phase 2: resume through a healthy container. Un-acked items reprocess.
    const fresh = new LazyLoopbackContainer(REGISTRY_MODULE_URL);
    perLawContainers.push(fresh);
    const freshContainers = {
      [CONFORMANCE_CONTAINER_ROLE]: fresh,
    } as Readonly<Record<string, DagContainerInterface<NodeStateInterface>>>;
    const freshDispatcher = new Dagonizer<NodeStateInterface, undefined>({ 'containers': freshContainers });
    freshDispatcher.registerBundle(bundle);

    const result = await freshDispatcher.resume(CONFORMANCE_DAG.law8, state, 'fan');

    // All 3 items gathered: no loss, no double-ack (acked item not reprocessed).
    const finalItems = (result.state as ConformanceState).gatheredItems;
    assert.strictEqual(
      finalItems.length, 3,
      `all 3 items must be gathered after resume (no loss, no double-ack), got ${finalItems.length}`,
    );
    assert.strictEqual(
      result.state.lifecycle.kind, 'completed',
      `flow must complete after resume, got ${result.state.lifecycle.kind}`,
    );
  });
});
