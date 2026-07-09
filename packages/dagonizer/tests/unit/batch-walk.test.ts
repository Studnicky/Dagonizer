/**
 * Batch-walk tests: exercises the batch-native work-set scheduler end to end.
 *
 * Uses hand-written `NodeInterface` implementations to drive multi-item batches
 * through the DAG. The `execute()` API starts with a size-1 batch from the
 * provided initial state; multi-item batches are produced when an entry node
 * fans out (returns a RoutedBatchType whose single port holds N items), then flow
 * through subsequent placements until reaching a TerminalNode.
 *
 * Coverage groups:
 *   1. Size-1 parity — linear, branching, EmbeddedDAG, and ScatterNode size-1
 *      paths produce the same executedNodes / outcome as the single-item path.
 *   2. Multi-item plain placements — linear flow, partition branch, diamond join
 *      with rank coalescing.
 *   3. Multi-item composites — EmbeddedDAGNode (uniform + split outcomes) and
 *      ScatterNode (per-parent source isolation) fire batch-native.
 *   4. Cycles / retry loops — self-loop retry, homogeneous and heterogeneous
 *      lockstep, budget exhaustion → salvage, and a back-edge feeding a join.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Dagonizer } from '../../src/Dagonizer.js';
import { Batch } from '../../src/entities/batch/Batch.js';
import type { DAGType } from '../../src/entities/dag/DAG.js';
import type { NodeContextType } from '../../src/entities/node/NodeContext.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';
import { TestBatchNode } from '../_support/TestBatchNode.js';
import { TestDag } from '../_support/TestDag.js';
import { TestNode } from '../_support/TestNode.js';

const placementIri = TestDag.placementIri;
const displayFromIri = (iri: string): string => {
  const hashIndex = iri.lastIndexOf('#');
  if (hashIndex >= 0) return iri.slice(hashIndex + 1);
  const slashIndex = iri.lastIndexOf('/');
  if (slashIndex >= 0) return iri.slice(slashIndex + 1);
  const colonIndex = iri.lastIndexOf(':');
  return colonIndex >= 0 ? iri.slice(colonIndex + 1) : iri;
};

// ===========================================================================
// DAG builder helpers
// ===========================================================================

class PlacementFixture {
  private constructor() {}

  static singleNode(dagIri: string, name: string, node: string, outputs: Record<string, string>): DAGType['nodes'][number] {
    return {
      '@id': placementIri(dagIri, name),
      '@type': 'SingleNode',
      name,
      node,
      outputs,
    };
  }

  static terminalNode(dagIri: string, name: string, outcome: 'completed' | 'failed'): DAGType['nodes'][number] {
    return {
      '@id': placementIri(dagIri, name),
      '@type': 'TerminalNode',
      'name': name,
      outcome,
    };
  }

  static embedNode(
    dagIri: string,
    name: string,
    childDag: string,
    outputs: Record<string, string>,
    stateMapping: { input: Record<string, string>; output: Record<string, string> },
  ): DAGType['nodes'][number] {
    return {
      '@id': placementIri(dagIri, name),
      '@type': 'EmbeddedDAGNode',
      name,
      'dag': childDag,
      outputs,
      'stateMapping': stateMapping,
    };
  }
}

// ===========================================================================
// WalkState — counter + log; drives the plain multi-item walks.
// ===========================================================================

class WalkState extends NodeStateBase {
  count: number;
  log: string[];

  constructor() {
    super();
    this.count = 0;
    this.log = [];
  }

  override clone(): this {
    const copy = super.clone();
    copy.count = this.count;
    copy.log = [...this.log];
    return copy;
  }
}

// ===========================================================================
// WalkState node factories via TestBatchNode
// ===========================================================================

class TestWalkNode {
  private constructor() {}

  /** Fan-out: takes a size-1 batch and emits N items on port 'out'.
   *  Clones state n times, setting count=i and pushing fan:i to log. */
  static fanOut(nodeIri: string, n: number): ReturnType<typeof TestBatchNode.of<WalkState, 'out'>> {
    return TestBatchNode.of<WalkState, 'out'>(nodeIri, ['out'], (batch) => {
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
    });
  }

  /** Partition: splits items across two ports by even/odd count. */
  static partition(nodeIri: string): ReturnType<typeof TestBatchNode.of<WalkState, 'even' | 'odd'>> {
    return TestBatchNode.of<WalkState, 'even' | 'odd'>(nodeIri, ['even', 'odd'], (batch) => {
      const partitioned = batch.partition((s) => s.count % 2 === 0 ? 'even' : 'odd');
      const result = new Map<'even' | 'odd', Batch<WalkState>>();
      for (const [key, b] of partitioned) {
        result.set(key, b);
      }
      return result;
    });
  }

  /** Recording: stamps each item's log and records the batch size on each invocation. */
  static recording(nodeIri: string, firings: number[]): ReturnType<typeof TestBatchNode.of<WalkState, 'done'>> {
    const name = displayFromIri(nodeIri);
    return TestBatchNode.of<WalkState, 'done'>(nodeIri, ['done'], (batch) => {
      firings.push(batch.size);
      const items: Array<{ 'id': string; 'state': WalkState }> = [];
      for (const item of batch) {
        item.state.log.push(`${name}:run`);
        items.push({ 'id': item.id, 'state': item.state });
      }
      const result = new Map<'done', Batch<WalkState>>();
      result.set('done', Batch.from(items));
      return result;
    });
  }

  /** Accumulator: merges all items into an external array and routes them through to 'done'. */
  static accumulator(nodeIri: string, collected: WalkState[]): ReturnType<typeof TestBatchNode.of<WalkState, 'done'>> {
    return TestBatchNode.of<WalkState, 'done'>(nodeIri, ['done'], (batch) => {
      for (const item of batch) {
        collected.push(item.state);
      }
      const result = new Map<'done', Batch<WalkState>>();
      result.set('done', batch);
      return result;
    });
  }
}

// ===========================================================================
// CompositeState — value + log; drives the EmbeddedDAG composite walks.
// ===========================================================================

class CompositeState extends NodeStateBase {
  value: number;
  log: string[];

  constructor() {
    super();
    this.value = 0;
    this.log = [];
  }

  override clone(): this {
    const copy = super.clone();
    copy.value = this.value;
    copy.log = [...this.log];
    return copy;
  }
}

// ===========================================================================
// CompositeState node factories via TestBatchNode
// ===========================================================================

class TestCompositeWalkNode {
  private constructor() {}

  /** Fan-out: takes a size-1 batch and emits N CompositeState items on port 'out'. */
  static fanOut(nodeIri: string, n: number): ReturnType<typeof TestBatchNode.of<CompositeState, 'out'>> {
    return TestBatchNode.of<CompositeState, 'out'>(nodeIri, ['out'], (batch) => {
      const source = batch.row(0).state;
      const items: Array<{ 'id': string; 'state': CompositeState }> = [];
      for (let i = 0; i < n; i++) {
        const clone = source.clone();
        clone.value = i;
        clone.log.push(`fan:${i}`);
        items.push({ 'id': String(i), 'state': clone });
      }
      const result = new Map<'out', Batch<CompositeState>>();
      result.set('out', Batch.from(items));
      return result;
    });
  }

  /** Accumulator: collects all items into an external array and routes to 'done'. */
  static accumulator(nodeIri: string, collected: CompositeState[]): ReturnType<typeof TestBatchNode.of<CompositeState, 'done'>> {
    return TestBatchNode.of<CompositeState, 'done'>(nodeIri, ['done'], (batch) => {
      for (const item of batch) {
        collected.push(item.state);
      }
      const result = new Map<'done', Batch<CompositeState>>();
      result.set('done', batch);
      return result;
    });
  }

  /** Recording: stamps firings array with batch size and passes items through. */
  static recording(nodeIri: string, firings: number[]): ReturnType<typeof TestBatchNode.of<CompositeState, 'done'>> {
    return TestBatchNode.of<CompositeState, 'done'>(nodeIri, ['done'], (batch) => {
      firings.push(batch.size);
      const result = new Map<'done', Batch<CompositeState>>();
      result.set('done', batch);
      return result;
    });
  }
}

// ScatterParentState — source array, gather target, parent id. Drives the
// ScatterNode per-parent isolation walk.
class ScatterParentState extends NodeStateBase {
  /** Source array the scatter fans over. */
  items: number[];
  /** Gather target: scatter appends each raw item value (number) here via append strategy. */
  gathered: number[];
  /** Log stamp set on each parent (fan-out index). */
  parentId: number;

  constructor() {
    super();
    this.items = [];
    this.gathered = [];
    this.parentId = 0;
  }

  override clone(): this {
    const copy = super.clone();
    copy.items = [...this.items];
    copy.gathered = [...this.gathered];
    copy.parentId = this.parentId;
    return copy;
  }
}

// ===========================================================================
// CycleState — retry counter + exit threshold; drives the cycle / retry walks.
//
// `exitAt`   — number of attempts after which this item exits the loop;
//              items with `exitAt = 0` exit on the very first pass.
// `attempts` — how many times this item has been processed by the retry node.
// ===========================================================================

class CycleState extends NodeStateBase {
  exitAt: number;
  attempts: number;

  constructor() {
    super();
    this.exitAt = 0;
    this.attempts = 0;
  }

  override clone(): this {
    const copy = super.clone();
    copy.exitAt = this.exitAt;
    copy.attempts = this.attempts;
    return copy;
  }
}

// ===========================================================================
// CycleState node factories via TestBatchNode
// ===========================================================================

class TestCycleWalkNode {
  private constructor() {}

  /** Fan-out: emits N items where item i receives `exitAt = i`. */
  static fanOut(nodeIri: string, n: number): ReturnType<typeof TestBatchNode.of<CycleState, 'out'>> {
    return TestBatchNode.of<CycleState, 'out'>(nodeIri, ['out'], (batch) => {
      const sourceState = batch.row(0).state;
      const items: Array<{ 'id': string; 'state': CycleState }> = [];
      for (let i = 0; i < n; i++) {
        const clone = sourceState.clone();
        clone.exitAt = i;
        clone.attempts = 0;
        items.push({ 'id': String(i), 'state': clone });
      }
      const result = new Map<'out', Batch<CycleState>>();
      result.set('out', Batch.from(items));
      return result;
    });
  }

  /** Homogeneous fan-out: all N items exit after the same number of attempts. */
  static homogeneousFanOut(nodeIri: string, n: number, exitAt: number): ReturnType<typeof TestBatchNode.of<CycleState, 'out'>> {
    return TestBatchNode.of<CycleState, 'out'>(nodeIri, ['out'], (batch) => {
      const sourceState = batch.row(0).state;
      const items: Array<{ 'id': string; 'state': CycleState }> = [];
      for (let i = 0; i < n; i++) {
        const clone = sourceState.clone();
        clone.exitAt = exitAt;
        clone.attempts = 0;
        items.push({ 'id': String(i), 'state': clone });
      }
      const result = new Map<'out', Batch<CycleState>>();
      result.set('out', Batch.from(items));
      return result;
    });
  }

  /** Retry: increments attempts; routes items whose attempt count reached exitAt to 'done',
   *  others to 'retry'. Hard cap at 50 prevents infinite loops. */
  static retry(nodeIri: string, firings: number[]): ReturnType<typeof TestBatchNode.of<CycleState, 'retry' | 'done'>> {
    return TestBatchNode.of<CycleState, 'retry' | 'done'>(nodeIri, ['retry', 'done'], (batch) => {
      firings.push(batch.size);

      const retryItems: Array<{ 'id': string; 'state': CycleState }> = [];
      const doneItems: Array<{ 'id': string; 'state': CycleState }> = [];

      for (const item of batch) {
        item.state.attempts += 1;
        if (item.state.attempts > 50 || item.state.attempts > item.state.exitAt) {
          doneItems.push({ 'id': item.id, 'state': item.state });
        } else {
          retryItems.push({ 'id': item.id, 'state': item.state });
        }
      }

      const result = new Map<'retry' | 'done', Batch<CycleState>>();
      if (retryItems.length > 0) {
        result.set('retry', Batch.from(retryItems));
      }
      if (doneItems.length > 0) {
        result.set('done', Batch.from(doneItems));
      }
      return result;
    });
  }

  /** Budget-based retry: uses `withinRetryBudget`; routes to 'retry', 'done', or 'salvage'. */
  static budgetRetry(nodeIri: string, maxAttempts: number, firings: number[]): ReturnType<typeof TestBatchNode.of<CycleState, 'retry' | 'done' | 'salvage'>> {
    return TestBatchNode.of<CycleState, 'retry' | 'done' | 'salvage'>(nodeIri, ['retry', 'done', 'salvage'], (batch) => {
      firings.push(batch.size);

      const retryItems: Array<{ 'id': string; 'state': CycleState }> = [];
      const doneItems: Array<{ 'id': string; 'state': CycleState }> = [];
      const salvageItems: Array<{ 'id': string; 'state': CycleState }> = [];

      for (const item of batch) {
        if (item.state.exitAt === 0) {
          item.state.attempts += 1;
          doneItems.push({ 'id': item.id, 'state': item.state });
        } else if (item.state.withinRetryBudget('loop', maxAttempts)) {
          item.state.attempts += 1;
          retryItems.push({ 'id': item.id, 'state': item.state });
        } else {
          item.state.attempts += 1;
          salvageItems.push({ 'id': item.id, 'state': item.state });
        }
      }

      const result = new Map<'retry' | 'done' | 'salvage', Batch<CycleState>>();
      if (retryItems.length > 0) result.set('retry', Batch.from(retryItems));
      if (doneItems.length > 0) result.set('done', Batch.from(doneItems));
      if (salvageItems.length > 0) result.set('salvage', Batch.from(salvageItems));
      return result;
    });
  }

  /** Accumulator: collects all items for post-run inspection. */
  static accumulator(nodeIri: string, collected: CycleState[]): ReturnType<typeof TestBatchNode.of<CycleState, 'done'>> {
    return TestBatchNode.of<CycleState, 'done'>(nodeIri, ['done'], (batch) => {
      for (const item of batch) {
        collected.push(item.state);
      }
      const result = new Map<'done', Batch<CycleState>>();
      result.set('done', batch);
      return result;
    });
  }

  /** Recording: stamps firings array and passes items through. */
  static recording(nodeIri: string, firings: number[]): ReturnType<typeof TestBatchNode.of<CycleState, 'done'>> {
    return TestBatchNode.of<CycleState, 'done'>(nodeIri, ['done'], (batch) => {
      firings.push(batch.size);
      const result = new Map<'done', Batch<CycleState>>();
      result.set('done', batch);
      return result;
    });
  }
}

// ===========================================================================
// Size-1 parity — every placement variant reached by a size-1 batch produces the
// same executedNodes / outcome as the single-item path.
// ===========================================================================

void describe('Batch walk — size-1 parity', () => {
  void it('size-1 linear walk matches expected executedNodes order', async () => {
    const dispatcher = new Dagonizer<NodeStateBase>();
    dispatcher.registerNode(TestNode.make('urn:noocodec:node:step1', ['ok'], () => 'ok'));
    dispatcher.registerNode(TestNode.make('urn:noocodec:node:step2', ['ok'], () => 'ok'));
    dispatcher.registerNode(TestNode.make('urn:noocodec:node:step3', ['ok'], () => 'ok'));

    const dag = TestDag.of('urn:noocodec:dag:parity-linear', placementIri('urn:noocodec:dag:parity-linear', 'p1'), [
        { '@id': 'urn:noocodec:dag:parity-linear/node/p1', '@type': 'SingleNode',
          'name': 'p1', 'node': 'urn:noocodec:node:step1', 'outputs': { 'ok': placementIri('urn:noocodec:dag:parity-linear', 'p2') } },
        { '@id': 'urn:noocodec:dag:parity-linear/node/p2', '@type': 'SingleNode',
          'name': 'p2', 'node': 'urn:noocodec:node:step2', 'outputs': { 'ok': placementIri('urn:noocodec:dag:parity-linear', 'p3') } },
        { '@id': 'urn:noocodec:dag:parity-linear/node/p3', '@type': 'SingleNode',
          'name': 'p3', 'node': 'urn:noocodec:node:step3', 'outputs': { 'ok': placementIri('urn:noocodec:dag:parity-linear', 'end') } },
        { '@id': 'urn:noocodec:dag:parity-linear/node/end', '@type': 'TerminalNode',
          'name': 'end', 'outcome': 'completed' },
      ]);
    dispatcher.registerDAG(dag);

    const result = await dispatcher.execute('urn:noocodec:dag:parity-linear', new NodeStateBase());
    assert.deepEqual(result.executedNodes, ['p1', 'p2', 'p3', 'end']);
    assert.equal(result.terminalOutcome, 'completed');
    assert.equal(result.cursor, null);
  });

  void it('size-1 branching walk routes correctly and tracks executedNodes', async () => {
    const dispatcher = new Dagonizer<NodeStateBase>();
    dispatcher.registerNode(TestNode.make('urn:noocodec:node:classify', ['ok', 'skip'], () => 'ok'));
    dispatcher.registerNode(TestNode.make('urn:noocodec:node:process', ['done'], () => 'done'));

    const dag = TestDag.of('urn:noocodec:dag:parity-branch', placementIri('urn:noocodec:dag:parity-branch', 'cls'), [
        { '@id': 'urn:noocodec:dag:parity-branch/node/cls', '@type': 'SingleNode',
          'name': 'cls', 'node': 'urn:noocodec:node:classify', 'outputs': { 'ok': placementIri('urn:noocodec:dag:parity-branch', 'proc'), 'skip': placementIri('urn:noocodec:dag:parity-branch', 'end') } },
        { '@id': 'urn:noocodec:dag:parity-branch/node/proc', '@type': 'SingleNode',
          'name': 'proc', 'node': 'urn:noocodec:node:process', 'outputs': { 'done': placementIri('urn:noocodec:dag:parity-branch', 'end') } },
        { '@id': 'urn:noocodec:dag:parity-branch/node/end', '@type': 'TerminalNode',
          'name': 'end', 'outcome': 'completed' },
      ]);
    dispatcher.registerDAG(dag);

    const result = await dispatcher.execute('urn:noocodec:dag:parity-branch', new NodeStateBase());
    assert.deepEqual(result.executedNodes, ['cls', 'proc', 'end']);
    assert.equal(result.terminalOutcome, 'completed');
  });

  void it('EmbeddedDAGNode via size-1 batch produces same executedNodes/outcome as direct execute', async () => {
    // Simple child DAG: one transform node → terminal.
    const childDAG = TestDag.of('urn:noocodec:dag:parity-child', placementIri('urn:noocodec:dag:parity-child', 'transform'), [
      PlacementFixture.singleNode('urn:noocodec:dag:parity-child', 'transform', 'urn:noocodec:node:transform-node', { 'ok': placementIri('urn:noocodec:dag:parity-child', 'child-end') }),
      PlacementFixture.terminalNode('urn:noocodec:dag:parity-child', 'child-end', 'completed'),
    ]);

    const valueMapping = { 'input': { 'value': 'value' }, 'output': { 'value': 'value' } } as const;

    // Parent DAG: single entry → embed → terminal.
    const parentDAG = TestDag.of('urn:noocodec:dag:parity-parent', placementIri('urn:noocodec:dag:parity-parent', 'entry'), [
      PlacementFixture.singleNode('urn:noocodec:dag:parity-parent', 'entry', 'urn:noocodec:node:entry-node', { 'ok': placementIri('urn:noocodec:dag:parity-parent', 'embed') }),
      PlacementFixture.embedNode(
        'urn:noocodec:dag:parity-parent',
        'embed',
        'urn:noocodec:dag:parity-child',
        { 'success': placementIri('urn:noocodec:dag:parity-parent', 'parity-end'), 'error': placementIri('urn:noocodec:dag:parity-parent', 'parity-end') },
        valueMapping,
      ),
      PlacementFixture.terminalNode('urn:noocodec:dag:parity-parent', 'parity-end', 'completed'),
    ]);

    const dispatcher = new Dagonizer<CompositeState>();
    dispatcher.registerNode(TestNode.make('urn:noocodec:node:entry-node', ['ok'], () => 'ok'));
    dispatcher.registerNode(TestNode.make('urn:noocodec:node:transform-node', ['ok'], () => 'ok'));
    dispatcher.registerDAG(childDAG);
    dispatcher.registerDAG(parentDAG);

    const initialState = new CompositeState();
    initialState.value = 42;

    const result = await dispatcher.execute('urn:noocodec:dag:parity-parent', initialState);

    // Flow completes cleanly.
    assert.equal(result.terminalOutcome, 'completed');

    // The parent-level executedNodes contains: entry, embed, parity-end.
    // The embed placement itself appears once (it ran via the batch loop).
    assert.ok(result.executedNodes.includes('entry'), 'entry node executed');
    assert.ok(result.executedNodes.includes('embed'), 'embed placement executed');
    assert.ok(result.executedNodes.includes('parity-end'), 'terminal executed');
    assert.equal(result.executedNodes.length, 3, 'exactly 3 parent-level placements executed (entry, embed, terminal)');

    // State value threaded through child DAG (no child transform, value unchanged).
    assert.equal(result.state.value, 42, 'state value preserved through size-1 embed round-trip');
  });

  void it('ScatterNode via size-1 batch (single parent) gathers correctly', async () => {
    // A single parent state with items = [7, 14]; scatter appends to `gathered`.
    const singleParentState = new ScatterParentState();
    singleParentState.parentId = 99;
    singleParentState.items = [7, 14];
    singleParentState.gathered = [];

    const bodyNode = TestBatchNode.of<ScatterParentState, 'success'>(
      'urn:noocodec:node:parity-body',
      ['success'],
      (batch) => {
        const result = new Map<'success', Batch<ScatterParentState>>();
        result.set('success', batch);
        return result;
      },
    );

    const parity1Dag = TestDag.of('urn:noocodec:dag:parity-scatter-1', placementIri('urn:noocodec:dag:parity-scatter-1', 'parity-scatter'), [
      {
        '@id': 'urn:noocodec:dag:parity-scatter-1/node/parity-scatter',
        '@type': 'ScatterNode',
        'name': 'parity-scatter',
        'body': { 'node': 'urn:noocodec:node:parity-body' },
        'source': 'items',
        'itemKey': 'currentItem',
        'outputs': {
          'all-success': placementIri('urn:noocodec:dag:parity-scatter-1', 'parity-scatter-join'),
          'partial': placementIri('urn:noocodec:dag:parity-scatter-1', 'parity-scatter-join'),
          'all-error': placementIri('urn:noocodec:dag:parity-scatter-1', 'parity-scatter-join'),
          'empty': placementIri('urn:noocodec:dag:parity-scatter-1', 'parity-scatter-end'),
        },
      },
      {
        '@id': 'urn:noocodec:dag:parity-scatter-1/node/parity-scatter-join',
        '@type': 'GatherNode',
        'name': 'parity-scatter-join',
        'sources': { [placementIri('urn:noocodec:dag:parity-scatter-1', 'parity-scatter')]: {} },
        'gather': { 'strategy': 'append', 'target': 'gathered' },
        'outputs': {
          'success': placementIri('urn:noocodec:dag:parity-scatter-1', 'parity-scatter-end'),
          'error': placementIri('urn:noocodec:dag:parity-scatter-1', 'parity-scatter-end'),
          'empty': placementIri('urn:noocodec:dag:parity-scatter-1', 'parity-scatter-end'),
        },
      },
      PlacementFixture.terminalNode('urn:noocodec:dag:parity-scatter-1', 'parity-scatter-end', 'completed'),
    ]);

    const dispatcher = new Dagonizer<ScatterParentState>();
    dispatcher.registerNode(bodyNode);
    dispatcher.registerDAG(parity1Dag);

    const result = await dispatcher.execute('urn:noocodec:dag:parity-scatter-1', singleParentState);

    assert.equal(result.terminalOutcome, 'completed');
    // Scatter gathered both items into `gathered` (append strategy appends raw number values).
    assert.equal(result.state.gathered.length, 2, 'size-1 scatter gathered both source items');
    assert.deepEqual([...result.state.gathered].sort((a, b) => Number(a) - Number(b)), [7, 14], 'correct items gathered');
  });
});

// ===========================================================================
// Multi-item plain placements — linear flow, partition branch, diamond join.
// ===========================================================================

void describe('Batch walk — multi-item plain placements', () => {
  void it('N items flow fan→recorder→accumulator→end; recorder fires once over all N', async () => {
    const dispatcher = new Dagonizer<WalkState>();
    const bFirings: number[] = [];

    dispatcher.registerNode(TestWalkNode.fanOut('urn:noocodec:node:fanout', 4));
    dispatcher.registerNode(TestWalkNode.recording('urn:noocodec:node:recorder', bFirings));

    const collected: WalkState[] = [];
    dispatcher.registerNode(TestWalkNode.accumulator('urn:noocodec:node:acc', collected));

    const dag = TestDag.of('urn:noocodec:dag:linear-multi', placementIri('urn:noocodec:dag:linear-multi', 'fan'), [
        { '@id': 'urn:noocodec:dag:linear-multi/node/fan', '@type': 'SingleNode',
          'name': 'fan', 'node': 'urn:noocodec:node:fanout', 'outputs': { 'out': placementIri('urn:noocodec:dag:linear-multi', 'rec') } },
        { '@id': 'urn:noocodec:dag:linear-multi/node/rec', '@type': 'SingleNode',
          'name': 'rec', 'node': 'urn:noocodec:node:recorder', 'outputs': { 'done': placementIri('urn:noocodec:dag:linear-multi', 'collect') } },
        { '@id': 'urn:noocodec:dag:linear-multi/node/collect', '@type': 'SingleNode',
          'name': 'collect', 'node': 'urn:noocodec:node:acc', 'outputs': { 'done': placementIri('urn:noocodec:dag:linear-multi', 'end') } },
        { '@id': 'urn:noocodec:dag:linear-multi/node/end', '@type': 'TerminalNode',
          'name': 'end', 'outcome': 'completed' },
      ]);
    dispatcher.registerDAG(dag);

    const result = await dispatcher.execute('urn:noocodec:dag:linear-multi', new WalkState());
    assert.equal(result.terminalOutcome, 'completed');
    // recorder fired exactly once over all 4 items.
    assert.deepEqual(bFirings, [4]);
    // All 4 items reached the accumulator.
    assert.equal(collected.length, 4);
    // Each item has the recorder log entry.
    for (const s of collected) {
      assert.ok(s.log.includes('recorder:run'));
    }
  });

  void it('partition node splits N items across two ports, each port fires once downstream', async () => {
    const dispatcher = new Dagonizer<WalkState>();
    // Items 0..5; even: 0, 2, 4 (3 items); odd: 1, 3, 5 (3 items).
    dispatcher.registerNode(TestWalkNode.fanOut('urn:noocodec:node:fanout', 6));
    dispatcher.registerNode(TestWalkNode.partition('urn:noocodec:node:part'));

    const evenFirings: number[] = [];
    const oddFirings: number[] = [];
    const evenCollected: WalkState[] = [];
    const oddCollected: WalkState[] = [];

    dispatcher.registerNode(TestWalkNode.recording('urn:noocodec:node:even-proc', evenFirings));
    dispatcher.registerNode(TestWalkNode.recording('urn:noocodec:node:odd-proc', oddFirings));
    dispatcher.registerNode(TestWalkNode.accumulator('urn:noocodec:node:even-acc', evenCollected));
    dispatcher.registerNode(TestWalkNode.accumulator('urn:noocodec:node:odd-acc', oddCollected));

    const dag = TestDag.of('urn:noocodec:dag:branch-multi', placementIri('urn:noocodec:dag:branch-multi', 'fan'), [
        { '@id': 'urn:noocodec:dag:branch-multi/node/fan', '@type': 'SingleNode',
          'name': 'fan', 'node': 'urn:noocodec:node:fanout', 'outputs': { 'out': placementIri('urn:noocodec:dag:branch-multi', 'partition') } },
        { '@id': 'urn:noocodec:dag:branch-multi/node/partition', '@type': 'SingleNode',
          'name': 'partition', 'node': 'urn:noocodec:node:part', 'outputs': { 'even': placementIri('urn:noocodec:dag:branch-multi', 'even-step'), 'odd': placementIri('urn:noocodec:dag:branch-multi', 'odd-step') } },
        { '@id': 'urn:noocodec:dag:branch-multi/node/even-step', '@type': 'SingleNode',
          'name': 'even-step', 'node': 'urn:noocodec:node:even-proc', 'outputs': { 'done': placementIri('urn:noocodec:dag:branch-multi', 'even-collect') } },
        { '@id': 'urn:noocodec:dag:branch-multi/node/odd-step', '@type': 'SingleNode',
          'name': 'odd-step', 'node': 'urn:noocodec:node:odd-proc', 'outputs': { 'done': placementIri('urn:noocodec:dag:branch-multi', 'odd-collect') } },
        { '@id': 'urn:noocodec:dag:branch-multi/node/even-collect', '@type': 'SingleNode',
          'name': 'even-collect', 'node': 'urn:noocodec:node:even-acc', 'outputs': { 'done': placementIri('urn:noocodec:dag:branch-multi', 'end') } },
        { '@id': 'urn:noocodec:dag:branch-multi/node/odd-collect', '@type': 'SingleNode',
          'name': 'odd-collect', 'node': 'urn:noocodec:node:odd-acc', 'outputs': { 'done': placementIri('urn:noocodec:dag:branch-multi', 'end') } },
        { '@id': 'urn:noocodec:dag:branch-multi/node/end', '@type': 'TerminalNode',
          'name': 'end', 'outcome': 'completed' },
      ]);
    dispatcher.registerDAG(dag);

    const result = await dispatcher.execute('urn:noocodec:dag:branch-multi', new WalkState());
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

  void it('diamond join (D) fires exactly once over the merged batch from B and C', async () => {
    // Shape: fan(1→N) → partitioner → B(even), C(odd) → join → end
    // D must fire exactly once over ALL N items combined.
    const dispatcher = new Dagonizer<WalkState>();
    const dFirings: number[] = [];
    const collected: WalkState[] = [];

    dispatcher.registerNode(TestWalkNode.fanOut('urn:noocodec:node:fanout', 8)); // 8 items: 0..7
    dispatcher.registerNode(TestWalkNode.partition('urn:noocodec:node:part'));
    dispatcher.registerNode(TestWalkNode.recording('urn:noocodec:node:b-proc', []));  // even branch
    dispatcher.registerNode(TestWalkNode.recording('urn:noocodec:node:c-proc', []));  // odd branch
    dispatcher.registerNode(TestWalkNode.recording('urn:noocodec:node:join', dFirings));  // THE JOIN
    dispatcher.registerNode(TestWalkNode.accumulator('urn:noocodec:node:acc', collected));

    const dag = TestDag.of('urn:noocodec:dag:diamond-join', placementIri('urn:noocodec:dag:diamond-join', 'fan'), [
        { '@id': 'urn:noocodec:dag:diamond-join/node/fan', '@type': 'SingleNode',
          'name': 'fan', 'node': 'urn:noocodec:node:fanout', 'outputs': { 'out': placementIri('urn:noocodec:dag:diamond-join', 'partition') } },
        { '@id': 'urn:noocodec:dag:diamond-join/node/partition', '@type': 'SingleNode',
          'name': 'partition', 'node': 'urn:noocodec:node:part', 'outputs': { 'even': placementIri('urn:noocodec:dag:diamond-join', 'b'), 'odd': placementIri('urn:noocodec:dag:diamond-join', 'c') } },
        { '@id': 'urn:noocodec:dag:diamond-join/node/b', '@type': 'SingleNode',
          'name': 'b', 'node': 'urn:noocodec:node:b-proc', 'outputs': { 'done': placementIri('urn:noocodec:dag:diamond-join', 'join') } },
        { '@id': 'urn:noocodec:dag:diamond-join/node/c', '@type': 'SingleNode',
          'name': 'c', 'node': 'urn:noocodec:node:c-proc', 'outputs': { 'done': placementIri('urn:noocodec:dag:diamond-join', 'join') } },
        { '@id': 'urn:noocodec:dag:diamond-join/node/join', '@type': 'SingleNode',
          'name': 'join', 'node': 'urn:noocodec:node:join', 'outputs': { 'done': placementIri('urn:noocodec:dag:diamond-join', 'collect') } },
        { '@id': 'urn:noocodec:dag:diamond-join/node/collect', '@type': 'SingleNode',
          'name': 'collect', 'node': 'urn:noocodec:node:acc', 'outputs': { 'done': placementIri('urn:noocodec:dag:diamond-join', 'end') } },
        { '@id': 'urn:noocodec:dag:diamond-join/node/end', '@type': 'TerminalNode',
          'name': 'end', 'outcome': 'completed' },
      ]);
    dispatcher.registerDAG(dag);

    const result = await dispatcher.execute('urn:noocodec:dag:diamond-join', new WalkState());
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

// ===========================================================================
// Multi-item composites — EmbeddedDAGNode and ScatterNode placements fire
// batch-native when reached by a multi-item batch. The engine threads each
// item through the composite's per-item logic, then routes each item's outcome
// into the WorkSet's downstream entries; downstream placements receive the
// coalesced batch and fire once over all N items.
// ===========================================================================

void describe('Batch walk — multi-item composites', () => {
  void it('EmbeddedDAG uniform outcome: N items thread through child; downstream fires once over all N', async () => {
    // Fan-out produces N=4 items (values 0,1,2,3) → EmbeddedDAGNode placement.
    // The child DAG increments `value` by 10, exits via `success`. All N items
    // converge at the same downstream terminal. The child's increment node
    // records how many items it sees.
    const childItemsSeen: number[] = [];

    const childIncrNode = TestBatchNode.of<CompositeState, 'done'>(
      'urn:noocodec:node:child-incr',
      ['done'],
      (batch) => {
        for (const item of batch) {
          childItemsSeen.push(item.state.value);
          item.state.value += 10;
          item.state.log.push(`child-incr:${item.state.value}`);
        }
        const result = new Map<'done', Batch<CompositeState>>();
        result.set('done', batch);
        return result;
      },
    );

    // Child DAG: child-incr → child-end (success terminal).
    const childDAG = TestDag.of('urn:noocodec:dag:embed-uniform-child', placementIri('urn:noocodec:dag:embed-uniform-child', 'child-incr'), [
      PlacementFixture.singleNode('urn:noocodec:dag:embed-uniform-child', 'child-incr', 'urn:noocodec:node:child-incr', { 'done': placementIri('urn:noocodec:dag:embed-uniform-child', 'child-end') }),
      PlacementFixture.terminalNode('urn:noocodec:dag:embed-uniform-child', 'child-end', 'completed'),
    ]);

    // Value mapping: parent `value` → child `value`; child `value` → parent `value`.
    const valueMapping = { 'input': { 'value': 'value' }, 'output': { 'value': 'value' } } as const;

    // Parent DAG: fan → embed-placement → downstream-acc → parent-end.
    const downstreamCollected: CompositeState[] = [];
    const downstreamFirings: number[] = [];

    const parentDAG = TestDag.of('urn:noocodec:dag:embed-uniform-parent', placementIri('urn:noocodec:dag:embed-uniform-parent', 'fan'), [
      {
        '@id': 'urn:noocodec:dag:embed-uniform-parent/node/fan',
        '@type': 'SingleNode',
        'name': 'fan',
        'node': 'urn:noocodec:node:fan4',
        'outputs': { 'out': placementIri('urn:noocodec:dag:embed-uniform-parent', 'embed') },
      },
      PlacementFixture.embedNode(
        'urn:noocodec:dag:embed-uniform-parent',
        'embed',
        'urn:noocodec:dag:embed-uniform-child',
        { 'success': placementIri('urn:noocodec:dag:embed-uniform-parent', 'downstream'), 'error': placementIri('urn:noocodec:dag:embed-uniform-parent', 'parent-end') },
        valueMapping,
      ),
      PlacementFixture.singleNode('urn:noocodec:dag:embed-uniform-parent', 'downstream', 'urn:noocodec:node:downstream-rec', { 'done': placementIri('urn:noocodec:dag:embed-uniform-parent', 'acc') }),
      PlacementFixture.singleNode('urn:noocodec:dag:embed-uniform-parent', 'acc', 'urn:noocodec:node:acc-node', { 'done': placementIri('urn:noocodec:dag:embed-uniform-parent', 'parent-end') }),
      PlacementFixture.terminalNode('urn:noocodec:dag:embed-uniform-parent', 'parent-end', 'completed'),
    ]);

    const dispatcher = new Dagonizer<CompositeState>();
    dispatcher.registerNode(TestCompositeWalkNode.fanOut('urn:noocodec:node:fan4', 4));
    dispatcher.registerNode(childIncrNode);
    dispatcher.registerNode(TestCompositeWalkNode.recording('urn:noocodec:node:downstream-rec', downstreamFirings));
    dispatcher.registerNode(TestCompositeWalkNode.accumulator('urn:noocodec:node:acc-node', downstreamCollected));
    dispatcher.registerDAG(childDAG);
    dispatcher.registerDAG(parentDAG);

    const result = await dispatcher.execute('urn:noocodec:dag:embed-uniform-parent', new CompositeState());

    assert.equal(result.terminalOutcome, 'completed');

    // Child increment node was invoked once per item (each via executeEmbeddedDAG),
    // receiving each item's distinct value (0, 1, 2, 3).
    assert.equal(childItemsSeen.length, 4, 'child incr node ran exactly once per parent item');
    const sortedSeen = [...childItemsSeen].sort((a, b) => a - b);
    assert.deepEqual(sortedSeen, [0, 1, 2, 3], 'child incr received each parent item value');

    // All N items routed to 'success' and converged at the downstream placement.
    // The downstream node fires exactly once over all 4 items.
    assert.deepEqual(downstreamFirings, [4], 'downstream fires once over all N items after embed');

    // All 4 items reach the accumulator.
    assert.equal(downstreamCollected.length, 4, 'all N items reach the downstream accumulator');

    // Each item's value is incremented by 10 (child transform applied per item).
    const values = downstreamCollected.map((s) => s.value).sort((a, b) => a - b);
    assert.deepEqual(values, [10, 11, 12, 13], 'each item value incremented by child DAG');
  });

  void it('EmbeddedDAG split outcomes: items partition across two downstream terminals by sub-DAG route', async () => {
    // Fan-out produces N=6 items (values 0..5) → EmbeddedDAGNode placement.
    // Child DAG routes even values → 'done-even' terminal (→ 'success' output),
    // odd values → 'done-odd' terminal (→ 'error' output, mapped via outputs).
    // EmbeddedDAGNode.outputs: success → 'even-acc', error → 'odd-acc'.

    // Child routing node: even value → 'success', odd value → 'failure'.
    const childRouterNode = TestBatchNode.of<CompositeState, 'success' | 'failure'>(
      'urn:noocodec:node:child-router',
      ['success', 'failure'],
      (batch) => {
        const even: Array<{ 'id': string; 'state': CompositeState }> = [];
        const odd: Array<{ 'id': string; 'state': CompositeState }> = [];
        for (const item of batch) {
          if (item.state.value % 2 === 0) {
            even.push({ 'id': item.id, 'state': item.state });
          } else {
            odd.push({ 'id': item.id, 'state': item.state });
          }
        }
        const result = new Map<'success' | 'failure', Batch<CompositeState>>();
        if (even.length > 0) result.set('success', Batch.from(even));
        if (odd.length > 0) result.set('failure', Batch.from(odd));
        return result;
      },
    );

    // Child DAG: router → success-terminal or failure-terminal.
    // success terminal outcome = 'completed', failure terminal outcome = 'failed'.
    // The engine maps 'completed' → 'success' output, 'failed' → 'error' output.
    const childDAG = TestDag.of('urn:noocodec:dag:embed-split-child', placementIri('urn:noocodec:dag:embed-split-child', 'child-router'), [
      {
        '@id': 'urn:noocodec:dag:embed-split-child/node/child-router',
        '@type': 'SingleNode',
        'name': 'urn:noocodec:node:child-router',
        'node': 'urn:noocodec:node:child-router',
        'outputs': {
          'success': placementIri('urn:noocodec:dag:embed-split-child', 'child-success-end'),
          'failure': placementIri('urn:noocodec:dag:embed-split-child', 'child-fail-end'),
        },
      },
      PlacementFixture.terminalNode('urn:noocodec:dag:embed-split-child', 'child-success-end', 'completed'),
      PlacementFixture.terminalNode('urn:noocodec:dag:embed-split-child', 'child-fail-end', 'failed'),
    ]);

    // Parent DAG: fan → embed → split to even-acc (success) or odd-acc (error).
    const evenCollected: CompositeState[] = [];
    const oddCollected: CompositeState[] = [];

    const valueMapping = { 'input': { 'value': 'value' }, 'output': { 'value': 'value' } } as const;

    const parentDAG = TestDag.of('urn:noocodec:dag:embed-split-parent', placementIri('urn:noocodec:dag:embed-split-parent', 'fan'), [
      {
        '@id': 'urn:noocodec:dag:embed-split-parent/node/fan',
        '@type': 'SingleNode',
        'name': 'fan',
        'node': 'urn:noocodec:node:fan6',
        'outputs': { 'out': placementIri('urn:noocodec:dag:embed-split-parent', 'embed') },
      },
      PlacementFixture.embedNode(
        'urn:noocodec:dag:embed-split-parent',
        'embed',
        'urn:noocodec:dag:embed-split-child',
        { 'success': placementIri('urn:noocodec:dag:embed-split-parent', 'even-acc'), 'error': placementIri('urn:noocodec:dag:embed-split-parent', 'odd-acc') },
        valueMapping,
      ),
      PlacementFixture.singleNode('urn:noocodec:dag:embed-split-parent', 'even-acc', 'urn:noocodec:node:even-collector', { 'done': placementIri('urn:noocodec:dag:embed-split-parent', 'parent-end') }),
      PlacementFixture.singleNode('urn:noocodec:dag:embed-split-parent', 'odd-acc', 'urn:noocodec:node:odd-collector', { 'done': placementIri('urn:noocodec:dag:embed-split-parent', 'parent-end') }),
      PlacementFixture.terminalNode('urn:noocodec:dag:embed-split-parent', 'parent-end', 'completed'),
    ]);

    const dispatcher = new Dagonizer<CompositeState>();
    dispatcher.registerNode(TestCompositeWalkNode.fanOut('urn:noocodec:node:fan6', 6));
    dispatcher.registerNode(childRouterNode);
    dispatcher.registerNode(TestCompositeWalkNode.accumulator('urn:noocodec:node:even-collector', evenCollected));
    dispatcher.registerNode(TestCompositeWalkNode.accumulator('urn:noocodec:node:odd-collector', oddCollected));
    dispatcher.registerDAG(childDAG);
    dispatcher.registerDAG(parentDAG);

    const result = await dispatcher.execute('urn:noocodec:dag:embed-split-parent', new CompositeState());

    assert.equal(result.terminalOutcome, 'completed');

    // Even values (0, 2, 4) route via success → even-acc.
    assert.equal(evenCollected.length, 3, 'exactly 3 even items reach even-acc');
    const evenValues = evenCollected.map((s) => s.value).sort((a, b) => a - b);
    assert.deepEqual(evenValues, [0, 2, 4], 'even items carry correct values');

    // Odd values (1, 3, 5) route via error → odd-acc.
    assert.equal(oddCollected.length, 3, 'exactly 3 odd items reach odd-acc');
    const oddValues = oddCollected.map((s) => s.value).sort((a, b) => a - b);
    assert.deepEqual(oddValues, [1, 3, 5], 'odd items carry correct values');
  });

  void it('ScatterNode per-parent source isolation: each parent scatters its own source; no cross-parent mixing in gather', async () => {
    // Fan-out produces N=3 parent states, each carrying a distinct `items` array:
    //   parent 0: items = [0]          (1 item)
    //   parent 1: items = [0, 1]       (2 items)
    //   parent 2: items = [0, 1, 2]    (3 items)
    // Each parent goes through a ScatterNode (node body, append gather into
    // `gathered`). The gather result for each parent must reflect only that
    // parent's source, proving no cross-parent mixing.
    const fanOutNode = TestBatchNode.of<ScatterParentState, 'out'>(
      'urn:noocodec:node:parent-fan',
      ['out'],
      (batch) => {
        const source = batch.row(0).state;
        const items: Array<{ 'id': string; 'state': ScatterParentState }> = [];
        for (let i = 0; i < 3; i++) {
          const clone = source.clone();
          clone.parentId = i;
          // Parent i has i+1 items: [0, 1, ..., i].
          clone.items = Array.from({ 'length': i + 1 }, (_, k) => k);
          clone.gathered = [];
          items.push({ 'id': String(i), 'state': clone });
        }
        const result = new Map<'out', Batch<ScatterParentState>>();
        result.set('out', Batch.from(items));
        return result;
      },
    );

    // Body node: runs once per scatter item; the append gather strategy (target:
    // `gathered`, itemKey: 'currentItem') reads the clone's currentItem metadata
    // and appends it to the parent's `gathered` array. The body node itself does
    // nothing to `gathered` — that is the gather strategy's job.
    const scatterBodyNode = TestBatchNode.of<ScatterParentState, 'success'>(
      'urn:noocodec:node:scatter-body',
      ['success'],
      (batch) => {
        const result = new Map<'success', Batch<ScatterParentState>>();
        result.set('success', batch);
        return result;
      },
    );

    // Downstream accumulator collects all parent states after scatter+gather.
    const downstreamCollected: ScatterParentState[] = [];
    const downstreamNode = TestBatchNode.of<ScatterParentState, 'done'>(
      'urn:noocodec:node:downstream',
      ['done'],
      (batch) => {
        for (const item of batch) {
          downstreamCollected.push(item.state);
        }
        const result = new Map<'done', Batch<ScatterParentState>>();
        result.set('done', batch);
        return result;
      },
    );

    const dag = TestDag.of('urn:noocodec:dag:scatter-per-parent', placementIri('urn:noocodec:dag:scatter-per-parent', 'fan'), [
      {
        '@id': 'urn:noocodec:dag:scatter-per-parent/node/fan',
        '@type': 'SingleNode',
        'name': 'fan',
        'node': 'urn:noocodec:node:parent-fan',
        'outputs': { 'out': placementIri('urn:noocodec:dag:scatter-per-parent', 'scatter') },
      },
      {
        '@id': 'urn:noocodec:dag:scatter-per-parent/node/scatter',
        '@type': 'ScatterNode',
        'name': 'scatter',
        'body': { 'node': 'urn:noocodec:node:scatter-body' },
        'source': 'items',
        'itemKey': 'currentItem',
        'outputs': {
          'all-success': placementIri('urn:noocodec:dag:scatter-per-parent', 'join'),
          'partial': placementIri('urn:noocodec:dag:scatter-per-parent', 'join'),
          'all-error': placementIri('urn:noocodec:dag:scatter-per-parent', 'join'),
          'empty': placementIri('urn:noocodec:dag:scatter-per-parent', 'downstream'),
        },
      },
      {
        '@id': 'urn:noocodec:dag:scatter-per-parent/node/join',
        '@type': 'GatherNode',
        'name': 'join',
        'sources': { [placementIri('urn:noocodec:dag:scatter-per-parent', 'scatter')]: {} },
        'gather': { 'strategy': 'append', 'target': 'gathered' },
        'outputs': {
          'success': placementIri('urn:noocodec:dag:scatter-per-parent', 'downstream'),
          'error': placementIri('urn:noocodec:dag:scatter-per-parent', 'downstream'),
          'empty': placementIri('urn:noocodec:dag:scatter-per-parent', 'downstream'),
        },
      },
      PlacementFixture.singleNode('urn:noocodec:dag:scatter-per-parent', 'downstream', 'urn:noocodec:node:downstream', { 'done': placementIri('urn:noocodec:dag:scatter-per-parent', 'end') }),
      PlacementFixture.terminalNode('urn:noocodec:dag:scatter-per-parent', 'end', 'completed'),
    ]);

    const dispatcher = new Dagonizer<ScatterParentState>();
    dispatcher.registerNode(fanOutNode);
    dispatcher.registerNode(scatterBodyNode);
    dispatcher.registerNode(downstreamNode);
    dispatcher.registerDAG(dag);

    const result = await dispatcher.execute('urn:noocodec:dag:scatter-per-parent', new ScatterParentState());

    assert.equal(result.terminalOutcome, 'completed');

    // All 3 parent states reach the downstream node.
    assert.equal(downstreamCollected.length, 3, 'all 3 parent states reach downstream');

    // Sort collected states by parentId to compare deterministically.
    const sorted = [...downstreamCollected].sort((a, b) => a.parentId - b.parentId);

    // Parent 0: 1 item (value 0) → gathered = [0].
    const p0 = sorted[0];
    assert.ok(p0 !== undefined, 'parent 0 present');
    assert.equal(p0.parentId, 0, 'parent 0 id correct');
    assert.equal(p0.gathered.length, 1, 'parent 0 gathered 1 item');
    assert.deepEqual([...p0.gathered].sort((a, b) => a - b), [0], 'parent 0 gather contains item 0');

    // Parent 1: 2 items (values 0, 1) → gathered = [0, 1].
    const p1 = sorted[1];
    assert.ok(p1 !== undefined, 'parent 1 present');
    assert.equal(p1.parentId, 1, 'parent 1 id correct');
    assert.equal(p1.gathered.length, 2, 'parent 1 gathered 2 items');
    assert.deepEqual([...p1.gathered].sort((a, b) => a - b), [0, 1], 'parent 1 gather contains items 0 and 1');

    // Parent 2: 3 items (values 0, 1, 2) → gathered = [0, 1, 2].
    const p2 = sorted[2];
    assert.ok(p2 !== undefined, 'parent 2 present');
    assert.equal(p2.parentId, 2, 'parent 2 id correct');
    assert.equal(p2.gathered.length, 3, 'parent 2 gathered 3 items');
    assert.deepEqual([...p2.gathered].sort((a, b) => a - b), [0, 1, 2], 'parent 2 gather contains items 0, 1, and 2');
  });
});

// ===========================================================================
// Cycles / retry loops — the work-set scheduler handles retry by routing a
// back-edge output to an earlier (or self) placement. Items re-enter that
// placement's pending work and re-batch with any other items waiting there.
// Each pass reduces the batch until all items exit the loop.
// ===========================================================================

void describe('Batch walk — cycles and retry loops', () => {
  void it('size-1 self-loop retry: single item retries exactly exitAt times then reaches terminal', async () => {
    // exitAt=3: item exits on the 4th pass (attempts goes 1→2→3→4, but the
    // node routes to `done` when `attempts > exitAt`, i.e. on attempt 4).
    const dispatcher = new Dagonizer<CycleState>();
    const firings: number[] = [];

    dispatcher.registerNode(TestCycleWalkNode.retry('urn:noocodec:node:retrier', firings));
    const collected: CycleState[] = [];
    dispatcher.registerNode(TestCycleWalkNode.accumulator('urn:noocodec:node:acc', collected));

    const dag = TestDag.of('urn:noocodec:dag:cycle-size1', placementIri('urn:noocodec:dag:cycle-size1', 'a'), [
        {
          '@id': 'urn:noocodec:dag:cycle-size1/node/a',
          '@type': 'SingleNode',
          'name': 'a',
          'node': 'urn:noocodec:node:retrier',
          'outputs': { 'retry': placementIri('urn:noocodec:dag:cycle-size1', 'a'), 'done': placementIri('urn:noocodec:dag:cycle-size1', 'collect') },
        },
        {
          '@id': 'urn:noocodec:dag:cycle-size1/node/collect',
          '@type': 'SingleNode',
          'name': 'collect',
          'node': 'urn:noocodec:node:acc',
          'outputs': { 'done': placementIri('urn:noocodec:dag:cycle-size1', 'end') },
        },
        {
          '@id': 'urn:noocodec:dag:cycle-size1/node/end',
          '@type': 'TerminalNode',
          'name': 'end',
          'outcome': 'completed',
        },
      ]);
    dispatcher.registerDAG(dag);

    const input = new CycleState();
    input.exitAt = 3; // exits after attempt 4 (attempts 1,2,3 loop; attempt 4 exits)

    const result = await dispatcher.execute('urn:noocodec:dag:cycle-size1', input);

    assert.equal(result.terminalOutcome, 'completed');
    assert.equal(result.state.lifecycle.variant, 'completed');
    assert.equal(result.cursor, null);

    // Node 'a' fires 4 times: attempts 1,2,3 route to `retry`, attempt 4 routes to `done`.
    assert.deepEqual(firings, [1, 1, 1, 1], 'retrier fires once per item per round');

    // executedNodes: a,a,a,a,collect,end
    assert.deepEqual(result.executedNodes, ['a', 'a', 'a', 'a', 'collect', 'end']);

    // One item reaches the accumulator with attempts=4.
    assert.equal(collected.length, 1);
    assert.equal(collected[0]?.attempts, 4);
  });

  void it('size-1 immediate exit (exitAt=0) reaches terminal in a single pass', async () => {
    const dispatcher = new Dagonizer<CycleState>();
    const firings: number[] = [];

    dispatcher.registerNode(TestCycleWalkNode.retry('urn:noocodec:node:retrier', firings));
    const collected: CycleState[] = [];
    dispatcher.registerNode(TestCycleWalkNode.accumulator('urn:noocodec:node:acc', collected));

    const dag = TestDag.of('urn:noocodec:dag:cycle-immediate', placementIri('urn:noocodec:dag:cycle-immediate', 'a'), [
        {
          '@id': 'urn:noocodec:dag:cycle-immediate/node/a',
          '@type': 'SingleNode',
          'name': 'a',
          'node': 'urn:noocodec:node:retrier',
          'outputs': { 'retry': placementIri('urn:noocodec:dag:cycle-immediate', 'a'), 'done': placementIri('urn:noocodec:dag:cycle-immediate', 'collect') },
        },
        {
          '@id': 'urn:noocodec:dag:cycle-immediate/node/collect',
          '@type': 'SingleNode',
          'name': 'collect',
          'node': 'urn:noocodec:node:acc',
          'outputs': { 'done': placementIri('urn:noocodec:dag:cycle-immediate', 'end') },
        },
        {
          '@id': 'urn:noocodec:dag:cycle-immediate/node/end',
          '@type': 'TerminalNode',
          'name': 'end',
          'outcome': 'completed',
        },
      ]);
    dispatcher.registerDAG(dag);

    const input = new CycleState();
    input.exitAt = 0; // attempts becomes 1 which is > 0 → immediate exit

    const result = await dispatcher.execute('urn:noocodec:dag:cycle-immediate', input);

    assert.equal(result.terminalOutcome, 'completed');
    assert.deepEqual(result.executedNodes, ['a', 'collect', 'end']);
    assert.deepEqual(firings, [1]);
    assert.equal(collected.length, 1);
    assert.equal(collected[0]?.attempts, 1);
  });

  void it('multi-item homogeneous self-loop: N identical items all retry in lockstep; retrier fires once per round', async () => {
    // 4 items all with exitAt=2: exit after attempt 3 (attempts 1,2 loop; 3 exits).
    const dispatcher = new Dagonizer<CycleState>();
    const firings: number[] = [];

    dispatcher.registerNode(TestCycleWalkNode.homogeneousFanOut('urn:noocodec:node:fan', 4, 2));
    dispatcher.registerNode(TestCycleWalkNode.retry('urn:noocodec:node:retrier', firings));
    const collected: CycleState[] = [];
    dispatcher.registerNode(TestCycleWalkNode.accumulator('urn:noocodec:node:acc', collected));

    const dag = TestDag.of('urn:noocodec:dag:cycle-homogeneous', placementIri('urn:noocodec:dag:cycle-homogeneous', 'fan'), [
        {
          '@id': 'urn:noocodec:dag:cycle-homogeneous/node/fan',
          '@type': 'SingleNode',
          'name': 'fan',
          'node': 'urn:noocodec:node:fan',
          'outputs': { 'out': placementIri('urn:noocodec:dag:cycle-homogeneous', 'a') },
        },
        {
          '@id': 'urn:noocodec:dag:cycle-homogeneous/node/a',
          '@type': 'SingleNode',
          'name': 'a',
          'node': 'urn:noocodec:node:retrier',
          'outputs': { 'retry': placementIri('urn:noocodec:dag:cycle-homogeneous', 'a'), 'done': placementIri('urn:noocodec:dag:cycle-homogeneous', 'collect') },
        },
        {
          '@id': 'urn:noocodec:dag:cycle-homogeneous/node/collect',
          '@type': 'SingleNode',
          'name': 'collect',
          'node': 'urn:noocodec:node:acc',
          'outputs': { 'done': placementIri('urn:noocodec:dag:cycle-homogeneous', 'end') },
        },
        {
          '@id': 'urn:noocodec:dag:cycle-homogeneous/node/end',
          '@type': 'TerminalNode',
          'name': 'end',
          'outcome': 'completed',
        },
      ]);
    dispatcher.registerDAG(dag);

    const result = await dispatcher.execute('urn:noocodec:dag:cycle-homogeneous', new CycleState());

    assert.equal(result.terminalOutcome, 'completed');

    // Round 1: all 4 loop. Round 2: all 4 loop. Round 3: all 4 exit.
    assert.deepEqual(firings, [4, 4, 4], 'retrier fires once per round over the full N-item batch');

    // executedNodes: fan, a,a,a, collect, end
    assert.deepEqual(result.executedNodes, ['fan', 'a', 'a', 'a', 'collect', 'end']);

    // All 4 items reach the accumulator with attempts=3.
    assert.equal(collected.length, 4);
    for (const s of collected) {
      assert.equal(s.attempts, 3, 'each item attempted exactly 3 times');
    }
  });

  void it('multi-item heterogeneous self-loop: items with exitAt 0..4 exit one-at-a-time; retrier batch shrinks each round', async () => {
    // 5 items: exitAt 0,1,2,3,4.
    // Round 1: all 5 process; item 0 exits (attempts 1 > 0), items 1-4 loop.
    // Round 2: 4 items; item 1 exits (attempts 2 > 1), items 2-4 loop.
    // Round 3: 3 items; item 2 exits, items 3-4 loop.
    // Round 4: 2 items; item 3 exits, item 4 loops.
    // Round 5: 1 item; item 4 exits.
    const dispatcher = new Dagonizer<CycleState>();
    const firings: number[] = [];

    dispatcher.registerNode(TestCycleWalkNode.fanOut('urn:noocodec:node:fan', 5));
    dispatcher.registerNode(TestCycleWalkNode.retry('urn:noocodec:node:retrier', firings));
    const collected: CycleState[] = [];
    dispatcher.registerNode(TestCycleWalkNode.accumulator('urn:noocodec:node:acc', collected));

    const dag = TestDag.of('urn:noocodec:dag:cycle-heterogeneous', placementIri('urn:noocodec:dag:cycle-heterogeneous', 'fan'), [
        {
          '@id': 'urn:noocodec:dag:cycle-heterogeneous/node/fan',
          '@type': 'SingleNode',
          'name': 'fan',
          'node': 'urn:noocodec:node:fan',
          'outputs': { 'out': placementIri('urn:noocodec:dag:cycle-heterogeneous', 'a') },
        },
        {
          '@id': 'urn:noocodec:dag:cycle-heterogeneous/node/a',
          '@type': 'SingleNode',
          'name': 'a',
          'node': 'urn:noocodec:node:retrier',
          'outputs': { 'retry': placementIri('urn:noocodec:dag:cycle-heterogeneous', 'a'), 'done': placementIri('urn:noocodec:dag:cycle-heterogeneous', 'collect') },
        },
        {
          '@id': 'urn:noocodec:dag:cycle-heterogeneous/node/collect',
          '@type': 'SingleNode',
          'name': 'collect',
          'node': 'urn:noocodec:node:acc',
          'outputs': { 'done': placementIri('urn:noocodec:dag:cycle-heterogeneous', 'end') },
        },
        {
          '@id': 'urn:noocodec:dag:cycle-heterogeneous/node/end',
          '@type': 'TerminalNode',
          'name': 'end',
          'outcome': 'completed',
        },
      ]);
    dispatcher.registerDAG(dag);

    const result = await dispatcher.execute('urn:noocodec:dag:cycle-heterogeneous', new CycleState());

    assert.equal(result.terminalOutcome, 'completed');

    // 'a' fires exactly 5 times with shrinking batch sizes: 5,4,3,2,1.
    assert.deepEqual(
      firings,
      [5, 4, 3, 2, 1],
      'heterogeneous: one more item exits each round, batch shrinks by 1',
    );

    // executedNodes: fan, a×5, collect, end
    assert.deepEqual(result.executedNodes, ['fan', 'a', 'a', 'a', 'a', 'a', 'collect', 'end']);

    // All 5 items reach the accumulator.
    assert.equal(collected.length, 5, 'all 5 items reach the terminal accumulator');

    // Each item's final attempt count equals exitAt + 1 (one extra attempt that exits).
    const attemptsByExitAt = new Map<number, number>();
    for (const s of collected) {
      attemptsByExitAt.set(s.exitAt, s.attempts);
    }
    for (let exitAt = 0; exitAt < 5; exitAt++) {
      const attempts = attemptsByExitAt.get(exitAt);
      assert.equal(
        attempts,
        exitAt + 1,
        `item with exitAt=${exitAt} must have attempts=${exitAt + 1}`,
      );
    }
  });

  void it('budget exhaustion → salvage: items exhausting withinRetryBudget land at salvage; successful items land at done terminal', async () => {
    // 4 items: 2 with exitAt=0 (succeed immediately), 2 with exitAt=255 (exhaust budget).
    const dispatcher = new Dagonizer<CycleState>();
    const firings: number[] = [];
    const MAX_ATTEMPTS = 3;

    // Custom fan-out: 2 items with exitAt=0 (succeed fast), 2 items with exitAt=255 (exhaust).
    const mixedFanOut = TestBatchNode.of<CycleState, 'out'>(
      'urn:noocodec:node:mix-fan',
      ['out'],
      (batch) => {
        const sourceState = batch.row(0).state;
        const s0 = sourceState.clone(); s0.exitAt = 0; s0.attempts = 0;
        const s1 = sourceState.clone(); s1.exitAt = 0; s1.attempts = 0;
        const s2 = sourceState.clone(); s2.exitAt = 255; s2.attempts = 0;
        const s3 = sourceState.clone(); s3.exitAt = 255; s3.attempts = 0;
        const items: Array<{ 'id': string; 'state': CycleState }> = [
          { 'id': '0', 'state': s0 },
          { 'id': '1', 'state': s1 },
          { 'id': '2', 'state': s2 },
          { 'id': '3', 'state': s3 },
        ];
        const result = new Map<'out', Batch<CycleState>>();
        result.set('out', Batch.from(items));
        return result;
      },
    );

    dispatcher.registerNode(mixedFanOut);
    dispatcher.registerNode(TestCycleWalkNode.budgetRetry('urn:noocodec:node:budget-retrier', MAX_ATTEMPTS, firings));

    const successCollected: CycleState[] = [];
    const salvageCollected: CycleState[] = [];
    dispatcher.registerNode(TestCycleWalkNode.accumulator('urn:noocodec:node:success-acc', successCollected));
    dispatcher.registerNode(TestCycleWalkNode.accumulator('urn:noocodec:node:salvage-acc', salvageCollected));

    const dag = TestDag.of('urn:noocodec:dag:cycle-budget', placementIri('urn:noocodec:dag:cycle-budget', 'fan'), [
        {
          '@id': 'urn:noocodec:dag:cycle-budget/node/fan',
          '@type': 'SingleNode',
          'name': 'fan',
          'node': 'urn:noocodec:node:mix-fan',
          'outputs': { 'out': placementIri('urn:noocodec:dag:cycle-budget', 'b') },
        },
        {
          '@id': 'urn:noocodec:dag:cycle-budget/node/b',
          '@type': 'SingleNode',
          'name': 'b',
          'node': 'urn:noocodec:node:budget-retrier',
          'outputs': {
            'retry': placementIri('urn:noocodec:dag:cycle-budget', 'b'),
            'done': placementIri('urn:noocodec:dag:cycle-budget', 'success-collect'),
            'salvage': placementIri('urn:noocodec:dag:cycle-budget', 'salvage-collect'),
          },
        },
        {
          '@id': 'urn:noocodec:dag:cycle-budget/node/success-collect',
          '@type': 'SingleNode',
          'name': 'success-collect',
          'node': 'urn:noocodec:node:success-acc',
          'outputs': { 'done': placementIri('urn:noocodec:dag:cycle-budget', 'end') },
        },
        {
          '@id': 'urn:noocodec:dag:cycle-budget/node/salvage-collect',
          '@type': 'SingleNode',
          'name': 'salvage-collect',
          'node': 'urn:noocodec:node:salvage-acc',
          'outputs': { 'done': placementIri('urn:noocodec:dag:cycle-budget', 'end') },
        },
        {
          '@id': 'urn:noocodec:dag:cycle-budget/node/end',
          '@type': 'TerminalNode',
          'name': 'end',
          'outcome': 'completed',
        },
      ]);
    dispatcher.registerDAG(dag);

    const result = await dispatcher.execute('urn:noocodec:dag:cycle-budget', new CycleState());

    assert.equal(result.terminalOutcome, 'completed');

    // Successful items (exitAt=0) exit on the first pass.
    assert.equal(successCollected.length, 2, 'exactly 2 items succeed');
    for (const s of successCollected) {
      assert.equal(s.exitAt, 0, 'succeeded items have exitAt=0');
    }

    // Salvage items (exitAt=255) exhaust the budget (3 attempts) and land in salvage.
    assert.equal(salvageCollected.length, 2, 'exactly 2 items are salvaged');
    for (const s of salvageCollected) {
      assert.equal(s.exitAt, 255, 'salvaged items have exitAt=255 (never self-succeed)');
      // `withinRetryBudget` increments the counter; exhausted at maxAttempts.
      assert.equal(s.retriesFor('loop'), MAX_ATTEMPTS, 'budget key records exactly maxAttempts attempts');
    }
  });

  void it('back-edge into a join: cycle drains before the downstream join fires; join fires once over full coalesced batch', async () => {
    // Shape: input → fan (splits into loop-out and straight-out)
    //   loop-out  → a (self-loop; exitAt 0,1,1) → done: j
    //   straight-out → j (2 items, straight through)
    //   j → collect → end
    //
    // The join 'j' receives items from two feeders: the retry loop (cycle)
    // and the straight path. The rank scheduler must hold 'j' until both
    // feeders drain. After both drain, 'j' fires once over all 5 items.

    const dispatcher = new Dagonizer<CycleState>();
    const jFirings: number[] = [];
    const collected: CycleState[] = [];

    // Fan-out: 3 loop items (exitAt 0,1,1) + 2 straight items.
    const fanNode = TestBatchNode.of<CycleState, 'loop-out' | 'straight-out'>(
      'urn:noocodec:node:cycle-join-fan',
      ['loop-out', 'straight-out'],
      (batch, _ctx: NodeContextType) => {
        const sourceState = batch.row(0).state;

        const l0 = sourceState.clone(); l0.exitAt = 0;
        const l1 = sourceState.clone(); l1.exitAt = 1;
        const l2 = sourceState.clone(); l2.exitAt = 1;
        const s0 = sourceState.clone(); s0.exitAt = 0;
        const s1 = sourceState.clone(); s1.exitAt = 0;

        const loopItems: Array<{ 'id': string; 'state': CycleState }> = [
          { 'id': 'L0', 'state': l0 },
          { 'id': 'L1', 'state': l1 },
          { 'id': 'L2', 'state': l2 },
        ];
        const straightItems: Array<{ 'id': string; 'state': CycleState }> = [
          { 'id': 'S0', 'state': s0 },
          { 'id': 'S1', 'state': s1 },
        ];

        const result = new Map<'loop-out' | 'straight-out', Batch<CycleState>>();
        result.set('loop-out', Batch.from(loopItems));
        result.set('straight-out', Batch.from(straightItems));
        return result;
      },
    );

    dispatcher.registerNode(fanNode);
    dispatcher.registerNode(TestCycleWalkNode.retry('urn:noocodec:node:cycle-retrier', []));
    dispatcher.registerNode(TestCycleWalkNode.recording('urn:noocodec:node:j-join', jFirings));
    dispatcher.registerNode(TestCycleWalkNode.accumulator('urn:noocodec:node:j-acc', collected));

    const dag = TestDag.of('urn:noocodec:dag:cycle-join', placementIri('urn:noocodec:dag:cycle-join', 'fan'), [
        {
          '@id': 'urn:noocodec:dag:cycle-join/node/fan',
          '@type': 'SingleNode',
          'name': 'fan',
          'node': 'urn:noocodec:node:cycle-join-fan',
          'outputs': { 'loop-out': placementIri('urn:noocodec:dag:cycle-join', 'a'), 'straight-out': placementIri('urn:noocodec:dag:cycle-join', 'j') },
        },
        {
          '@id': 'urn:noocodec:dag:cycle-join/node/a',
          '@type': 'SingleNode',
          'name': 'a',
          'node': 'urn:noocodec:node:cycle-retrier',
          'outputs': { 'retry': placementIri('urn:noocodec:dag:cycle-join', 'a'), 'done': placementIri('urn:noocodec:dag:cycle-join', 'j') },
        },
        {
          '@id': 'urn:noocodec:dag:cycle-join/node/j',
          '@type': 'SingleNode',
          'name': 'j',
          'node': 'urn:noocodec:node:j-join',
          'outputs': { 'done': placementIri('urn:noocodec:dag:cycle-join', 'collect') },
        },
        {
          '@id': 'urn:noocodec:dag:cycle-join/node/collect',
          '@type': 'SingleNode',
          'name': 'collect',
          'node': 'urn:noocodec:node:j-acc',
          'outputs': { 'done': placementIri('urn:noocodec:dag:cycle-join', 'end') },
        },
        {
          '@id': 'urn:noocodec:dag:cycle-join/node/end',
          '@type': 'TerminalNode',
          'name': 'end',
          'outcome': 'completed',
        },
      ]);
    dispatcher.registerDAG(dag);

    const result = await dispatcher.execute('urn:noocodec:dag:cycle-join', new CycleState());

    assert.equal(result.terminalOutcome, 'completed');

    // j fires once with all 5 items (3 from cycle + 2 from straight path).
    assert.deepEqual(jFirings, [5], 'join fires exactly once over all 5 items after cycle drains');

    // All 5 items reach the accumulator.
    assert.equal(collected.length, 5, 'all 5 items coalesce at the join and reach the terminal');
  });
});
