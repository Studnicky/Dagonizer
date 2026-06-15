/**
 * Frontier walk tests: exercises the batch-native frontier scheduler.
 *
 * Uses hand-written `NodeInterface` implementations to exercise multi-item
 * batches through the DAG. The `execute()` API seeds a size-1 batch from the
 * provided initial state; multi-item batches are produced when the entry node
 * fans out (returns a RoutedBatch whose single port holds N items), then flow
 * through subsequent SingleNode placements until reaching a TerminalNode.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { NodeInterface } from '../../src/contracts/NodeInterface.js';
import { EMPTY_CONTRACT_FRAGMENT } from '../../src/contracts/OperationContractFragment.js';
import { Batch } from '../../src/core/batch/Batch.js';
import type { RoutedBatch } from '../../src/core/batch/RoutedBatch.js';
import { Dagonizer } from '../../src/Dagonizer.js';
import { DAG_CONTEXT } from '../../src/entities/dag/DAG.js';
import type { DAG } from '../../src/entities/dag/DAG.js';
import type { NodeContextInterface } from '../../src/entities/node/NodeContext.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';
import { Timeout } from '../../src/runtime/Timeout.js';
import { TestNode } from '../_support/TestNode.js';

// ---------------------------------------------------------------------------
// Test state: extends NodeStateBase with a counter field.
// ---------------------------------------------------------------------------

class WalkState extends NodeStateBase {
  count: number;
  log: string[];

  constructor() {
    super();
    this.count = 0;
    this.log = [];
  }

  override clone(): this {
    const copy = new WalkState() as this;
    copy.count = this.count;
    copy.log = [...this.log];
    return copy;
  }
}

// ---------------------------------------------------------------------------
// Helper: fan-out node — takes a size-1 batch and emits N items on one port.
//
// On the single input item, clones `n` states (each with an incremented `count`
// identifying which item it is). Routes all N to port 'out'.
// ---------------------------------------------------------------------------

function makeFanOutNode(name: string, n: number): NodeInterface<WalkState, 'out'> {
  return {
    name,
    'outputs': ['out'] as const,
    'contract': EMPTY_CONTRACT_FRAGMENT,
    'timeout': Timeout.none(),
    async execute(batch: Batch<WalkState>, _ctx: NodeContextInterface): Promise<RoutedBatch<'out', WalkState>> {
      // Take the first (and only) item and fan out to N clones.
      const sourceState = batch.row(0).state;
      const items: Array<{ 'id': string; 'state': WalkState }> = [];
      for (let i = 0; i < n; i++) {
        const clone = sourceState.clone();
        clone.count = i;
        clone.log.push(`fan:${i}`);
        items.push({ 'id': String(i), 'state': clone });
      }
      const result = new Map<'out', Batch<WalkState>>();
      result.set('out', Batch.from(items));
      return result;
    },
  };
}

// ---------------------------------------------------------------------------
// Helper: partition node — splits items across two ports by even/odd count.
// ---------------------------------------------------------------------------

function makePartitionNode(name: string): NodeInterface<WalkState, 'even' | 'odd'> {
  return {
    name,
    'outputs': ['even', 'odd'] as const,
    'contract': EMPTY_CONTRACT_FRAGMENT,
    'timeout': Timeout.none(),
    async execute(batch: Batch<WalkState>, _ctx: NodeContextInterface): Promise<RoutedBatch<'even' | 'odd', WalkState>> {
      const partitioned = batch.partition((s) => s.count % 2 === 0 ? 'even' : 'odd');
      const result = new Map<'even' | 'odd', Batch<WalkState>>();
      for (const [key, b] of partitioned) {
        result.set(key, b);
      }
      return result;
    },
  };
}

// ---------------------------------------------------------------------------
// Helper: recording node — stamps each item's log and records batch sizes.
// ---------------------------------------------------------------------------

function makeRecordingNode(
  name: string,
  firings: number[],
): NodeInterface<WalkState, 'done'> {
  return {
    name,
    'outputs': ['done'] as const,
    'contract': EMPTY_CONTRACT_FRAGMENT,
    'timeout': Timeout.none(),
    async execute(batch: Batch<WalkState>, _ctx: NodeContextInterface): Promise<RoutedBatch<'done', WalkState>> {
      firings.push(batch.size);
      const items: Array<{ 'id': string; 'state': WalkState }> = [];
      for (const item of batch) {
        item.state.log.push(`${name}:run`);
        items.push({ 'id': item.id, 'state': item.state });
      }
      const result = new Map<'done', Batch<WalkState>>();
      result.set('done', Batch.from(items));
      return result;
    },
  };
}

// ---------------------------------------------------------------------------
// Helper: accumulator node — merges all items into one terminal state.
// Used to collect multi-item batches before the terminal.
// ---------------------------------------------------------------------------

function makeAccumulatorNode(
  name: string,
  collected: WalkState[],
): NodeInterface<WalkState, 'done'> {
  return {
    name,
    'outputs': ['done'] as const,
    'contract': EMPTY_CONTRACT_FRAGMENT,
    'timeout': Timeout.none(),
    async execute(batch: Batch<WalkState>, _ctx: NodeContextInterface): Promise<RoutedBatch<'done', WalkState>> {
      for (const item of batch) {
        collected.push(item.state);
      }
      // Route all items through to the terminal.
      const result = new Map<'done', Batch<WalkState>>();
      result.set('done', batch);
      return result;
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

void describe('Frontier walk — size-1 parity', () => {
  void it('size-1 linear walk matches expected executedNodes order', async () => {
    const dispatcher = new Dagonizer<NodeStateBase>();
    dispatcher.registerNode(TestNode.make('step1', ['ok'], () => 'ok'));
    dispatcher.registerNode(TestNode.make('step2', ['ok'], () => 'ok'));
    dispatcher.registerNode(TestNode.make('step3', ['ok'], () => 'ok'));

    const dag: DAG = {
      '@context': DAG_CONTEXT,
      '@id': 'urn:noocodex:dag:parity-linear',
      '@type': 'DAG',
      'name': 'parity-linear',
      'version': '1',
      'entrypoint': 'p1',
      'nodes': [
        { '@id': 'urn:noocodex:dag:parity-linear/node/p1', '@type': 'SingleNode',
          'name': 'p1', 'node': 'step1', 'outputs': { 'ok': 'p2' } },
        { '@id': 'urn:noocodex:dag:parity-linear/node/p2', '@type': 'SingleNode',
          'name': 'p2', 'node': 'step2', 'outputs': { 'ok': 'p3' } },
        { '@id': 'urn:noocodex:dag:parity-linear/node/p3', '@type': 'SingleNode',
          'name': 'p3', 'node': 'step3', 'outputs': { 'ok': 'end' } },
        { '@id': 'urn:noocodex:dag:parity-linear/node/end', '@type': 'TerminalNode',
          'name': 'end', 'outcome': 'completed' },
      ],
    };
    dispatcher.registerDAG(dag);

    const result = await dispatcher.execute('parity-linear', new NodeStateBase());
    assert.deepEqual(result.executedNodes, ['p1', 'p2', 'p3', 'end']);
    assert.equal(result.terminalOutcome, 'completed');
    assert.equal(result.cursor, null);
  });

  void it('size-1 branching walk routes correctly and tracks executedNodes', async () => {
    const dispatcher = new Dagonizer<NodeStateBase>();
    dispatcher.registerNode(TestNode.make('classify', ['ok', 'skip'], () => 'ok'));
    dispatcher.registerNode(TestNode.make('process', ['done'], () => 'done'));

    const dag: DAG = {
      '@context': DAG_CONTEXT,
      '@id': 'urn:noocodex:dag:parity-branch',
      '@type': 'DAG',
      'name': 'parity-branch',
      'version': '1',
      'entrypoint': 'cls',
      'nodes': [
        { '@id': 'urn:noocodex:dag:parity-branch/node/cls', '@type': 'SingleNode',
          'name': 'cls', 'node': 'classify', 'outputs': { 'ok': 'proc', 'skip': 'end' } },
        { '@id': 'urn:noocodex:dag:parity-branch/node/proc', '@type': 'SingleNode',
          'name': 'proc', 'node': 'process', 'outputs': { 'done': 'end' } },
        { '@id': 'urn:noocodex:dag:parity-branch/node/end', '@type': 'TerminalNode',
          'name': 'end', 'outcome': 'completed' },
      ],
    };
    dispatcher.registerDAG(dag);

    const result = await dispatcher.execute('parity-branch', new NodeStateBase());
    assert.deepEqual(result.executedNodes, ['cls', 'proc', 'end']);
    assert.equal(result.terminalOutcome, 'completed');
  });
});

void describe('Frontier walk — linear multi-item', () => {
  void it('N items flow A→B→end; B fires once over all N', async () => {
    const dispatcher = new Dagonizer<WalkState>();
    const bFirings: number[] = [];

    dispatcher.registerNode(makeFanOutNode('fanout', 4));
    dispatcher.registerNode(makeRecordingNode('recorder', bFirings));

    const collected: WalkState[] = [];
    dispatcher.registerNode(makeAccumulatorNode('acc', collected));

    const dag: DAG = {
      '@context': DAG_CONTEXT,
      '@id': 'urn:noocodex:dag:linear-multi',
      '@type': 'DAG',
      'name': 'linear-multi',
      'version': '1',
      'entrypoint': 'fan',
      'nodes': [
        { '@id': 'urn:noocodex:dag:linear-multi/node/fan', '@type': 'SingleNode',
          'name': 'fan', 'node': 'fanout', 'outputs': { 'out': 'rec' } },
        { '@id': 'urn:noocodex:dag:linear-multi/node/rec', '@type': 'SingleNode',
          'name': 'rec', 'node': 'recorder', 'outputs': { 'done': 'collect' } },
        { '@id': 'urn:noocodex:dag:linear-multi/node/collect', '@type': 'SingleNode',
          'name': 'collect', 'node': 'acc', 'outputs': { 'done': 'end' } },
        { '@id': 'urn:noocodex:dag:linear-multi/node/end', '@type': 'TerminalNode',
          'name': 'end', 'outcome': 'completed' },
      ],
    };
    dispatcher.registerDAG(dag);

    const result = await dispatcher.execute('linear-multi', new WalkState());
    assert.equal(result.terminalOutcome, 'completed');
    // B (recorder) fired exactly once over all 4 items.
    assert.deepEqual(bFirings, [4]);
    // All 4 items reached the accumulator.
    assert.equal(collected.length, 4);
    // Each item has the recorder log entry.
    for (const s of collected) {
      assert.ok(s.log.includes('recorder:run'));
    }
  });
});

void describe('Frontier walk — branch multi-item', () => {
  void it('partition node splits N items across two ports, each port fires once downstream', async () => {
    const dispatcher = new Dagonizer<WalkState>();
    // Items 0..5; even: 0, 2, 4 (3 items); odd: 1, 3, 5 (3 items).
    dispatcher.registerNode(makeFanOutNode('fanout', 6));
    dispatcher.registerNode(makePartitionNode('part'));

    const evenFirings: number[] = [];
    const oddFirings: number[] = [];
    const evenCollected: WalkState[] = [];
    const oddCollected: WalkState[] = [];

    dispatcher.registerNode(makeRecordingNode('even-proc', evenFirings));
    dispatcher.registerNode(makeRecordingNode('odd-proc', oddFirings));
    dispatcher.registerNode(makeAccumulatorNode('even-acc', evenCollected));
    dispatcher.registerNode(makeAccumulatorNode('odd-acc', oddCollected));

    const dag: DAG = {
      '@context': DAG_CONTEXT,
      '@id': 'urn:noocodex:dag:branch-multi',
      '@type': 'DAG',
      'name': 'branch-multi',
      'version': '1',
      'entrypoint': 'fan',
      'nodes': [
        { '@id': 'urn:noocodex:dag:branch-multi/node/fan', '@type': 'SingleNode',
          'name': 'fan', 'node': 'fanout', 'outputs': { 'out': 'partition' } },
        { '@id': 'urn:noocodex:dag:branch-multi/node/partition', '@type': 'SingleNode',
          'name': 'partition', 'node': 'part', 'outputs': { 'even': 'even-step', 'odd': 'odd-step' } },
        { '@id': 'urn:noocodex:dag:branch-multi/node/even-step', '@type': 'SingleNode',
          'name': 'even-step', 'node': 'even-proc', 'outputs': { 'done': 'even-collect' } },
        { '@id': 'urn:noocodex:dag:branch-multi/node/odd-step', '@type': 'SingleNode',
          'name': 'odd-step', 'node': 'odd-proc', 'outputs': { 'done': 'odd-collect' } },
        { '@id': 'urn:noocodex:dag:branch-multi/node/even-collect', '@type': 'SingleNode',
          'name': 'even-collect', 'node': 'even-acc', 'outputs': { 'done': 'end' } },
        { '@id': 'urn:noocodex:dag:branch-multi/node/odd-collect', '@type': 'SingleNode',
          'name': 'odd-collect', 'node': 'odd-acc', 'outputs': { 'done': 'end' } },
        { '@id': 'urn:noocodex:dag:branch-multi/node/end', '@type': 'TerminalNode',
          'name': 'end', 'outcome': 'completed' },
      ],
    };
    dispatcher.registerDAG(dag);

    const result = await dispatcher.execute('branch-multi', new WalkState());
    assert.equal(result.terminalOutcome, 'completed');

    // each branch fires exactly once over its sub-batch
    assert.deepEqual(evenFirings, [3]);
    assert.deepEqual(oddFirings, [3]);

    // even items: counts 0, 2, 4
    assert.equal(evenCollected.length, 3);
    const evenCounts = evenCollected.map((s) => s.count).sort((a, b) => a - b);
    assert.deepEqual(evenCounts, [0, 2, 4]);

    // odd items: counts 1, 3, 5
    assert.equal(oddCollected.length, 3);
    const oddCounts = oddCollected.map((s) => s.count).sort((a, b) => a - b);
    assert.deepEqual(oddCounts, [1, 3, 5]);
  });
});

void describe('Frontier walk — diamond join with rank coalescing', () => {
  void it('join node (D) fires exactly once over the merged batch from B and C', async () => {
    // Shape: fan(1→N) → partitioner → B(even), C(odd) → join → end
    // D must fire exactly once over ALL N items combined.
    const dispatcher = new Dagonizer<WalkState>();
    const dFirings: number[] = [];
    const collected: WalkState[] = [];

    dispatcher.registerNode(makeFanOutNode('fanout', 8)); // 8 items: 0..7
    dispatcher.registerNode(makePartitionNode('part'));
    dispatcher.registerNode(makeRecordingNode('b-proc', []));  // even branch
    dispatcher.registerNode(makeRecordingNode('c-proc', []));  // odd branch
    dispatcher.registerNode(makeRecordingNode('join', dFirings));  // THE JOIN
    dispatcher.registerNode(makeAccumulatorNode('acc', collected));

    const dag: DAG = {
      '@context': DAG_CONTEXT,
      '@id': 'urn:noocodex:dag:diamond-join',
      '@type': 'DAG',
      'name': 'diamond-join',
      'version': '1',
      'entrypoint': 'fan',
      'nodes': [
        { '@id': 'urn:noocodex:dag:diamond-join/node/fan', '@type': 'SingleNode',
          'name': 'fan', 'node': 'fanout', 'outputs': { 'out': 'partition' } },
        { '@id': 'urn:noocodex:dag:diamond-join/node/partition', '@type': 'SingleNode',
          'name': 'partition', 'node': 'part', 'outputs': { 'even': 'b', 'odd': 'c' } },
        { '@id': 'urn:noocodex:dag:diamond-join/node/b', '@type': 'SingleNode',
          'name': 'b', 'node': 'b-proc', 'outputs': { 'done': 'join' } },
        { '@id': 'urn:noocodex:dag:diamond-join/node/c', '@type': 'SingleNode',
          'name': 'c', 'node': 'c-proc', 'outputs': { 'done': 'join' } },
        { '@id': 'urn:noocodex:dag:diamond-join/node/join', '@type': 'SingleNode',
          'name': 'join', 'node': 'join', 'outputs': { 'done': 'collect' } },
        { '@id': 'urn:noocodex:dag:diamond-join/node/collect', '@type': 'SingleNode',
          'name': 'collect', 'node': 'acc', 'outputs': { 'done': 'end' } },
        { '@id': 'urn:noocodex:dag:diamond-join/node/end', '@type': 'TerminalNode',
          'name': 'end', 'outcome': 'completed' },
      ],
    };
    dispatcher.registerDAG(dag);

    const result = await dispatcher.execute('diamond-join', new WalkState());
    assert.equal(result.terminalOutcome, 'completed');

    // The critical assertion: join fires exactly ONCE over all 8 items.
    // If rank ordering is wrong (join fires before all feeders drain), it
    // would fire multiple times (once per feeder batch).
    assert.deepEqual(dFirings, [8], 'join must fire exactly once over all 8 items');

    // All 8 items reach the accumulator.
    assert.equal(collected.length, 8);

    // Verify all item counts 0..7 are present.
    const allCounts = collected.map((s) => s.count).sort((a, b) => a - b);
    assert.deepEqual(allCounts, [0, 1, 2, 3, 4, 5, 6, 7]);
  });
});
