/**
 * conformance.test.ts: DAG container conformance suite (Laws 1–9) for Node.js backends.
 *
 * Runs the full DagConformance.laws() suite against:
 * (1) WorkerThreadContainer — real worker_threads pool (Laws 1–9 including Law 8 real kill)
 * (2) ForkContainer          — real child_process.fork pool
 * (3) SpawnContainer          — real child_process.spawn pool (NDJSON stdio)
 * (4) ClusterContainer        — node:cluster workers (protocol-level round-trip)
 *
 * All backends use the ConformanceRegistry fixture at dist-test/tests/unit/fixtures/registry.js
 * as their registryModule so DagHost reconstructs the identical bundle.
 *
 * Law 6 instrumentation wiring: DagContainerBase relays forwarded instrumentation
 * messages through its own `this.instrumentation`. To reach the test's Instrumentation
 * instance, createDispatcher builds a FRESH container with the instrumentation passed in
 * as a constructor option each time it is called. The per-law container is destroyed in
 * the harness teardown hook. This is the same pattern used in the core W2 executor-
 * conformance.test.ts (LoopbackContainer per createDispatcherForLaw call).
 *
 * Law 8 (at-least-once under container failure):
 *   Only provided for WorkerThreadContainer — it exposes the cleanest isolate-kill
 *   mechanism (worker.terminate()). The `interruptMidScatter` capability returns a
 *   `KillAfterOneContainer` that terminates the worker pool after the first item's
 *   runDag() call completes and THROWS on the next call (so executeItem rejects,
 *   poolError is set, scatter throws, inbox retains un-acked items). A fresh
 *   WorkerThreadContainer is the `freshContainer` for resume.
 *
 * NOTE on ClusterContainer: node:cluster workers share the primary's state
 * machine. Running cluster.setupPrimary() multiple times in the same process
 * (as the full laws() suite would require) results in test interference because
 * cluster.fork() inherits the setup from the most recent setupPrimary() call
 * and all workers are joined to the same cluster. Running the full laws() suite
 * as multiple parallel dispatchers in a test process is not safe for cluster
 * because cluster is a process-global singleton — each new ClusterContainer
 * calls setupPrimary() again, overwriting the previous exec target.
 * To avoid cross-test contamination we run one full laws() pass only.
 * The protocol correctness is verified by the same DagConformance laws
 * that run against ForkContainer (identical wire protocol over identical IPC
 * transport); ClusterContainer's only delta is worker provenance.
 */

import assert from 'node:assert/strict';
import { after, afterEach, describe, it } from 'node:test';

import { Dagonizer, SCATTER_PROGRESS_KEY } from '@noocodex/dagonizer';
import type { DagonizerInterface, DispatcherBundle, NodeStateInterface, ScatterProgress } from '@noocodex/dagonizer';
import type { DagContainerInterface, Instrumentation } from '@noocodex/dagonizer/contracts';
import {
  buildConformanceBundle,
  ConformanceState,
  CONFORMANCE_CONTAINER_ROLE,
  CONFORMANCE_DAG,
  CONFORMANCE_REGISTRY_VERSION,
  DagConformance,
} from '@noocodex/dagonizer/testing';
import type { DagConformanceHarnessInterface } from '@noocodex/dagonizer/testing';

import { ClusterContainer } from '../../src/ClusterContainer.js';
import { ForkContainer } from '../../src/ForkContainer.js';
import { SpawnContainer } from '../../src/SpawnContainer.js';
import { WorkerThreadContainer } from '../../src/WorkerThreadContainer.js';

// ---------------------------------------------------------------------------
// KillAfterOneContainer
//
// Law 8 capability: wraps a WorkerThreadContainer. Routes the FIRST runDag()
// call through the real container (so the item completes and acks). After that
// first call returns, the inner container is destroyed (terminating all worker
// threads). On the SECOND and subsequent calls, runDag() THROWS — this causes
// executeItem to reject, which sets poolError in the scatter pool loop, which
// causes executeScatter to throw. The scatter throws without acking the
// in-flight items. Their inbox entries survive. Resume via a fresh container
// reprocesses all un-acked items, proving at-least-once delivery.
//
// Why throw instead of returning transport-error-outcome:
//   If runDag returns a DagOutcomeInterface (even terminalOutput='failed'), the
//   scatter's ackItem is always called (success path in spawnWorker.then).
//   Only when runDag() THROWS (the Promise rejects) does spawnWorker take the
//   rejection path → poolError set → ackItem skipped → inbox preserved.
// ---------------------------------------------------------------------------

class KillAfterOneContainer implements DagContainerInterface {
  readonly #inner: WorkerThreadContainer;
  #killed: boolean;

  constructor(inner: WorkerThreadContainer) {
    this.#inner = inner;
    this.#killed = false;
  }

  async runDag(task: Parameters<DagContainerInterface['runDag']>[0]): ReturnType<DagContainerInterface['runDag']> {

    if (this.#killed) {
      // Worker pool already terminated: throw so executeItem rejects.
      throw new Error('KillAfterOneContainer: worker pool has been terminated (simulated kill)');
    }

    // Route the first call through the real container.
    const outcome = await this.#inner.runDag(task);

    // After the first call completes (first item acked in spawnWorker.then),
    // destroy the worker pool synchronously so the next call has no workers.
    // We destroy async but don't await — the next call will see #killed=true
    // and throw before acquire. Set the flag immediately so concurrent callers
    // also see the kill.
    this.#killed = true;
    // Destroy in the background; the throw on next call is the signal.
    void this.#inner.destroy().catch(() => { /* suppress */ });

    return outcome;
  }

  async destroy(): Promise<void> {
    if (!this.#killed) {
      this.#killed = true;
      await this.#inner.destroy();
    }
  }
}

// ---------------------------------------------------------------------------
// Registry module URL
//
// Points at the compiled fixture in dist-test. The tsconfig.test.json uses
// rootDir '.', so dist-test mirrors the source tree:
//   src/...          → dist-test/src/...
//   tests/unit/...   → dist-test/tests/unit/...
//
// This file compiles to dist-test/tests/unit/conformance.test.js, so the
// fixture is at dist-test/tests/unit/fixtures/registry.js.
// ---------------------------------------------------------------------------

function registryUrl(): string {
  return new URL('./fixtures/registry.js', import.meta.url).href;
}

/**
 * Registry whose scatter body silently kills its worker thread on item 20
 * (no result/error sent). Used by the silent-kill real-death test below.
 */
function killRegistryUrl(): string {
  return new URL('./fixtures/kill-registry.js', import.meta.url).href;
}

// ---------------------------------------------------------------------------
// Destroyable: containers built per-law are tracked and torn down in afterEach.
// ---------------------------------------------------------------------------

interface Destroyable {
  destroy(): Promise<void>;
}

// ---------------------------------------------------------------------------
// ContainerFactory: typed factory signature for each backend.
// Takes an optional instrumentation and returns a fresh container.
// ---------------------------------------------------------------------------

type ContainerFactory = (opts: { instrumentation?: Instrumentation }) => Destroyable & DagContainerInterface;

// ---------------------------------------------------------------------------
// buildHarness
//
// The harness creates a FRESH container per createDispatcher call so that
// Law 6's instrumentation instance is carried into DagContainerBase, which
// relays BridgeMessage instrumentation hooks through this.instrumentation.
// Each per-law container is tracked and destroyed in afterEach.
// ---------------------------------------------------------------------------

function buildHarness(factory: ContainerFactory): DagConformanceHarnessInterface {
  const perLaw: Destroyable[] = [];
  // Track containers created by factory so we can detect sentinel vs law-8 containers.
  const factoryCreated = new Set<DagContainerInterface>();

  function makeContainer(opts: { instrumentation?: Instrumentation }): Destroyable & DagContainerInterface {
    const c = factory(opts);
    factoryCreated.add(c);
    perLaw.push(c);
    return c;
  }

  return {
    createDispatcher(
      bundle: DispatcherBundle<NodeStateInterface, undefined>,
      passedContainers: Readonly<Record<string, DagContainerInterface>>,
      instrumentation?: Instrumentation,
    ): DagonizerInterface<NodeStateInterface, undefined> {
      // Use the passed container only if it was NOT created by this harness's
      // factory (Law 8 provides KillAfterOneContainer / fresh container from
      // outside the factory). For all other laws, build a fresh factory
      // container so the instrumentation instance is wired in (Law 6 needs this).
      const passedContainer = passedContainers[CONFORMANCE_CONTAINER_ROLE];
      let container: DagContainerInterface;
      if (passedContainer !== undefined && !factoryCreated.has(passedContainer)) {
        // Law 8: use the caller-supplied container directly.
        container = passedContainer;
      } else {
        // Laws 1–7, 9: build a fresh container with the law's instrumentation.
        container = makeContainer(instrumentation !== undefined ? { 'instrumentation': instrumentation } : {});
      }

      const containers = { [CONFORMANCE_CONTAINER_ROLE]: container } as Readonly<Record<string, DagContainerInterface>>;
      const opts = instrumentation !== undefined
        ? { 'containers': containers, 'instrumentation': instrumentation }
        : { 'containers': containers };
      const dispatcher = new Dagonizer<NodeStateInterface, undefined>(opts);
      dispatcher.registerBundle(bundle);
      return dispatcher as unknown as DagonizerInterface<NodeStateInterface, undefined>;
    },

    // Law 7: build a dispatcher WITHOUT the container role bound so
    // resolveContainer(CONFORMANCE_CONTAINER_ROLE) returns null → inline path.
    createInProcessDispatcher(
      bundle: DispatcherBundle<NodeStateInterface, undefined>,
    ): DagonizerInterface<NodeStateInterface, undefined> {
      const dispatcher = new Dagonizer<NodeStateInterface, undefined>();
      dispatcher.registerBundle(bundle);
      return dispatcher as unknown as DagonizerInterface<NodeStateInterface, undefined>;
    },

    createState(): ConformanceState {
      return new ConformanceState();
    },

    'containerRole': CONFORMANCE_CONTAINER_ROLE,

    // Sentinel container: used only by laws that bypass createDispatcher.
    // The suite's laws all go through createDispatcher; this is a no-op stub.
    'container': makeContainer({}),

    async teardown(): Promise<void> {
      for (const c of perLaw.splice(0)) {
        await c.destroy();
      }
    },
  };
}

// ---------------------------------------------------------------------------
// (1) WorkerThreadContainer — full conformance suite
// ---------------------------------------------------------------------------

void describe('DAG Container Conformance — WorkerThreadContainer (Laws 1–9)', () => {
  const allContainers: Destroyable[] = [];

  const factory: ContainerFactory = (opts) => {
    const c = new WorkerThreadContainer({
      'registryModule': registryUrl(),
      'registryVersion': CONFORMANCE_REGISTRY_VERSION,
      'poolSize': 1,
      'entryUrl': new URL('../../src/workerEntry.js', import.meta.url),
      ...(opts.instrumentation !== undefined ? { 'instrumentation': opts.instrumentation } : {}),
    });
    allContainers.push(c);
    return c;
  };

  // Law 8 capability: interruptMidScatter.
  // Returns a KillAfterOneContainer (kills after first item) and a fresh
  // WorkerThreadContainer for resume. Both are tracked for teardown.
  const interruptMidScatter = (): {
    failingContainer: DagContainerInterface;
    freshContainer: DagContainerInterface;
  } => {
    const innerForKill = new WorkerThreadContainer({
      'registryModule': registryUrl(),
      'registryVersion': CONFORMANCE_REGISTRY_VERSION,
      'poolSize': 1,
      'entryUrl': new URL('../../src/workerEntry.js', import.meta.url),
    });
    allContainers.push(innerForKill);

    const failingContainer = new KillAfterOneContainer(innerForKill);
    allContainers.push(failingContainer as unknown as Destroyable);

    const freshContainer = new WorkerThreadContainer({
      'registryModule': registryUrl(),
      'registryVersion': CONFORMANCE_REGISTRY_VERSION,
      'poolSize': 1,
      'entryUrl': new URL('../../src/workerEntry.js', import.meta.url),
    });
    allContainers.push(freshContainer);

    return { failingContainer, freshContainer };
  };

  const harness = {
    ...buildHarness(factory),
    interruptMidScatter,
  };

  afterEach(async () => {
    await harness.teardown();
  });

  after(async () => {
    for (const c of allContainers.splice(0)) {
      await c.destroy();
    }
  });

  for (const law of DagConformance.laws(harness)) {
    void it(law.name, () => law.run());
  }
});

// ---------------------------------------------------------------------------
// (1b) WorkerThreadContainer — SILENT real-death proof (Law 4 + Law 8)
//
// A worker self-terminates (process.exit) mid-request on item 20 with NO
// result/error message. This is the failure that previously hung the pending
// request forever. The death-detection backstop (worker.on('exit') →
// failChannel) must fail the in-flight request so:
//   (a) runDag / the scatter resolve within a bounded time (no hang), and
//   (b) the killed item stays un-acked → resume on a fresh container
//       reprocesses it (at-least-once).
// ---------------------------------------------------------------------------

void describe('WorkerThreadContainer — silent worker death (Law 4 backstop + Law 8 resume)', () => {
  const allContainers: Destroyable[] = [];

  after(async () => {
    for (const c of allContainers.splice(0)) {
      await c.destroy();
    }
  });

  void it('a silently-killed worker does NOT hang the scatter; resume reprocesses the item', async () => {
    // Phase 1: scatter [10, 20, 30] through a container whose worker dies on 20.
    const killing = new WorkerThreadContainer({
      'registryModule': killRegistryUrl(),
      'registryVersion': CONFORMANCE_REGISTRY_VERSION,
      'poolSize': 1,
      'entryUrl': new URL('../../src/workerEntry.js', import.meta.url),
    });
    allContainers.push(killing);

    const bundle = buildConformanceBundle().bundle as DispatcherBundle<NodeStateInterface, undefined>;
    const state = new ConformanceState();
    state.scatterItems = [10, 20, 30];

    const killingContainers = {
      [CONFORMANCE_CONTAINER_ROLE]: killing,
    } as Readonly<Record<string, DagContainerInterface>>;
    const killingDispatcher = new Dagonizer<NodeStateInterface, undefined>({ 'containers': killingContainers });
    killingDispatcher.registerBundle(bundle);

    // EMPIRICAL no-hang proof: bound the whole phase-1 run. If the pending
    // request hung (the bug), this Promise.race rejects and the test fails
    // LOUDLY instead of the suite hanging until the global test timeout.
    const NO_HANG_BUDGET_MS = 8000;
    const start = Date.now();
    let timedOut = false;
    const phase1 = (async (): Promise<void> => {
      try {
        await killingDispatcher.execute(CONFORMANCE_DAG.law8, state);
      } catch {
        // Expected: silent death → transport error → infra failure → scatter throws.
      }
    })();
    await Promise.race([
      phase1,
      new Promise<void>((_resolve, reject) => {
        setTimeout(() => { timedOut = true; reject(new Error('HANG: scatter did not resolve after worker death')); }, NO_HANG_BUDGET_MS);
      }),
    ]);
    const elapsed = Date.now() - start;
    assert.ok(!timedOut, 'scatter must resolve after a silent worker death (no hang)');
    assert.ok(elapsed < NO_HANG_BUDGET_MS, `phase 1 must finish within ${NO_HANG_BUDGET_MS}ms, took ${elapsed}ms`);

    // The killed item must remain un-acked; the checkpoint must survive.
    const progress = state.getMetadata<Record<string, ScatterProgress>>(SCATTER_PROGRESS_KEY);
    const fan = (progress ?? {})['fan'];
    assert.ok(fan !== undefined, 'checkpoint must survive the worker death (not cleared)');
    const ackedBefore = fan?.ackedResults.length ?? 0;
    assert.ok(ackedBefore >= 1, `at least item 10 must ack before the kill, got ${ackedBefore} acked`);
    assert.ok(ackedBefore < 3, `not all items may have acked (item 20 died), got ${ackedBefore} acked`);

    // Phase 2: resume through a fresh, healthy container (normal registry → no kill).
    const fresh = new WorkerThreadContainer({
      'registryModule': registryUrl(),
      'registryVersion': CONFORMANCE_REGISTRY_VERSION,
      'poolSize': 1,
      'entryUrl': new URL('../../src/workerEntry.js', import.meta.url),
    });
    allContainers.push(fresh);

    const freshContainers = {
      [CONFORMANCE_CONTAINER_ROLE]: fresh,
    } as Readonly<Record<string, DagContainerInterface>>;
    const freshDispatcher = new Dagonizer<NodeStateInterface, undefined>({ 'containers': freshContainers });
    freshDispatcher.registerBundle(bundle);

    const result = await freshDispatcher.resume(CONFORMANCE_DAG.law8, state, 'fan');

    const finalItems = (result.state as ConformanceState).gatheredItems;
    assert.strictEqual(
      finalItems.length, 3,
      `all 3 items must be gathered after resume (no loss), got ${finalItems.length}`,
    );
    assert.strictEqual(
      result.state.lifecycle.kind, 'completed',
      `flow must complete after resume, got ${result.state.lifecycle.kind}`,
    );
  });
});

// ---------------------------------------------------------------------------
// (2) ForkContainer — full conformance suite
// ---------------------------------------------------------------------------

void describe('DAG Container Conformance — ForkContainer (Laws 1–9, Law 8 skipped)', () => {
  const allContainers: Destroyable[] = [];

  const factory: ContainerFactory = (opts) => {
    const c = new ForkContainer({
      'registryModule': registryUrl(),
      'registryVersion': CONFORMANCE_REGISTRY_VERSION,
      'poolSize': 1,
      'entryUrl': new URL('../../src/forkEntry.js', import.meta.url),
      ...(opts.instrumentation !== undefined ? { 'instrumentation': opts.instrumentation } : {}),
    });
    allContainers.push(c);
    return c;
  };

  const harness = buildHarness(factory);

  afterEach(async () => {
    await harness.teardown();
  });

  after(async () => {
    for (const c of allContainers.splice(0)) {
      await c.destroy();
    }
  });

  for (const law of DagConformance.laws(harness)) {
    void it(law.name, () => law.run());
  }
});

// ---------------------------------------------------------------------------
// (3) SpawnContainer — full conformance suite
// ---------------------------------------------------------------------------

void describe('DAG Container Conformance — SpawnContainer (Laws 1–9, Law 8 skipped)', () => {
  const allContainers: Destroyable[] = [];

  const factory: ContainerFactory = (opts) => {
    const c = new SpawnContainer({
      'registryModule': registryUrl(),
      'registryVersion': CONFORMANCE_REGISTRY_VERSION,
      'poolSize': 1,
      'entryUrl': new URL('../../src/spawnEntry.js', import.meta.url),
      ...(opts.instrumentation !== undefined ? { 'instrumentation': opts.instrumentation } : {}),
    });
    allContainers.push(c);
    return c;
  };

  const harness = buildHarness(factory);

  afterEach(async () => {
    await harness.teardown();
  });

  after(async () => {
    for (const c of allContainers.splice(0)) {
      await c.destroy();
    }
  });

  for (const law of DagConformance.laws(harness)) {
    void it(law.name, () => law.run());
  }
});

// ---------------------------------------------------------------------------
// (4) ClusterContainer — single laws() pass (process-global cluster singleton)
//
// ClusterContainer uses a process-global node:cluster. Running setupPrimary()
// multiple times in the same process with different exec targets is safe only
// if each call completes before the next (setupPrimary is synchronous). The
// full laws() suite creates one shared container factory here and runs all
// nine laws against it. This exercises the full protocol over real cluster
// IPC workers while avoiding cross-instance cluster setup races.
// ---------------------------------------------------------------------------

void describe('DAG Container Conformance — ClusterContainer (Laws 1–9, Law 8 skipped, single instance)', () => {
  const allContainers: Destroyable[] = [];

  const factory: ContainerFactory = (opts) => {
    const c = new ClusterContainer({
      'registryModule': registryUrl(),
      'registryVersion': CONFORMANCE_REGISTRY_VERSION,
      'poolSize': 1,
      'entryUrl': new URL('../../src/forkEntry.js', import.meta.url),
      ...(opts.instrumentation !== undefined ? { 'instrumentation': opts.instrumentation } : {}),
    });
    allContainers.push(c);
    return c;
  };

  const harness = buildHarness(factory);

  afterEach(async () => {
    await harness.teardown();
  });

  after(async () => {
    for (const c of allContainers.splice(0)) {
      await c.destroy();
    }
  });

  for (const law of DagConformance.laws(harness)) {
    void it(law.name, () => law.run());
  }
});

// ---------------------------------------------------------------------------
// Destroy semantics: after destroy(), no leaked handles
//
// This test creates fresh containers, destroys them, and verifies no rejection.
// Node --test exiting cleanly after all tests is itself the leaked-handle
// assertion: if workers/children outlive the test process the process would hang.
// ---------------------------------------------------------------------------

void describe('Destroy semantics — no leaked handles after destroy()', () => {
  void it('WorkerThreadContainer: destroy resolves without error', async () => {
    const container = new WorkerThreadContainer({
      'registryModule': registryUrl(),
      'registryVersion': CONFORMANCE_REGISTRY_VERSION,
      'poolSize': 1,
      'entryUrl': new URL('../../src/workerEntry.js', import.meta.url),
    });
    await container.destroy();
  });

  void it('ForkContainer: destroy resolves without error', async () => {
    const container = new ForkContainer({
      'registryModule': registryUrl(),
      'registryVersion': CONFORMANCE_REGISTRY_VERSION,
      'poolSize': 1,
      'entryUrl': new URL('../../src/forkEntry.js', import.meta.url),
    });
    await container.destroy();
  });

  void it('SpawnContainer: destroy resolves without error', async () => {
    const container = new SpawnContainer({
      'registryModule': registryUrl(),
      'registryVersion': CONFORMANCE_REGISTRY_VERSION,
      'poolSize': 1,
      'entryUrl': new URL('../../src/spawnEntry.js', import.meta.url),
    });
    await container.destroy();
  });
});
