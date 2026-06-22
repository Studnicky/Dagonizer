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

// Engine imports come from the PUBLIC package entry (dist), not `../../src`, so
// this conformance test's type identity matches the dist-compiled `testing/`
// harness and `ConformanceRegistry` bundle it drives — no src↔dist brand bridge.
import {
  ConformanceRegistry,
  ConformanceState,
  CONFORMANCE_CONTAINER_ROLE,
  CONFORMANCE_REGISTRY_VERSION,
  CONFORMANCE_DAG,
} from '../../testing/ConformanceRegistry.js';
import { DagConformance } from '../../testing/DagConformance.js';
import { LoopbackChannel } from '../../testing/LoopbackChannel.js';

import { Dagonizer, SCATTER_PROGRESS_KEY } from '@studnicky/dagonizer';
import type {
  DagContainerOptionsType,
  DagOutcomeType,
  DagTaskInterface,
  DagContainerInterface,
  DispatcherBundleType,
  StoredScatterProgressType,
  NodeStateInterface,
} from '@studnicky/dagonizer';
import { DagContainerBase, DagHost, DAG_CONTAINER_TRANSPORT } from '@studnicky/dagonizer/container';
import type { PoolEntryType } from '@studnicky/dagonizer/container';
import type { MessageChannelInterface, ObserverRelayInterface } from '@studnicky/dagonizer/contracts';
import type { JsonObjectType, NodeErrorWireType } from '@studnicky/dagonizer/entities';
import { Validator } from '@studnicky/dagonizer/validation';


// ---------------------------------------------------------------------------
// Registry module URL
// ---------------------------------------------------------------------------

// The compiled test file is at: dist-test/tests/unit/executor-conformance.test.js
// The conformance registry is at: dist-testing/ConformanceRegistry.js (package root)
const PACKAGE_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..', '..', '..');
const REGISTRY_MODULE_URL = resolve(PACKAGE_ROOT, 'dist-testing', 'ConformanceRegistry.js');

// ---------------------------------------------------------------------------
// LoopbackWorker: the "worker" value held in PoolEntryType for test containers.
// Carries the host-side channel so terminateWorker can close it.
// ---------------------------------------------------------------------------

type LoopbackWorker = {
  hostSide: MessageChannelInterface;
}

// ---------------------------------------------------------------------------
// LoopbackContainer: DagContainerBase subclass backed by a single DagHost
// connected over a LoopbackChannel. Uses poolSize:1.
// ---------------------------------------------------------------------------

class LoopbackContainer extends DagContainerBase<LoopbackWorker> {
  constructor(registryModuleUrl: string, options: Partial<DagContainerOptionsType> = {}) {
    super({
      ...DagContainerBase.defaultOptions,
      'poolSize': 1,
      'init': {
        'registryModule': registryModuleUrl,
        'registryVersion': CONFORMANCE_REGISTRY_VERSION,
        'servicesConfig': {} satisfies JsonObjectType,
      },
      ...(options.shutdownGraceMs !== undefined ? { 'shutdownGraceMs': options.shutdownGraceMs } : {}),
    });
  }

  protected override composeEntry(): PoolEntryType<LoopbackWorker> {
    const [parentSide, hostSide] = LoopbackChannel.pair();
    const host = new DagHost(hostSide);
    host.start();
    return { 'worker': { hostSide }, 'channel': parentSide, 'initialized': false };
  }

  protected override attachDeathListeners(_entry: PoolEntryType<LoopbackWorker>): void {
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

type Destroyable = { destroy(): Promise<void>; }

class LawContainerTracker {
  private constructor() {}

  static readonly containers: Destroyable[] = [];

  static async teardown(): Promise<void> {
    for (const c of LawContainerTracker.containers.splice(0)) {
      await c.destroy();
    }
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

class LawDispatcherFactory {
  private constructor() {}

  static create(
    bundle: DispatcherBundleType<NodeStateInterface>,
    _containers: Readonly<Record<string, DagContainerInterface>>,
  ): Dagonizer<NodeStateInterface> {
    // LoopbackContainer demand-grows its pool on first runDag(); no async init
    // needed in the synchronous factory. The base's acquireChannel loop handles
    // lazy entry creation and init on first use.
    const container = new LoopbackContainer(REGISTRY_MODULE_URL);
    LawContainerTracker.containers.push(container);

    const containers: Readonly<Record<string, DagContainerInterface>> = { [CONFORMANCE_CONTAINER_ROLE]: container };
    const dispatcher = new Dagonizer<NodeStateInterface>({ containers });
    dispatcher.registerBundle(bundle);
    return dispatcher;
  }
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
// lives in testing/ which compiles against dist/ types. The src/ Dagonizer class
// and the dist/ DagonizerInterface are structurally identical at runtime but are
// distinct type identities in the dual-compilation build: private fields from the
// Execution<T> class create a brand divergence that prevents direct structural
// assignment. The single `as unknown` + `as` here is the minimal bridge between
// the two compilation units; it cannot be eliminated without making the test
// import Dagonizer from dist/ (which would lose access to src/ coverage) or
// without changing the DagConformanceHarnessInterface signature in testing/.
const harnessRaw = {
  'containerRole': CONFORMANCE_CONTAINER_ROLE,

  get 'container'(): DagContainerInterface {
    if (sentinelContainer === null) {
      // Lazily build a sentinel so the getter never returns null.
      sentinelContainer = new LazyLoopbackContainer(REGISTRY_MODULE_URL);
      LawContainerTracker.containers.push(sentinelContainer);
    }
    return sentinelContainer;
  },

  createState(): ConformanceState {
    return new ConformanceState();
  },

  'createDispatcher': LawDispatcherFactory.create,

  // Law 7: build a dispatcher WITHOUT the container role bound so
  // resolveContainer(CONFORMANCE_CONTAINER_ROLE) returns null → inline path.
  createInProcessDispatcher(
    bundle: DispatcherBundleType<NodeStateInterface>,
  ): Dagonizer<NodeStateInterface> {
    const dispatcher = new Dagonizer<NodeStateInterface>();
    dispatcher.registerBundle(bundle);
    return dispatcher;
  },

  async teardown(): Promise<void> {
    sentinelContainer = null;
    await LawContainerTracker.teardown();
  },
};
const laws = DagConformance.laws(harnessRaw);

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
      // RegistryBundleInterface.bundle is typed DispatcherBundleType<NodeStateInterface, unknown>
      // src/ test ↔ dist/ testing-harness brand bridge (see the FIXME on the
      // DagConformance.laws call): the bundle comes from the dist-compiled
      // `testing/` module; the src-compiled `Batch`/`NodeInterface` it must
      // register into carry a divergent `#private` brand, so the structural
      // assignment fails. Part of the same dual-compilation decision.
      const bundle = ConformanceRegistry.bundle().bundle;
      const containers: Readonly<Record<string, DagContainerInterface>> = { [CONFORMANCE_CONTAINER_ROLE]: container };
      const dispatcher = new Dagonizer<NodeStateInterface>({ containers });
      dispatcher.registerBundle(bundle);

      const initialState = new ConformanceState();
      initialState.value = 42; // Seed a non-default value.

      const result = await dispatcher.execute(CONFORMANCE_DAG.law9, initialState);

      assert.strictEqual(result.state, initialState, 'state identity must be preserved');
      assert.ok(result.state instanceof ConformanceState, 'result.state must be a ConformanceState');
      assert.strictEqual(
        result.state.value, 99,
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
// container.runDag RETURNS a transport-error DagOutcomeType (the real
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

class ReturnTransportErrorAfterOneContainer implements DagContainerInterface {
  readonly #inner: LazyLoopbackContainer;
  #callCount: number;

  constructor(inner: LazyLoopbackContainer) {
    this.#inner = inner;
    this.#callCount = 0;
  }

  async runDag(task: DagTaskInterface, options?: { readonly relay?: ObserverRelayInterface }): Promise<DagOutcomeType> {
    this.#callCount += 1;
    if (this.#callCount === 1) {
      // First item: run for real so it acks.
      return this.#inner.runDag(task, options);
    }
    // Subsequent items: RETURN a transport-error outcome (do NOT throw).
    const error: NodeErrorWireType = {
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
    await LawContainerTracker.teardown();
  });

  it('un-acked items survive a returned transport error; resume reprocesses them', async () => {
    const inner = new LazyLoopbackContainer(REGISTRY_MODULE_URL);
    const failing = new ReturnTransportErrorAfterOneContainer(inner);
    LawContainerTracker.containers.push(failing);

    // src/ test ↔ dist/ testing-harness brand bridge (see the FIXME above).
    const bundle = ConformanceRegistry.bundle().bundle;

    // Phase 1: scatter through the failing container. Item 0 acks; item 1
    // returns a transport error → scatter throws (poolError) → item 1 stays
    // un-acked in the inbox; the checkpoint is NOT cleared.
    const state = new ConformanceState();
    state.scatterItems = [10, 20, 30];

    const failingContainers: Readonly<Record<string, DagContainerInterface>> = {
      [CONFORMANCE_CONTAINER_ROLE]: failing,
    };
    const failingDispatcher = new Dagonizer<NodeStateInterface>({ 'containers': failingContainers });
    failingDispatcher.registerBundle(bundle);

    // The dispatcher catches the scatter pool error internally and finalizes a
    // failed lifecycle (it does not rethrow to the caller). What matters for
    // at-least-once is that the infra-failure discriminator threw BEFORE
    // ScatterCheckpoint.clear, so the checkpoint survives with un-acked items.
    const result1 = await failingDispatcher.execute(CONFORMANCE_DAG.law8, state);
    assert.notStrictEqual(
      result1.state.lifecycle.variant, 'completed',
      'phase-1 flow must NOT complete cleanly when an item hit a transport error',
    );

    // The checkpoint must still be present (NOT cleared) and must NOT record
    // all items as acked — the transport-failed item was left un-acked, so
    // ScatterCheckpoint.clear never ran. With an array source, resume
    // reconstructs the un-acked items from the acked-index gap; with a stream
    // source they live in the persisted inbox. Either way the un-acked item is
    // recoverable: the discriminator threw before clear, preserving the
    // checkpoint with fewer than all items acked.
    const rawProgress = state.getMetadata(SCATTER_PROGRESS_KEY);
    const progress: StoredScatterProgressType = rawProgress === undefined ? {} : Validator.storedScatterProgress.validate(rawProgress);
    const fan = progress['fan'];
    assert.ok(fan !== undefined, 'checkpoint must survive — ScatterCheckpoint.clear must NOT run on infra failure');
    const ackedCount = fan.mode === 'bounded'
      ? fan.watermark + fan.aheadAcked.length
      : fan.ackedResults.length;
    assert.strictEqual(ackedCount, 1, `exactly one item must have acked before the transport error, got ${ackedCount}`);
    assert.ok(ackedCount < 3, 'the transport-failed item must NOT be acked (no silent loss)');

    // Phase 2: resume through a healthy container. Un-acked items reprocess.
    const fresh = new LazyLoopbackContainer(REGISTRY_MODULE_URL);
    LawContainerTracker.containers.push(fresh);
    const freshContainers: Readonly<Record<string, DagContainerInterface>> = {
      [CONFORMANCE_CONTAINER_ROLE]: fresh,
    };
    const freshDispatcher = new Dagonizer<NodeStateInterface>({ 'containers': freshContainers });
    freshDispatcher.registerBundle(bundle);

    const result = await freshDispatcher.resume(CONFORMANCE_DAG.law8, state, 'fan');

    // All 3 items gathered: no loss, no double-ack (acked item not reprocessed).
    assert.ok(result.state instanceof ConformanceState, 'result.state must be a ConformanceState');
    const finalItems = result.state.gatheredItems;
    assert.strictEqual(
      finalItems.length, 3,
      `all 3 items must be gathered after resume (no loss, no double-ack), got ${finalItems.length}`,
    );
    assert.strictEqual(
      result.state.lifecycle.variant, 'completed',
      `flow must complete after resume, got ${result.state.lifecycle.variant}`,
    );
  });
});
