/**
 * scatter-memory-bound: regression test for the O(N×M) memory leak where
 * scatter body inner-node stages were buffered into `intermediateResults` and
 * streamed to the top-level consumer.
 *
 * Root cause (fixed): `ScatterPoolDriver.executeItem` (in-process DAG body
 * path) was pushing every yield from the body `runNodes` generator into
 * `scatterCtx.intermediateResults`, annotating each with the scatter name prefix
 * (`${scatter.name}.${nr.nodeName}`). The scatter's returned
 * `NodeResultType.intermediateResults` then contained all N×M inner-node
 * stages. The top-level `runNodes` loop yielded every element of
 * `intermediateResults` before yielding the scatter's own result, producing
 * O(N×M) stages to the consumer.
 *
 * Correct semantics:
 * - The scatter's `result.intermediateResults` MUST be empty.
 * - Top-level consumer receives AT MOST `O(DAG breadth)` yielded stages for
 *   a scatter firing — specifically the scatter's own representative result
 *   (one stage) regardless of N or M.
 * - Inner-node observability is delivered via `onNodeStart`/`onNodeEnd` observer
 *   hooks on a Dagonizer subclass, NOT via yielded stages.
 * - Gather correctness and resume correctness are unchanged.
 *
 * This test file asserts the BOUNDED contract (stage count < N) and verifies
 * hook-based observability is preserved (observer sees all N×M `onNodeEnd` calls).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { StateAccessorInterface } from '../../src/contracts/StateAccessorInterface.js';
import type { GatherExecutionType } from '../../src/core/GatherStrategies.js';
import { GatherStrategies, GatherStrategy } from '../../src/core/GatherStrategies.js';
import { Dagonizer } from '../../src/Dagonizer.js';
import { DAG_CONTEXT } from '../../src/entities/dag/DAG.js';
import type { GatherConfigType } from '../../src/entities/dag/GatherConfig.js';
import type { DAGType } from '../../src/entities/index.js';
import type { NodeResultType } from '../../src/entities/node/NodeResult.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';
import type { NodeStateInterface } from '../../src/NodeStateBase.js';
import { Validator } from '../../src/validation/Validator.js';
import { TestNode } from '../_support/TestNode.js';

const placementIri = (dagName: string, placementName: string): string => `${dagName}/node/${placementName}`;

// ── State ─────────────────────────────────────────────────────────────────────

class BoundState extends NodeStateBase {
  items: number[] = [];
  counter: number = 0;


}

// ── Inner nodes for the 3-node sequential sub-DAG body ────────────────────────

const bodyNodeA = TestNode.make<BoundState>('urn:noocodec:node:body-a', ['next'], (state) => {
  state.counter += 1;
  return 'next';
});

const bodyNodeB = TestNode.make<BoundState>('urn:noocodec:node:body-b', ['next']);

const bodyNodeC = TestNode.make<BoundState>('urn:noocodec:node:body-c', ['done']);

// ── Gather strategy: compactable (folds per-clone into parent via reduce) ─────

class BoundGather extends GatherStrategy {
  readonly name = 'bound-memory-gather';
  readonly '@id' = 'urn:noocodec:node:bound-memory-gather';

  reduce(
    _config: GatherConfigType,
    batch: Parameters<GatherStrategy['reduce']>[1],
    state: NodeStateInterface,
    accessor: StateAccessorInterface,
  ): void {
    const rawCounter = accessor.get(state, 'counter');
    const current = typeof rawCounter === 'number' ? rawCounter : 0;
    accessor.set(state, 'counter', current + batch.size);
  }

  override async finalize(
    _config: GatherConfigType,
    _execution: GatherExecutionType<NodeStateBase>,
  ): Promise<void> {
    // no-op: compactable gather; state already populated via reduce
  }
}

GatherStrategies.register(new BoundGather());

// ── 3-node sub-DAG body: body-a → body-b → body-c → body-end ─────────────────

const BODY_DAG_NAME = 'bound-memory-body';
const BODY_DAG_IRI = 'urn:noocodec:dag:bound-memory-body';

const bodyDag: DAGType = Validator.dag.validate({
  '@context': DAG_CONTEXT,
  '@id': BODY_DAG_IRI,
  '@type':    'DAG',
  'name':     BODY_DAG_NAME,
  'version':  '1',
  'entrypoints': { 'main': placementIri(BODY_DAG_IRI, 'body-a') },
  'nodes': [
    {
      '@id': placementIri(BODY_DAG_IRI, 'body-a'),
      '@type':  'SingleNode',
      'name':   'body-a',
      'node':   'urn:noocodec:node:body-a',
      'outputs': { 'next': placementIri(BODY_DAG_IRI, 'body-b') },
    },
    {
      '@id': placementIri(BODY_DAG_IRI, 'body-b'),
      '@type':  'SingleNode',
      'name':   'body-b',
      'node':   'urn:noocodec:node:body-b',
      'outputs': { 'next': placementIri(BODY_DAG_IRI, 'body-c') },
    },
    {
      '@id': placementIri(BODY_DAG_IRI, 'body-c'),
      '@type':  'SingleNode',
      'name':   'body-c',
      'node':   'urn:noocodec:node:body-c',
      'outputs': { 'done': placementIri(BODY_DAG_IRI, 'body-end') },
    },
    {
      '@id': placementIri(BODY_DAG_IRI, 'body-end'),
      '@type':   'TerminalNode',
      'name':    'body-end',
      'outcome': 'completed',
    },
  ],
});

// ── Parent DAG: scatter with DAG body ─────────────────────────────────────────

class TestScatterDag {
  private constructor() {}
  static bound(dagIri: string, name: string, concurrency: number): DAGType {
    return Validator.dag.validate({
      '@context': DAG_CONTEXT,
      '@id': dagIri,
      '@type':    'DAG',
      'name':     name,
      'version':  '1',
      'entrypoints': { 'main': placementIri(dagIri, 'fan') },
      'nodes': [
        {
          '@id': placementIri(dagIri, 'fan'),
          '@type':       'ScatterNode',
          'name':        'fan',
          'body':        { 'dag': BODY_DAG_IRI },
          'source':      'items',
          'itemKey':     'item',
          'execution': { 'mode': 'item', 'concurrency': concurrency },
          'outputs': {
            'all-success': placementIri(dagIri, 'join'),
            'partial': placementIri(dagIri, 'join'),
            'all-error': placementIri(dagIri, 'join'),
            'empty': placementIri(dagIri, 'end'),
          },
        },
        {
          '@id': placementIri(dagIri, 'join'),
          '@type': 'GatherNode',
          'name': 'join',
          'sources': { [placementIri(dagIri, 'fan')]: {} },
          'gather': { 'strategy': 'bound-memory-gather' },
          'outputs': {
            'success': placementIri(dagIri, 'end'),
            'error': placementIri(dagIri, 'end'),
            'empty': placementIri(dagIri, 'end'),
          },
        },
        {
          '@id': placementIri(dagIri, 'end'),
          '@type':   'TerminalNode',
          'name':    'end',
          'outcome': 'completed',
        },
      ],
    });
  }
}

// ── Observer subclass: counts onNodeEnd calls ─────────────────────────────────

class ObservingDagonizer extends Dagonizer<BoundState> {
  nodeEndCount = 0;
  override onNodeEnd(_nodeName: string, _output: string | null, _state: BoundState, _path: readonly string[]): void {
    this.nodeEndCount++;
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

void describe('Scatter: O(N×M) stage-streaming regression (scatter-memory-bound)', () => {
  /**
   * Core regression: a scatter over N items with a 3-node body DAG (M=3) must
   * yield FEWER THAN N stages to the top-level consumer via `for await`.
   *
   * Before the fix, the inner stages were buffered into `intermediateResults`
   * and streamed to the parent — producing N×M = 9,000 stages for N=3,000 / M=3.
   * After the fix, the scatter yields its own representative result (one stage)
   * plus any subsequent top-level DAG nodes — O(DAG breadth), not O(N×M).
   *
   * Why this matters: at N=20,000 / M~19 the pre-fix code yielded 387,263
   * stages; at N=1,000,000 it caused OOM. Post-fix, N=1,000,000 completes
   * with <200 MB peak heap and yields 3 top-level stages.
   */
  void it('scatter over N=3000 items with 3-node body DAG yields fewer than N top-level stages', async () => {
    const N = 3000;

    const dispatcher = new ObservingDagonizer();
    dispatcher.registerNode(bodyNodeA);
    dispatcher.registerNode(bodyNodeB);
    dispatcher.registerNode(bodyNodeC);
    dispatcher.registerDAG(bodyDag);
    dispatcher.registerDAG(TestScatterDag.bound('urn:noocodec:dag:bound-N3000', 'bound-N3000', 4));

    const state = new BoundState();
    state.items = Array.from({ 'length': N }, (_, i) => i);

    const execution = dispatcher.execute('urn:noocodec:dag:bound-N3000', state);
    let yieldedStageCount = 0;

    for await (const _stage of execution) {
      yieldedStageCount++;
    }
    await execution;

    // Bounded contract: yielded stages < N.
    // With the fix, only the scatter's own result + TerminalNode are yielded
    // (2 stages total). Before the fix: N × M = 9,000 stages.
    assert.ok(
      yieldedStageCount < N,
      `yielded stage count (${yieldedStageCount}) must be < N (${N}). ` +
      `A count >= N proves inner scatter-body stages are streaming to the parent (O(N×M) leak).`,
    );

    // Gather correctness: BodyNodeA increments counter once per clone;
    // the gather folds each clone into the parent state. Counter must equal N.
    // This verifies that bounding stage output does not break gather correctness.
    assert.equal(
      state.counter,
      N,
      `counter must equal N=${N} after gather (BodyNodeA increments once per clone). ` +
      `Got ${state.counter} — gather correctness is broken.`,
    );
  });

  /**
   * Hook-based observability contract: inner per-node stages must be visible
   * via the `onNodeEnd` observer hook on a Dagonizer subclass, even though
   * they are NOT yielded to the top-level `for await` consumer.
   *
   * The observer sees all N×M inner `onNodeEnd` calls (N items × M body nodes
   * including the TerminalNode). This proves hooks remain the correct
   * observability channel for scatter inner-node activity.
   */
  void it('hook-based observer sees all N×M inner onNodeEnd calls while top-level consumer sees bounded stages', async () => {
    const N = 500;
    // body-a + body-b + body-c + body-end (TerminalNode) = 4 nodes per clone
    const M = 4;

    const dispatcher = new ObservingDagonizer();
    dispatcher.registerNode(bodyNodeA);
    dispatcher.registerNode(bodyNodeB);
    dispatcher.registerNode(bodyNodeC);
    dispatcher.registerDAG(bodyDag);
    dispatcher.registerDAG(TestScatterDag.bound('urn:noocodec:dag:bound-hooks-N500', 'bound-hooks-N500', 4));

    const state = new BoundState();
    state.items = Array.from({ 'length': N }, (_, i) => i);

    const execution = dispatcher.execute('urn:noocodec:dag:bound-hooks-N500', state);
    let yieldedStageCount = 0;

    for await (const _stage of execution) {
      yieldedStageCount++;
    }
    await execution;

    // Top-level consumer: bounded (far fewer than N stages)
    assert.ok(
      yieldedStageCount < N,
      `yielded stage count (${yieldedStageCount}) must be < N (${N})`,
    );

    // Observer hook: must have seen N×M inner-node calls plus top-level nodes.
    // The observer also fires for top-level nodes (fan, end), so total >= N*M.
    // We assert >= N*M as a lower-bound: all body inner nodes fired hooks.
    const minExpected = N * M;
    assert.ok(
      dispatcher.nodeEndCount >= minExpected,
      `observer must see at least N×M=${minExpected} onNodeEnd calls (all body nodes for all items). ` +
      `Got ${dispatcher.nodeEndCount}. Hook-based observability is broken if this fails.`,
    );
  });

  /**
   * Scatter representative result carries an empty intermediateResults array.
   *
   * This is the structural proof of the fix: `executeScatter` must return a
   * result with `intermediateResults = []`. Any non-empty value means inner
   * body stages are still being buffered at the scatter level (O(N×M) leak).
   */
  void it('scatter representative result carries empty intermediateResults', async () => {
    const N = 200;

    const dispatcher = new Dagonizer<BoundState>();
    dispatcher.registerNode(bodyNodeA);
    dispatcher.registerNode(bodyNodeB);
    dispatcher.registerNode(bodyNodeC);
    dispatcher.registerDAG(bodyDag);
    dispatcher.registerDAG(TestScatterDag.bound('urn:noocodec:dag:bound-intermediates-N200', 'bound-intermediates-N200', 2));

    const state = new BoundState();
    state.items = Array.from({ 'length': N }, (_, i) => i);

    const execution = dispatcher.execute('urn:noocodec:dag:bound-intermediates-N200', state);
    // Iteration yields heterogeneous per-node results typed `NodeStateInterface`
    // (a child embedded node runs on its own isolation state); this test reads
    // only `nodeName` and `intermediateResults`, both on the base interface.
    let scatterResult: NodeResultType<NodeStateInterface> | null = null;

    for await (const stage of execution) {
      if (stage.nodeName === 'fan') {
        scatterResult = stage;
      }
    }
    await execution;

    assert.ok(scatterResult !== null, 'scatter "fan" stage must be yielded');
    assert.deepEqual(
      scatterResult.intermediateResults,
      [],
      `scatter representative result must carry an empty intermediateResults array. ` +
      `Got ${scatterResult.intermediateResults.length} entries. ` +
      `A non-empty array means inner-node buffering is occurring (O(N×M) leak active).`,
    );
  });

  /**
   * Heap assertion (optional — only runs when --expose-gc is active):
   * peak heap during a scatter over N=3000 items must stay well below N×M×state-size.
   * This is a best-effort check; CI runs without --expose-gc and the test skips.
   */
  void it('heap usage during scatter over N=3000 stays bounded (GC-gated)', async () => {
    const gcFn: unknown = Reflect.get(globalThis, 'gc');
    if (typeof gcFn !== 'function') {
      // Not running with --expose-gc: skip heap assertion.
      return;
    }
    const gc = (): void => { gcFn.call(undefined); };

    const N = 3000;

    const dispatcher = new Dagonizer<BoundState>();
    dispatcher.registerNode(bodyNodeA);
    dispatcher.registerNode(bodyNodeB);
    dispatcher.registerNode(bodyNodeC);
    dispatcher.registerDAG(bodyDag);
    dispatcher.registerDAG(TestScatterDag.bound('urn:noocodec:dag:bound-heap-N3000', 'bound-heap-N3000', 4));

    const state = new BoundState();
    state.items = Array.from({ 'length': N }, (_, i) => i);

    gc();
    const baseline = process.memoryUsage().heapUsed;

    const execution = dispatcher.execute('urn:noocodec:dag:bound-heap-N3000', state);
    let peak = baseline;
    for await (const _stage of execution) {
      const cur = process.memoryUsage().heapUsed;
      if (cur > peak) peak = cur;
    }
    await execution;

    gc();
    gc();
    const live = process.memoryUsage().heapUsed;

    // Peak during scatter must be < 50 MB above baseline.
    // Before the fix, N=3000 / M=3 would produce 9,000 NodeResultType objects
    // in-flight, each carrying state references — easily 100+ MB above baseline.
    // After the fix, peak should be <50 MB above baseline (a generous margin that
    // covers the N clone states concurrently in-flight with concurrency=4).
    const peakMB = (peak - baseline) / (1024 * 1024);
    assert.ok(
      peakMB < 50,
      `peak heap delta must be < 50 MB; got ${peakMB.toFixed(1)} MB. ` +
      `A large delta proves scatter inner-node buffering is retaining N×M objects in-flight.`,
    );

    // Live heap after GC must also be bounded.
    const liveMB = (live - baseline) / (1024 * 1024);
    assert.ok(
      liveMB < 20,
      `post-GC live heap delta must be < 20 MB; got ${liveMB.toFixed(1)} MB`,
    );
  });
});
