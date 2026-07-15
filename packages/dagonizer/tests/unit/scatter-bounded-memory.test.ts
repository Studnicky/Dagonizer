/**
 * scatter-bounded-memory: regression tests for the O(1)-memory invariant
 * of compactable gather strategies.
 *
 * Proves two structural properties:
 *
 * 1. A compactable GatherStrategy receives an EMPTY records array in
 *    `finalize` — confirming that `allFreshRecords` is not accumulated
 *    during the scatter loop for compactable gathers, which is the mechanism
 *    that lets each cloneState become GC-eligible after reduce returns.
 *
 * 2. A compactable scatter over large N completes correctly — the reduce
 *    path folds every item into state, and finalize runs exactly once with
 *    the bounded accumulator fully built.
 *
 * These tests cover the fix for the O(N)-memory leak where ackItem and
 * ackBatch unconditionally pushed freshRecord (carrying cloneState) to
 * allFreshRecords, defeating the bounded-checkpoint guarantee.
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
import { NodeStateBase } from '../../src/NodeStateBase.js';
import type { NodeStateInterface } from '../../src/NodeStateBase.js';
import { Validator } from '../../src/validation/Validator.js';
import { TestNode } from '../_support/TestNode.js';

const placementIri = (dagIri: string, placementName: string): string => `${dagIri}/node/${placementName}`;

// ── state ────────────────────────────────────────────────────────────────────

class CountState extends NodeStateBase {
  counter: number = 0;
  finalizeRecordCount: number = -1; // -1 = finalize not yet called


}

// ── state that carries items ──────────────────────────────────────────────────

class ItemCountState extends CountState {
  items: number[] = [];


}

// ── test gather strategy ─────────────────────────────────────────────────────

/**
 * CountingGather: compactable (retainsRecordsForFinalize=false, the default).
 *
 * reduce: increments a counter on the parent state for each clone processed.
 * finalize: records the length of execution.records on state so the test can
 *           assert it is 0 in compactable mode (no allFreshRecords accumulated).
 */
class CountingGather extends GatherStrategy {
  readonly name = 'counting-test';
  readonly '@id' = 'urn:noocodec:node:counting-test';

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
    execution: GatherExecutionType<NodeStateBase>,
  ): Promise<void> {
    // Record how many records the engine passed us. In compactable mode this
    // must be 0 — the engine skips allFreshRecords.push for compactable gathers.
    assert.ok(
      execution.state instanceof CountState,
      'CountingGather.finalize: expected CountState',
    );
    execution.state.finalizeRecordCount = execution.records.length;
  }
}

// ── worker node ──────────────────────────────────────────────────────────────

const passThroughNode = TestNode.make<ItemCountState>('urn:noocodec:node:pass', ['done']);

// ── DAG factory ──────────────────────────────────────────────────────────────

class TestScatterDag {
  private constructor() {}

  static counting(dagIri: string, name: string, concurrency: number): DAGType {
    return {
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
          'body':        { 'node': 'urn:noocodec:node:pass' },
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
          'gather': { 'strategy': 'counting-test' },
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
    };
  }

  static multiNodeBody(dagIri: string, name: string, concurrency: number): DAGType {
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
          'body':        { 'dag': MULTI_BODY_DAG_IRI },
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
          'gather': { 'strategy': 'multi-node-body-gather' },
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

// ── setup: register the test strategy once ────────────────────────────────────

GatherStrategies.register(new CountingGather());

// ── tests ─────────────────────────────────────────────────────────────────────

void describe('Scatter: bounded-memory invariant for compactable gathers', () => {
  void it('finalize receives an empty records array in compactable mode', async () => {
    // N is deliberately large enough that a naive O(N) accumulation would
    // produce a meaningful payload, but small enough for fast unit-test runs.
    const N = 500;

    const dispatcher = new Dagonizer<ItemCountState>();
    dispatcher.registerNode(passThroughNode);
    dispatcher.registerDAG(TestScatterDag.counting('urn:noocodec:dag:bounded-finalize-records', 'bounded-finalize-records', 4));

    const state = new ItemCountState();
    state.items = Array.from({ 'length': N }, (_, i) => i);

    const result = await dispatcher.execute('urn:noocodec:dag:bounded-finalize-records', state);

    // reduce called N times → counter equals N.
    assert.equal(
      result.state.counter,
      N,
      `counter must equal N=${N} (reduce called once per clone); got ${result.state.counter}`,
    );

    // finalize ran and received 0 records — confirming allFreshRecords was not
    // accumulated for this compactable gather (the core leak fix).
    assert.equal(
      result.state.finalizeRecordCount,
      0,
      `finalize must receive 0 records in compactable mode; got ${result.state.finalizeRecordCount}. ` +
      `A non-zero value indicates allFreshRecords is still being accumulated for compactable gathers.`,
    );
  });

  void it('compactable scatter completes correctly at N=2000 (accumulator correctness)', async () => {
    const N = 2000;

    const dispatcher = new Dagonizer<ItemCountState>();
    dispatcher.registerNode(passThroughNode);
    dispatcher.registerDAG(TestScatterDag.counting('urn:noocodec:dag:bounded-large-n', 'bounded-large-n', 8));

    const state = new ItemCountState();
    state.items = Array.from({ 'length': N }, (_, i) => i);

    const result = await dispatcher.execute('urn:noocodec:dag:bounded-large-n', state);

    assert.equal(result.cursor, null, 'flow must complete cleanly');
    assert.equal(
      result.state.counter,
      N,
      `counter must equal N=${N}; got ${result.state.counter}`,
    );
    assert.equal(
      result.state.finalizeRecordCount,
      0,
      `finalize must receive 0 records in compactable mode at N=${N}; got ${result.state.finalizeRecordCount}`,
    );
  });

  void it('compactable scatter at N=5000 completes with correct accumulator', async () => {
    // Validates the bounded-memory path holds at a scale where O(N) retention
    // would produce a meaningfully larger footprint (~5k cloneState objects).
    const N = 5000;

    const dispatcher = new Dagonizer<ItemCountState>();
    dispatcher.registerNode(passThroughNode);
    dispatcher.registerDAG(TestScatterDag.counting('urn:noocodec:dag:bounded-n5000', 'bounded-n5000', 16));

    const state = new ItemCountState();
    state.items = Array.from({ 'length': N }, (_, i) => i);

    const result = await dispatcher.execute('urn:noocodec:dag:bounded-n5000', state);

    assert.equal(result.cursor, null, 'flow must complete cleanly');
    assert.equal(
      result.state.counter,
      N,
      `counter must equal N=${N}; got ${result.state.counter}`,
    );
    assert.equal(
      result.state.finalizeRecordCount,
      0,
      `finalize must receive 0 records in compactable mode at N=${N}; got ${result.state.finalizeRecordCount}`,
    );
  });

  void it('non-compactable gather is unaffected: finalize still receives all N records', async () => {
    // The 'custom' strategy has retainsRecordsForFinalize=true (non-compactable).
    // Its finalize depends on receiving every record. Verify the fix does not
    // regress non-compactable mode.
    const N = 20;

    class TrackingState extends NodeStateBase {
      items: number[] = [];
      finalizeRecordCount: number = -1;


    }

    const trackingNode = TestNode.make<TrackingState>('urn:noocodec:node:track-pass', ['done']);

    // Use a local subclass registered under a unique name to capture record count
    // We override via a local subclass registered under a unique name.
    class RecordCountingCustomGather extends GatherStrategy {
      readonly name = 'record-counting-custom';
      readonly '@id' = 'urn:noocodec:node:record-counting-custom';
      override readonly retainsRecordsForFinalize = true;

      override reduce(): void { /* custom does no per-clone work */ }

      override async finalize(
        _config: GatherConfigType,
        execution: GatherExecutionType<NodeStateBase>,
      ): Promise<void> {
        assert.ok(
          execution.state instanceof TrackingState,
          'RecordCountingCustomGather.finalize: expected TrackingState',
        );
        execution.state.finalizeRecordCount = execution.records.length;
      }
    }

    GatherStrategies.register(new RecordCountingCustomGather());

    const retainedDag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id': 'urn:noocodec:dag:retained-record-count',
      '@type':    'DAG',
      'name':     'retained-record-count',
      'version':  '1',
      'entrypoints': { 'main': placementIri('urn:noocodec:dag:retained-record-count', 'fan') },
      'nodes': [
        {
          '@id': 'urn:noocodec:dag:retained-record-count/node/fan',
          '@type':       'ScatterNode',
          'name':        'fan',
          'body':        { 'node': 'urn:noocodec:node:track-pass' },
          'source':      'items',
          'itemKey':     'item',
          'execution': { 'mode': 'item', 'concurrency': 2 },
          'outputs': {
            'all-success': placementIri('urn:noocodec:dag:retained-record-count', 'join'),
            'partial': placementIri('urn:noocodec:dag:retained-record-count', 'join'),
            'all-error': placementIri('urn:noocodec:dag:retained-record-count', 'join'),
            'empty': placementIri('urn:noocodec:dag:retained-record-count', 'end'),
          },
        },
        {
          '@id': 'urn:noocodec:dag:retained-record-count/node/join',
          '@type': 'GatherNode',
          'name': 'join',
          'sources': { [placementIri('urn:noocodec:dag:retained-record-count', 'fan')]: {} },
          'gather': { 'strategy': 'record-counting-custom' },
          'outputs': {
            'success': placementIri('urn:noocodec:dag:retained-record-count', 'end'),
            'error': placementIri('urn:noocodec:dag:retained-record-count', 'end'),
            'empty': placementIri('urn:noocodec:dag:retained-record-count', 'end'),
          },
        },
        {
          '@id': 'urn:noocodec:dag:retained-record-count/node/end',
          '@type':   'TerminalNode',
          'name':    'end',
          'outcome': 'completed',
        },
      ],
    };

    const dispatcher = new Dagonizer<TrackingState>();
    dispatcher.registerNode(trackingNode);
    dispatcher.registerDAG(retainedDag);

    const state = new TrackingState();
    state.items = Array.from({ 'length': N }, (_, i) => i);

    const result = await dispatcher.execute('urn:noocodec:dag:retained-record-count', state);

    assert.equal(result.cursor, null, 'flow must complete cleanly');
    assert.equal(
      result.state.finalizeRecordCount,
      N,
      `non-compactable finalize must receive all N=${N} records; got ${result.state.finalizeRecordCount}. ` +
      `The fix must not affect retained-mode gathers.`,
    );
  });
});

// ── multi-node DAG body tests ─────────────────────────────────────────────────
//
// A scatter whose body is a sub-DAG (body: { dag: '...' }) runs each item's
// clone through an in-process runNodes call. Prior to the fix, every inner
// node result for every clone was pushed into this.#ctx.intermediateResults,
// producing O(N*M) buffering (N items × M inner nodes). After the fix the
// array stays empty (inner nodes fire observers live; no buffering occurs).
//
// Structural assertion: the scatter's representative NodeResultType
// carries an EMPTY intermediateResults array, proving inner nodes are no
// longer buffered. Correctness assertion: the gather accumulator reflects
// all N items.

// ── state ─────────────────────────────────────────────────────────────────────

class MultiNodeBodyState extends NodeStateBase {
  items: number[] = [];
  /** Each clone increments this; gather folds it into parent. */
  counter: number = 0;
  /** Tracks finalize invocation for the compactable gather. */
  finalizeRecordCount: number = -1;


}

// ── nodes for the sub-DAG body ────────────────────────────────────────────────

/** First inner node: reads the scatter item and increments a field on the clone. */
const innerNodeA = TestNode.make<MultiNodeBodyState>('urn:noocodec:node:inner-a', ['next'], (state) => {
  state.counter += 1;
  return 'next';
});

/** Second inner node: a pass-through that confirms the pipeline continues. */
const innerNodeB = TestNode.make<MultiNodeBodyState>('urn:noocodec:node:inner-b', ['next']);

/** Third inner node: confirms three-node depth. */
const innerNodeC = TestNode.make<MultiNodeBodyState>('urn:noocodec:node:inner-c', ['done']);

// ── sub-DAG body (3 inner nodes): inner-a → inner-b → inner-c → end ──────────

const MULTI_BODY_DAG_NAME = 'multi-node-body';
const MULTI_BODY_DAG_IRI = 'urn:noocodec:dag:multi-node-body';

const multiNodeBodyDag: DAGType = Validator.dag.validate({
  '@context': DAG_CONTEXT,
  '@id': MULTI_BODY_DAG_IRI,
  '@type':    'DAG',
  'name':     MULTI_BODY_DAG_NAME,
  'version':  '1',
  'entrypoints': { 'main': placementIri(MULTI_BODY_DAG_IRI, 'inner-a') },
  'nodes': [
    {
      '@id': 'urn:noocodec:dag:multi-node-body/node/inner-a',
      '@type':  'SingleNode',
      'name':   'inner-a',
      'node':   'urn:noocodec:node:inner-a',
      'outputs': { 'next': placementIri(MULTI_BODY_DAG_IRI, 'inner-b') },
    },
    {
      '@id': 'urn:noocodec:dag:multi-node-body/node/inner-b',
      '@type':  'SingleNode',
      'name':   'inner-b',
      'node':   'urn:noocodec:node:inner-b',
      'outputs': { 'next': placementIri(MULTI_BODY_DAG_IRI, 'inner-c') },
    },
    {
      '@id': 'urn:noocodec:dag:multi-node-body/node/inner-c',
      '@type':  'SingleNode',
      'name':   'inner-c',
      'node':   'urn:noocodec:node:inner-c',
      'outputs': { 'done': placementIri(MULTI_BODY_DAG_IRI, 'body-end') },
    },
    {
      '@id': 'urn:noocodec:dag:multi-node-body/node/body-end',
      '@type':   'TerminalNode',
      'name':    'body-end',
      'outcome': 'completed',
    },
  ],
});

// ── gather strategy for multi-node body tests ─────────────────────────────────

class MultiNodeBodyGather extends GatherStrategy {
  readonly name = 'multi-node-body-gather';
  readonly '@id' = 'urn:noocodec:node:multi-node-body-gather';

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
    execution: GatherExecutionType<NodeStateBase>,
  ): Promise<void> {
    assert.ok(
      execution.state instanceof MultiNodeBodyState,
      'MultiNodeBodyGather.finalize: expected MultiNodeBodyState',
    );
    execution.state.finalizeRecordCount = execution.records.length;
  }
}

GatherStrategies.register(new MultiNodeBodyGather());

// ── parent DAG: scatter with body.dag pointing to the 3-node sub-DAG ─────────
// (see TestScatterDag.multiNodeBody above)

void describe('Scatter: bounded-memory invariant for multi-node DAG body (in-process path)', () => {
  void it('scatter result carries empty intermediateResults proving inner nodes are not buffered', async () => {
    // N items × 3 inner nodes = 3000 inner results that would have been buffered
    // before the fix. Assert the scatter's representative result has an empty
    // intermediateResults array (the structural proof of the fix).
    const N = 1000;

    const dispatcher = new Dagonizer<MultiNodeBodyState>();
    dispatcher.registerNode(innerNodeA);
    dispatcher.registerNode(innerNodeB);
    dispatcher.registerNode(innerNodeC);
    dispatcher.registerDAG(multiNodeBodyDag);
    dispatcher.registerDAG(TestScatterDag.multiNodeBody('urn:noocodec:dag:multi-body-empty-intermediates', 'multi-body-empty-intermediates', 4));

    const state = new MultiNodeBodyState();
    state.items = Array.from({ 'length': N }, (_, i) => i);

    // Iterate the execution to capture the scatter firing's NodeResultType.
    // execute() returns an Execution<T> which is async-iterable; each yielded
    // value is a NodeResultType for a node that completed.
    const execution = dispatcher.execute('urn:noocodec:dag:multi-body-empty-intermediates', state);
    let scatterResult: { intermediateResults: unknown[] } | null = null;
    for await (const stage of execution) {
      // The scatter node is named 'fan'; its representative result is the one
      // the runNodes loop yields for the scatter firing.
      if (stage.nodeName === 'fan') {
        scatterResult = stage as { intermediateResults: unknown[] };
      }
    }

    assert.ok(scatterResult !== null, 'scatter firing must yield a stage result');
    assert.deepEqual(
      scatterResult.intermediateResults,
      [],
      `scatter representative result must carry an empty intermediateResults array ` +
      `(inner nodes are no longer buffered); got ${scatterResult.intermediateResults.length} entries. ` +
      `A non-empty array proves inner-node buffering still occurs (O(N*M) leak).`,
    );
  });

  void it('multi-node DAG body scatter completes correctly at N=3000 with correct accumulator', async () => {
    // 3000 items × 3 inner nodes = 9000 inner results that would have caused
    // significant heap growth before the fix. Confirm correctness: each item
    // runs all 3 inner nodes (InnerNodeA increments counter once per clone),
    // so the gathered counter must equal N.
    const N = 3000;

    const dispatcher = new Dagonizer<MultiNodeBodyState>();
    dispatcher.registerNode(innerNodeA);
    dispatcher.registerNode(innerNodeB);
    dispatcher.registerNode(innerNodeC);
    dispatcher.registerDAG(multiNodeBodyDag);
    dispatcher.registerDAG(TestScatterDag.multiNodeBody('urn:noocodec:dag:multi-body-n3000', 'multi-body-n3000', 8));

    const state = new MultiNodeBodyState();
    state.items = Array.from({ 'length': N }, (_, i) => i);

    const result = await dispatcher.execute('urn:noocodec:dag:multi-body-n3000', state);

    assert.equal(result.cursor, null, 'flow must complete cleanly with no resume cursor');
    assert.equal(
      result.state.counter,
      N,
      `counter must equal N=${N} (InnerNodeA runs once per clone); got ${result.state.counter}`,
    );
    assert.equal(
      result.state.finalizeRecordCount,
      0,
      `finalize must receive 0 records in compactable mode; got ${result.state.finalizeRecordCount}`,
    );
  });
});
