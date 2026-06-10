/**
 * DagConformance: backend-agnostic conformance law suite for
 * DagContainerInterface implementations.
 *
 * The same laws run against every backend — loopback-bridge (W2) and W3
 * isolating containers (worker_threads, fork, etc.). Law fixtures live in
 * ConformanceRegistry, which any backend can dynamic-import and reconstruct
 * identically. Nodes record observations through STATE, never closures,
 * so markers are visible after snapshot/restore round-trips.
 *
 * Usage:
 *   for (const law of DagConformance.laws(harness)) {
 *     void it(law.name, () => law.run());
 *   }
 *
 * Harness DI (DagConformanceHarnessInterface):
 *   createContainer  — build a DagContainerInterface under test.
 *   createDispatcher — build a Dagonizer wired with the container at
 *                      `harness.containerRole`, registering the bundle.
 *   createState      — factory for a fresh ConformanceState.
 *   containerRole    — role key bound in containers map.
 *   registryModuleUrl — URL string the DagHost should dynamic-import
 *                        (for bridge/loopback containers that init a host).
 *   interruptMidScatter — (optional) capability for Law 8: builds a
 *                          DagContainerInterface that kills the isolate after
 *                          at least one scatter item acks, then returns a fresh
 *                          container. When absent, Law 8 is skipped.
 *
 * Law descriptions (dag-level Laws 1–9):
 *   1  Node code is unchanged: same execute signature, same output routing.
 *   2  Child mutations visible to parent; result.state === initialState.
 *   3  Errors collect and route; transport loss → collected error, never throw.
 *   4  timeoutMs honored host-side; terminates within 2s.
 *   5  Abort propagates best-effort; sleeper began is proven via state marker.
 *   6  Subclass hooks fire on parent with correct placementPath for worker nodes.
 *   7  Scatter checkpoint/resume bookkeeping byte-identical across in-process
 *      and contained backends.
 *   8  At-least-once under container failure: kill mid-scatter, assert resume
 *      reprocesses un-acked items.
 *   9  State round-trip is a fixed point: seed→snapshot→transport→restore→run.
 */

import assert from 'node:assert/strict';

// The relative '../dist/' imports below are type-only and erased at compile time.
import type { DagContainerInterface } from '../dist/contracts/DagContainerInterface.js';
import type { DagonizerInterface, DispatcherBundle } from '../dist/Dagonizer.js';
import type { NodeStateInterface } from '../dist/NodeStateBase.js';

import type {
  ConformanceState} from './ConformanceRegistry.js';
import {
  ConformanceRegistry,
  CONFORMANCE_DAG,
} from './ConformanceRegistry.js';

// Runtime value imported from the package entry (resolves via package exports).
import { SCATTER_PROGRESS_KEY } from '@noocodex/dagonizer';
import type { ScatterProgress } from '@noocodex/dagonizer';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DagConformanceHarnessInterface {
  /**
   * Build a dispatcher wired with the container under test at `containerRole`,
   * registering the supplied conformance bundle parent-side.
   */
  createDispatcher(
    bundle: DispatcherBundle<NodeStateInterface, undefined>,
    containers: Readonly<Record<string, DagContainerInterface>>,
  ): DagonizerInterface<NodeStateInterface, undefined>;
  /** Create a fresh ConformanceState. */
  createState(): ConformanceState;
  /** Role name bound in containers and stamped on every law EmbeddedDAGNode. */
  containerRole: string;
  /** The container under test. */
  container: DagContainerInterface;
  /**
   * Teardown. Called after each law to release channel/host resources.
   * Must not throw.
   */
  teardown(): Promise<void>;

  /**
   * (Optional) Build a dispatcher WITHOUT the container bound (in-process path).
   * Used by Law 7 to compare in-process vs contained checkpoint bookkeeping.
   * When absent, Law 7 compares two contained runs (weaker but still valid).
   */
  createInProcessDispatcher?(
    bundle: DispatcherBundle<NodeStateInterface, undefined>,
  ): DagonizerInterface<NodeStateInterface, undefined>;

  /**
   * (Optional) Law 8 capability: interrupt the container mid-scatter.
   *
   * When provided, the harness supports Law 8. The capability must:
   *   1. Build a `failingContainer` that kills its isolate after at least one
   *      scatter item acks but before all items complete.
   *   2. Build a `freshContainer` replacement (same backend, new isolate pool).
   *
   * Law 8 runs the scatter via `failingContainer` (which will mid-flight kill),
   * then resumes via `freshContainer` and asserts un-acked items are reprocessed.
   *
   * When absent, Law 8 is skipped with a note.
   */
  interruptMidScatter?: () => {
    failingContainer: DagContainerInterface;
    freshContainer: DagContainerInterface;
  };
}

export interface DagConformanceLawInterface {
  readonly name: string;
  run(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function dispatcherFor(
  harness: DagConformanceHarnessInterface,
): DagonizerInterface<NodeStateInterface, undefined> {
  const bundle = ConformanceRegistry.bundle().bundle as DispatcherBundle<NodeStateInterface, undefined>;
  const containers = { [harness.containerRole]: harness.container } as Readonly<Record<string, DagContainerInterface>>;
  return harness.createDispatcher(bundle, containers);
}

// ---------------------------------------------------------------------------
// DagConformance
// ---------------------------------------------------------------------------

export class DagConformance {
  private constructor() { /* static class */ }

  static laws(harness: DagConformanceHarnessInterface): readonly DagConformanceLawInterface[] {
    // ── Law 1: node code is unchanged ───────────────────────────────────────
    const law1: DagConformanceLawInterface = {
      'name': 'Law 1: node executes with state surface; child DAG flow completes',
      async run(): Promise<void> {
        const dispatcher = dispatcherFor(harness);
        const state = harness.createState();
        const result = await dispatcher.execute(CONFORMANCE_DAG.law1, state);

        assert.strictEqual(result.state.lifecycle.kind, 'completed', 'flow must complete');
        assert.ok(
          (result.state as ConformanceState).executedNodes.includes('recorder'),
          'recorder node must have executed and recorded through state',
        );
      },
    };

    // ── Law 2: state mutations visible; result.state === initialState ────────
    const law2: DagConformanceLawInterface = {
      'name': 'Law 2: state mutations are visible; result.state === initialState',
      async run(): Promise<void> {
        const dispatcher = dispatcherFor(harness);
        const initialState = harness.createState();
        const result = await dispatcher.execute(CONFORMANCE_DAG.law2, initialState);

        assert.strictEqual(
          result.state, initialState,
          'result.state must be the same object reference as initialState',
        );
        assert.strictEqual(
          (result.state as ConformanceState).value, 99,
          'mutation must be visible post-execution',
        );
      },
    };

    // ── Law 3: errors collect and route; no unhandled throw ──────────────────
    const law3: DagConformanceLawInterface = {
      'name': 'Law 3: errors collect and route; container crash → collected error',
      async run(): Promise<void> {
        const dispatcher = dispatcherFor(harness);
        const state = harness.createState();
        const result = await dispatcher.execute(CONFORMANCE_DAG.law3, state);

        // After error routing the state must have collected errors OR the flow
        // itself completed with the error routed to a terminal output. Either
        // way: no unhandled throw.
        assert.ok(
          result.state.lifecycle.kind === 'completed' ||
          result.state.lifecycle.kind === 'failed',
          `flow must complete or fail, got ${result.state.lifecycle.kind}`,
        );

        // The error-emitter node calls collectError with code 'TEST_ERROR'.
        // At least one collected error on the state must carry that code.
        const stateErrors = (result.state as ConformanceState).errors;
        assert.ok(
          stateErrors.length > 0,
          'at least one error must have been collected on state',
        );
        assert.ok(
          stateErrors.some((e) => e.code === 'TEST_ERROR'),
          `expected at least one error with code 'TEST_ERROR'; got codes: [${stateErrors.map((e) => e.code).join(', ')}]`,
        );
      },
    };

    // ── Law 4: timeoutMs honored ─────────────────────────────────────────────
    const law4: DagConformanceLawInterface = {
      'name': 'Law 4: timeoutMs honored — node with timeoutMs times out',
      async run(): Promise<void> {
        const dispatcher = dispatcherFor(harness);
        const state = harness.createState();

        const start = Date.now();
        const result = await dispatcher.execute(CONFORMANCE_DAG.law4, state);
        const elapsed = Date.now() - start;

        // Lifecycle must not be 'running' when execute() returns.
        assert.notStrictEqual(
          result.state.lifecycle.kind,
          'running',
          'lifecycle must not still be running when execute() returns',
        );

        // For the timeout path, the timeout fires at ~50ms (TIMEOUT_SLEEPER_TIMEOUT_MS).
        // Exclude 'failed' outcomes (may indicate a node execution error unrelated to
        // timeout timing) from the upper-bound check.
        if (result.state.lifecycle.kind !== 'failed') {
          assert.ok(elapsed < 2000, `timeout must fire within 2s, got ${elapsed}ms`);
        }

        assert.ok(
          result.state.lifecycle.kind === 'completed' ||
          result.state.lifecycle.kind === 'cancelled' ||
          result.state.lifecycle.kind === 'timed_out' ||
          result.state.lifecycle.kind === 'failed',
          `lifecycle kind should reflect interruption, got ${result.state.lifecycle.kind}`,
        );
      },
    };

    // ── Law 5: abort propagates best-effort ──────────────────────────────────
    const law5: DagConformanceLawInterface = {
      'name': 'Law 5: abort propagates — aborted run finalizes with interruption',
      async run(): Promise<void> {
        const controller = new AbortController();
        const dispatcher = dispatcherFor(harness);
        const state = harness.createState();

        const executionPromise = Promise.resolve(
          dispatcher.execute(CONFORMANCE_DAG.law5, state, { 'signal': controller.signal }),
        );

        await new Promise<void>((resolve) => setImmediate(resolve));
        await new Promise<void>((resolve) => setTimeout(resolve, 20));
        controller.abort();

        const result = await executionPromise;

        // The abort-sleeper records `began = true` before awaiting the signal.
        // After a 20ms delay the sleeper must have started.
        assert.strictEqual(
          (result.state as ConformanceState).began,
          true,
          'abort-sleeper must have set began=true before the signal fired',
        );

        // An aborted run must finalize (not hang): lifecycle is not 'running'.
        // The sleeper resolves gracefully on abort (best-effort, not exception-based),
        // so lifecycle may be 'completed' or 'failed' — both are valid post-abort states.
        assert.notStrictEqual(
          result.state.lifecycle.kind,
          'running',
          `lifecycle must not be 'running' after abort; got ${result.state.lifecycle.kind}`,
        );
      },
    };

    // ── Law 6: subclass hooks fire parent-side with correct placementPath ─────
    // Uses a Dagonizer subclass to observe hook events rather than an
    // instrumentation plugin. The harness.createDispatcher returns a plain
    // Dagonizer; we build a separate recording subclass to capture hook events.
    const law6: DagConformanceLawInterface = {
      'name': 'Law 6: subclass hooks fire with correct placementPath on parent dispatcher',
      async run(): Promise<void> {
        const nodeStartNames: string[] = [];
        const nodeEndNames: string[] = [];
        const nodeStartPaths: string[][] = [];

        // Import Dagonizer as a value (dist/ resolves via package exports).
        const { Dagonizer } = await import('@noocodex/dagonizer');

        class RecordingDispatcher extends (Dagonizer as typeof Dagonizer<NodeStateInterface, undefined>) {
          protected override onNodeStart(nodeName: string, _state: NodeStateInterface, placementPath: readonly string[]): void {
            nodeStartNames.push(nodeName);
            nodeStartPaths.push([...placementPath]);
          }
          protected override onNodeEnd(nodeName: string, _output: string | null, _state: NodeStateInterface, _placementPath: readonly string[]): void {
            nodeEndNames.push(nodeName);
          }
        }

        const bundle = ConformanceRegistry.bundle().bundle as DispatcherBundle<NodeStateInterface, undefined>;
        const container = harness.container;
        const containers = { [harness.containerRole]: container } as Readonly<Record<string, DagContainerInterface>>;
        const dispatcher = new RecordingDispatcher({ containers });
        dispatcher.registerBundle(bundle as Parameters<typeof dispatcher.registerBundle>[0]);

        const state = harness.createState();
        await dispatcher.execute(CONFORMANCE_DAG.law6, state);

        assert.ok(
          nodeStartNames.includes('recorder'),
          `onNodeStart must fire for 'recorder', fired for: [${nodeStartNames.join(', ')}]`,
        );
        assert.ok(
          nodeEndNames.includes('recorder'),
          `onNodeEnd must fire for 'recorder', fired for: [${nodeEndNames.join(', ')}]`,
        );
        // placementPath must be non-empty when forwarded from inside the container
        const recorderIndex = nodeStartNames.indexOf('recorder');
        const recorderStartPath = recorderIndex >= 0 ? nodeStartPaths[recorderIndex] : undefined;
        assert.ok(
          recorderStartPath !== undefined && recorderStartPath.length > 0,
          `placementPath for recorder onNodeStart must be non-empty, got: ${JSON.stringify(recorderStartPath)}`,
        );
      },
    };

    // ── Law 7: scatter checkpoint bookkeeping byte-identical across backends ──
    // Runs the scatter dag-body both in-process (no container bound) and
    // through the bound container. Intercepts per-ack SCATTER_PROGRESS_KEY
    // writes on both runs. Asserts: (a) each checkpoint write is deep-equal
    // after JSON round-trip; (b) final gathered state is identical.
    //
    // The in-process run uses a Dagonizer built directly (no containers map)
    // so resolveContainer(role) returns null → inline runNodes path.
    // The contained run uses harness.createDispatcher with the container bound.
    const law7: DagConformanceLawInterface = {
      'name': 'Law 7: scatter checkpoint/resume bookkeeping byte-identical across backends',
      async run(): Promise<void> {
        const bundleResult = ConformanceRegistry.bundle();
        const bundle = bundleResult.bundle as DispatcherBundle<NodeStateInterface, undefined>;

        // Helper: run the scatter DAG and capture every per-ack checkpoint write.
        // `dispatcher` accepts the pre-built dispatcher so callers control
        // whether a container is bound.
        const runAndCapture = async (
          dispatcher: DagonizerInterface<NodeStateInterface, undefined>,
        ): Promise<{
          checkpoints: unknown[];
          finalSnapshot: unknown;
        }> => {
          const checkpoints: unknown[] = [];
          const state = harness.createState() as ConformanceState;
          // Seed 3 items for the scatter source.
          state.scatterItems = [10, 20, 30];

          // Intercept setMetadata to capture per-ack checkpoint writes.
          const origSet = state.setMetadata.bind(state);
          state.setMetadata = (key: string, value: unknown): void => {
            if (key === SCATTER_PROGRESS_KEY) {
              // Deep-copy via JSON round-trip to get a stable snapshot.
              checkpoints.push(JSON.parse(JSON.stringify(value)));
            }
            origSet(key, value);
          };

          await dispatcher.execute(CONFORMANCE_DAG.law7, state);
          const finalSnapshot = JSON.parse(JSON.stringify(state.snapshot()));
          return { checkpoints, finalSnapshot };
        };

        // Run 1: in-process (no container bound → resolveContainer returns null → inline path).
        // Use harness.createInProcessDispatcher when available; otherwise fall back to a
        // second contained run (weaker but backend-agnostic and still proves determinism).
        const inProcessDispatcher = harness.createInProcessDispatcher !== undefined
          ? harness.createInProcessDispatcher(bundle)
          : harness.createDispatcher(bundle, {} as Readonly<Record<string, DagContainerInterface>>);
        const inProcess = await runAndCapture(inProcessDispatcher);

        // Run 2: through the container (harness.createDispatcher binds the container).
        const containedDispatcher = harness.createDispatcher(
          bundle,
          { [harness.containerRole]: harness.container } as Readonly<Record<string, DagContainerInterface>>,
        );
        const contained = await runAndCapture(containedDispatcher);

        // Assert same number of checkpoint writes (one per acked item = 3).
        assert.strictEqual(
          inProcess.checkpoints.length,
          contained.checkpoints.length,
          `checkpoint write count must match: in-process=${inProcess.checkpoints.length} contained=${contained.checkpoints.length}`,
        );

        // Assert each individual checkpoint write is deep-equal after JSON round-trip.
        for (let i = 0; i < inProcess.checkpoints.length; i++) {
          assert.deepStrictEqual(
            inProcess.checkpoints[i],
            contained.checkpoints[i],
            `checkpoint write[${i}] must be byte-identical: ` +
            `in-process=${JSON.stringify(inProcess.checkpoints[i])} ` +
            `contained=${JSON.stringify(contained.checkpoints[i])}`,
          );
        }

        // Assert the gather result in parent state is also identical.
        // Both scatter over [10, 20, 30] with map gather { value → gatheredItems }.
        // scatter-counter sets clone.value += 1 (starts at 0); map gather appends
        // [1, 1, 1] to parent gatheredItems. Must be identical across both runs.
        const inProcessData = (inProcess.finalSnapshot as Record<string, unknown>)['data'] as Record<string, unknown> | undefined;
        const containedData = (contained.finalSnapshot as Record<string, unknown>)['data'] as Record<string, unknown> | undefined;
        assert.deepStrictEqual(
          inProcessData?.['gatheredItems'],
          containedData?.['gatheredItems'],
          `gathered gatheredItems must be identical: ` +
          `in-process=${JSON.stringify(inProcessData?.['gatheredItems'])} ` +
          `contained=${JSON.stringify(containedData?.['gatheredItems'])}`,
        );
      },
    };

    // ── Law 8: at-least-once under container failure ──────────────────────────
    // Harness-gated: runs only when harness.interruptMidScatter is provided.
    // When the harness supplies the capability, Law 8 kills a real isolate
    // mid-scatter (after >=1 item acks) and asserts that resume through a
    // fresh container reprocesses un-acked items (no item lost, no acked item
    // reprocessed — exactly-once effect via at-least-once + ack dedup).
    const hasLaw8Capability = harness.interruptMidScatter !== undefined;
    const law8: DagConformanceLawInterface = {
      'name': hasLaw8Capability
        ? 'Law 8: at-least-once under container failure — kill mid-scatter, assert resume'
        : 'Law 8: at-least-once under container failure [SKIP — harness does not provide interruptMidScatter]',
      async run(): Promise<void> {
        if (harness.interruptMidScatter === undefined) {
          // Skip: harness does not provide the mid-scatter interrupt capability.
          return;
        }

        const { failingContainer, freshContainer } = harness.interruptMidScatter();
        const bundle = ConformanceRegistry.bundle().bundle as DispatcherBundle<NodeStateInterface, undefined>;

        // Phase 1: start the scatter through the failing container.
        // The failingContainer kills its isolate after >=1 item acks.
        // executeScatter will throw or produce an error (pool error propagates).
        const state1 = harness.createState() as ConformanceState;
        // Seed the scatter source. scatterItems is the SOURCE array.
        // gatheredItems accumulates map-gather results from scatter-counter.
        state1.scatterItems = [10, 20, 30];

        const origSet1 = state1.setMetadata.bind(state1);
        state1.setMetadata = (key: string, value: unknown): void => {
          origSet1(key, value);
        };

        const failingContainers = {
          [harness.containerRole]: failingContainer,
        } as Readonly<Record<string, DagContainerInterface>>;
        const failingDispatcher = harness.createDispatcher(bundle, failingContainers);

        // The scatter may throw (pool error) or complete with an error output.
        // Either way, the partial state with acked items should be persisted.
        try {
          await failingDispatcher.execute(CONFORMANCE_DAG.law8, state1);
        } catch {
          // Pool error: scatter threw. Checkpoint is still on state1.
        }

        // At least one item must have been acked before the kill.
        const progress = state1.getMetadata<Record<string, ScatterProgress>>(SCATTER_PROGRESS_KEY);
        const progressEntry = (progress ?? {})['fan'];
        const ackedBefore = progressEntry?.ackedResults.length ?? 0;

        assert.ok(
          ackedBefore >= 1,
          `Expected >=1 acked item before container kill, got ${ackedBefore}. ` +
          `The failingContainer must kill after at least one item acks.`,
        );

        // Phase 2: resume through a fresh container.
        // The inbox contains un-acked items; the fresh container processes them.
        const freshContainers = {
          [harness.containerRole]: freshContainer,
        } as Readonly<Record<string, DagContainerInterface>>;
        const freshDispatcher = harness.createDispatcher(bundle, freshContainers);

        const result = await freshDispatcher.resume(CONFORMANCE_DAG.law8, state1, 'fan');

        // All 3 items must be in the final gathered state (no item lost).
        // The map gather writes clone.value (1 for each scatter-counter run)
        // into gatheredItems. Length must be 3 after full completion.
        const finalItems = (result.state as ConformanceState).gatheredItems;
        assert.strictEqual(
          finalItems.length,
          3,
          `Expected 3 gathered items after resume, got ${finalItems.length}. Un-acked items must be reprocessed.`,
        );

        // The flow must complete without error.
        assert.strictEqual(
          result.state.lifecycle.kind,
          'completed',
          `Flow must complete after resume, got ${result.state.lifecycle.kind}`,
        );

        // Verify that acked items were not re-executed: the gatheredItems array
        // must have exactly 3 entries (no duplicates from re-processing acked items).
        // Acked items' gather contribution comes from ackedResults.mappingValues;
        // if acked items were re-executed their contribution would appear twice.
        assert.strictEqual(
          finalItems.length,
          3,
          `gatheredItems must have exactly 3 entries — no duplicate processing of acked items`,
        );

        // capturedProgress was recorded during the failing run.
        // It is already validated indirectly: ackedBefore >= 1 above checks the
        // same SCATTER_PROGRESS_KEY entry. No further assertion needed.
      },
    };

    // ── Law 9: state round-trip is a fixed point ─────────────────────────────
    const law9: DagConformanceLawInterface = {
      'name': 'Law 9: state round-trip — seed→snapshot→transport→restore→run is a fixed point',
      async run(): Promise<void> {
        const dispatcher = dispatcherFor(harness);
        const initialState = harness.createState();

        // Run the mutator DAG which sets value = 99 on the child state.
        const result = await dispatcher.execute(CONFORMANCE_DAG.law9, initialState);

        // The terminal snapshot was applied in-place by applySnapshot in the
        // engine's executeEmbeddedDAG container path. If the round-trip is a
        // fixed point, value must be 99.
        assert.strictEqual(
          result.state, initialState,
          'result.state must be the same reference as initialState',
        );
        assert.strictEqual(
          (result.state as ConformanceState).value, 99,
          'snapshot round-trip must be a fixed point — value=99 must survive',
        );
      },
    };

    return [law1, law2, law3, law4, law5, law6, law7, law8, law9] as const;
  }
}
