/**
 * Batch-walk tests: exercises the batch-native work-set scheduler end to end.
 *
 * Uses hand-written `NodeInterface` implementations to drive multi-item batches
 * through the DAG. The `execute()` API starts with a size-1 batch from the
 * provided initial state; multi-item batches are produced when an entry node
 * fans out (returns a RoutedBatch whose single port holds N items), then flow
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

import { Batch } from '../../src/core/batch/Batch.js';
import type { Item } from '../../src/core/batch/Item.js';
import type { RoutedBatch } from '../../src/core/batch/RoutedBatch.js';
import { MonadicNode } from '../../src/core/MonadicNode.js';
import { Dagonizer } from '../../src/Dagonizer.js';
import { DAG_CONTEXT } from '../../src/entities/dag/DAG.js';
import type { DAG } from '../../src/entities/dag/DAG.js';
import type { NodeContextInterface } from '../../src/entities/node/NodeContext.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';
import { TestNode } from '../_support/TestNode.js';

// ===========================================================================
// DAG builder helpers
// ===========================================================================

function makeDAG(name: string, entrypoint: string, nodes: DAG['nodes']): DAG {
  return {
    '@context': DAG_CONTEXT,
    '@id': `urn:noocodex:dag:${name}`,
    '@type': 'DAG',
    name,
    'version': '1',
    entrypoint,
    nodes,
  };
}

function singleNode(dag: string, name: string, node: string, outputs: Record<string, string>): DAG['nodes'][number] {
  return {
    '@id': `urn:noocodex:dag:${dag}/node/${name}`,
    '@type': 'SingleNode',
    name,
    node,
    outputs,
  };
}

function terminalNode(dag: string, name: string, outcome: 'completed' | 'failed'): DAG['nodes'][number] {
  return {
    '@id': `urn:noocodex:dag:${dag}/node/${name}`,
    '@type': 'TerminalNode',
    'name': name,
    outcome,
  };
}

function embedNode(
  dag: string,
  name: string,
  childDag: string,
  outputs: Record<string, string>,
  stateMapping: { input: Record<string, string>; output: Record<string, string> },
): DAG['nodes'][number] {
  return {
    '@id': `urn:noocodex:dag:${dag}/node/${name}`,
    '@type': 'EmbeddedDAGNode',
    name,
    'dag': childDag,
    outputs,
    'stateMapping': stateMapping,
  };
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
    const copy = new WalkState() as this;
    copy.count = this.count;
    copy.log = [...this.log];
    return copy;
  }
}

// Fan-out node — takes a size-1 batch and emits N items on port 'out'.
// On the single input item, clones `n` states (each with `count = i` identifying
// which item it is) and routes all N to port 'out'.
class FanOutNode extends MonadicNode<WalkState, 'out'> {
  readonly name: string;
  readonly outputs: readonly ['out'] = ['out'];
  private readonly n: number;

  constructor(name: string, n: number) {
    super();
    this.name = name;
    this.n = n;
  }

  override async execute(batch: Batch<WalkState>, _ctx: NodeContextInterface): Promise<RoutedBatch<'out', WalkState>> {
    const sourceState = batch.row(0).state;
    const items: Array<{ 'id': string; 'state': WalkState }> = [];
    for (let i = 0; i < this.n; i++) {
      const clone = sourceState.clone();
      clone.count = i;
      clone.log.push(`fan:${i}`);
      items.push({ 'id': String(i), 'state': clone });
    }
    const result = new Map<'out', Batch<WalkState>>();
    result.set('out', Batch.from(items));
    return result;
  }
}

function makeFanOutNode(name: string, n: number): FanOutNode {
  return new FanOutNode(name, n);
}

// Partition node — splits items across two ports by even/odd count.
class PartitionNode extends MonadicNode<WalkState, 'even' | 'odd'> {
  readonly name: string;
  readonly outputs: readonly ['even', 'odd'] = ['even', 'odd'];

  constructor(name: string) {
    super();
    this.name = name;
  }

  override async execute(batch: Batch<WalkState>, _ctx: NodeContextInterface): Promise<RoutedBatch<'even' | 'odd', WalkState>> {
    const partitioned = batch.partition((s) => s.count % 2 === 0 ? 'even' : 'odd');
    const result = new Map<'even' | 'odd', Batch<WalkState>>();
    for (const [key, b] of partitioned) {
      result.set(key, b);
    }
    return result;
  }
}

function makePartitionNode(name: string): PartitionNode {
  return new PartitionNode(name);
}

// Recording node — stamps each item's log and records the size of every batch
// it fires over (one entry per invocation).
class RecordingNode extends MonadicNode<WalkState, 'done'> {
  readonly name: string;
  readonly outputs: readonly ['done'] = ['done'];
  private readonly firings: number[];

  constructor(name: string, firings: number[]) {
    super();
    this.name = name;
    this.firings = firings;
  }

  override async execute(batch: Batch<WalkState>, _ctx: NodeContextInterface): Promise<RoutedBatch<'done', WalkState>> {
    this.firings.push(batch.size);
    const items: Array<{ 'id': string; 'state': WalkState }> = [];
    for (const item of batch) {
      item.state.log.push(`${this.name}:run`);
      items.push({ 'id': item.id, 'state': item.state });
    }
    const result = new Map<'done', Batch<WalkState>>();
    result.set('done', Batch.from(items));
    return result;
  }
}

function makeRecordingNode(
  name: string,
  firings: number[],
): RecordingNode {
  return new RecordingNode(name, firings);
}

// Accumulator node — merges all items into an external array and routes them
// through to 'done'.
class AccumulatorNode extends MonadicNode<WalkState, 'done'> {
  readonly name: string;
  readonly outputs: readonly ['done'] = ['done'];
  private readonly collected: WalkState[];

  constructor(name: string, collected: WalkState[]) {
    super();
    this.name = name;
    this.collected = collected;
  }

  override async execute(batch: Batch<WalkState>, _ctx: NodeContextInterface): Promise<RoutedBatch<'done', WalkState>> {
    for (const item of batch) {
      this.collected.push(item.state);
    }
    const result = new Map<'done', Batch<WalkState>>();
    result.set('done', batch);
    return result;
  }
}

function makeAccumulatorNode(
  name: string,
  collected: WalkState[],
): AccumulatorNode {
  return new AccumulatorNode(name, collected);
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
    const copy = new CompositeState() as this;
    copy.value = this.value;
    copy.log = [...this.log];
    return copy;
  }
}

class CompositeFanOutNode extends MonadicNode<CompositeState, 'out'> {
  readonly name: string;
  readonly outputs = ['out'] as const;

  constructor(name: string, private readonly n: number) {
    super();
    this.name = name;
  }

  override async execute(batch: Batch<CompositeState>, _ctx: NodeContextInterface): Promise<RoutedBatch<'out', CompositeState>> {
    const source = batch.row(0).state;
    const items: Array<Item<CompositeState>> = [];
    for (let i = 0; i < this.n; i++) {
      const clone = source.clone();
      clone.value = i;
      clone.log.push(`fan:${i}`);
      items.push({ 'id': String(i), 'state': clone });
    }
    const result = new Map<'out', Batch<CompositeState>>();
    result.set('out', Batch.from(items));
    return result;
  }
}

function makeCompositeFanOutNode(name: string, n: number): CompositeFanOutNode {
  return new CompositeFanOutNode(name, n);
}

class CompositeAccumulatorNode extends MonadicNode<CompositeState, 'done'> {
  readonly name: string;
  readonly outputs = ['done'] as const;

  constructor(name: string, private readonly collected: CompositeState[]) {
    super();
    this.name = name;
  }

  override async execute(batch: Batch<CompositeState>, _ctx: NodeContextInterface): Promise<RoutedBatch<'done', CompositeState>> {
    for (const item of batch) {
      this.collected.push(item.state);
    }
    const result = new Map<'done', Batch<CompositeState>>();
    result.set('done', batch);
    return result;
  }
}

function makeCompositeAccumulatorNode(
  name: string,
  collected: CompositeState[],
): CompositeAccumulatorNode {
  return new CompositeAccumulatorNode(name, collected);
}

class CompositeRecordingNode extends MonadicNode<CompositeState, 'done'> {
  readonly name: string;
  readonly outputs = ['done'] as const;

  constructor(name: string, private readonly firings: number[]) {
    super();
    this.name = name;
  }

  override async execute(batch: Batch<CompositeState>, _ctx: NodeContextInterface): Promise<RoutedBatch<'done', CompositeState>> {
    this.firings.push(batch.size);
    const result = new Map<'done', Batch<CompositeState>>();
    result.set('done', batch);
    return result;
  }
}

function makeCompositeRecordingNode(
  name: string,
  firings: number[],
): CompositeRecordingNode {
  return new CompositeRecordingNode(name, firings);
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
    this.gathered = [] as number[];
    this.parentId = 0;
  }

  override clone(): this {
    const copy = new ScatterParentState() as this;
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
    const copy = new CycleState() as this;
    copy.exitAt = this.exitAt;
    copy.attempts = this.attempts;
    return copy;
  }
}

// Fan-out node — emits N items where item i receives `exitAt = i`, so item 0
// exits immediately, item 1 after one retry, item 4 after four retries, etc.
function makeCycleFanOutNode(name: string, n: number): MonadicNode<CycleState, 'out'> {
  class CycleFanOutNode extends MonadicNode<CycleState, 'out'> {
    readonly name: string;
    readonly outputs = ['out'] as const;

    constructor(
      name: string,
      private readonly n: number,
    ) {
      super();
      this.name = name;
    }

    override async execute(
      batch: Batch<CycleState>,
      _ctx: NodeContextInterface,
    ): Promise<RoutedBatch<'out', CycleState>> {
      const sourceState = batch.row(0).state;
      const items: Array<{ 'id': string; 'state': CycleState }> = [];
      for (let i = 0; i < this.n; i++) {
        const clone = sourceState.clone();
        clone.exitAt = i;
        clone.attempts = 0;
        items.push({ 'id': String(i), 'state': clone });
      }
      const result = new Map<'out', Batch<CycleState>>();
      result.set('out', Batch.from(items));
      return result;
    }
  }
  return new CycleFanOutNode(name, n);
}

// Fan-out with uniform exitAt — all N items exit after the same number of
// attempts. Used for the homogeneous lockstep walk.
function makeHomogeneousFanOutNode(
  name: string,
  n: number,
  exitAt: number,
): MonadicNode<CycleState, 'out'> {
  class HomogeneousFanOutNode extends MonadicNode<CycleState, 'out'> {
    readonly name: string;
    readonly outputs = ['out'] as const;

    constructor(
      name: string,
      private readonly n: number,
      private readonly exitAt: number,
    ) {
      super();
      this.name = name;
    }

    override async execute(
      batch: Batch<CycleState>,
      _ctx: NodeContextInterface,
    ): Promise<RoutedBatch<'out', CycleState>> {
      const sourceState = batch.row(0).state;
      const items: Array<{ 'id': string; 'state': CycleState }> = [];
      for (let i = 0; i < this.n; i++) {
        const clone = sourceState.clone();
        clone.exitAt = this.exitAt;
        clone.attempts = 0;
        items.push({ 'id': String(i), 'state': clone });
      }
      const result = new Map<'out', Batch<CycleState>>();
      result.set('out', Batch.from(items));
      return result;
    }
  }
  return new HomogeneousFanOutNode(name, n, exitAt);
}

// Retry node — increments `attempts` per item; routes items whose attempt count
// has reached `exitAt` to `done`, others to `retry`. Hard cap at 50 iterations
// prevents an infinite loop if a scheduler bug stops items from exiting — the
// test then fails on the wrong `executedNodes` assertion rather than hanging.
function makeRetryNode(
  name: string,
  firings: number[],
): MonadicNode<CycleState, 'retry' | 'done'> {
  class RetryNode extends MonadicNode<CycleState, 'retry' | 'done'> {
    readonly name: string;
    readonly outputs = ['retry', 'done'] as const;

    constructor(
      name: string,
      private readonly firings: number[],
    ) {
      super();
      this.name = name;
    }

    override async execute(
      batch: Batch<CycleState>,
      _ctx: NodeContextInterface,
    ): Promise<RoutedBatch<'retry' | 'done', CycleState>> {
      this.firings.push(batch.size);

      const retryItems: Array<{ 'id': string; 'state': CycleState }> = [];
      const doneItems: Array<{ 'id': string; 'state': CycleState }> = [];

      for (const item of batch) {
        item.state.attempts += 1;
        // Safety cap: treat items that have been around too long as done to
        // prevent hangs; a real engine regression surfaces as a wrong assertion.
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
    }
  }
  return new RetryNode(name, firings);
}

// Budget-based retry node — uses `withinRetryBudget` to decide routing. Items
// within budget go to `retry`; exhausted items go to `salvage`; items with
// `exitAt = 0` succeed immediately and go to `done`.
function makeBudgetRetryNode(
  name: string,
  maxAttempts: number,
  firings: number[],
): MonadicNode<CycleState, 'retry' | 'done' | 'salvage'> {
  class BudgetRetryNode extends MonadicNode<CycleState, 'retry' | 'done' | 'salvage'> {
    readonly name: string;
    readonly outputs = ['retry', 'done', 'salvage'] as const;

    constructor(
      name: string,
      private readonly maxAttempts: number,
      private readonly firings: number[],
    ) {
      super();
      this.name = name;
    }

    override async execute(
      batch: Batch<CycleState>,
      _ctx: NodeContextInterface,
    ): Promise<RoutedBatch<'retry' | 'done' | 'salvage', CycleState>> {
      this.firings.push(batch.size);

      const retryItems: Array<{ 'id': string; 'state': CycleState }> = [];
      const doneItems: Array<{ 'id': string; 'state': CycleState }> = [];
      const salvageItems: Array<{ 'id': string; 'state': CycleState }> = [];

      for (const item of batch) {
        // Items with `exitAt = 0` succeed immediately (do not consume budget).
        if (item.state.exitAt === 0) {
          item.state.attempts += 1;
          doneItems.push({ 'id': item.id, 'state': item.state });
        } else if (item.state.withinRetryBudget('loop', this.maxAttempts)) {
          // Within budget — loop again.
          item.state.attempts += 1;
          retryItems.push({ 'id': item.id, 'state': item.state });
        } else {
          // Budget exhausted.
          item.state.attempts += 1;
          salvageItems.push({ 'id': item.id, 'state': item.state });
        }
      }

      const result = new Map<'retry' | 'done' | 'salvage', Batch<CycleState>>();
      if (retryItems.length > 0) result.set('retry', Batch.from(retryItems));
      if (doneItems.length > 0) result.set('done', Batch.from(doneItems));
      if (salvageItems.length > 0) result.set('salvage', Batch.from(salvageItems));
      return result;
    }
  }
  return new BudgetRetryNode(name, maxAttempts, firings);
}

// Accumulator node — collects all items for post-run inspection.
function makeCycleAccumulatorNode(
  name: string,
  collected: CycleState[],
): MonadicNode<CycleState, 'done'> {
  class CycleAccumulatorNode extends MonadicNode<CycleState, 'done'> {
    readonly name: string;
    readonly outputs = ['done'] as const;

    constructor(
      name: string,
      private readonly collected: CycleState[],
    ) {
      super();
      this.name = name;
    }

    override async execute(
      batch: Batch<CycleState>,
      _ctx: NodeContextInterface,
    ): Promise<RoutedBatch<'done', CycleState>> {
      for (const item of batch) {
        this.collected.push(item.state);
      }
      const result = new Map<'done', Batch<CycleState>>();
      result.set('done', batch);
      return result;
    }
  }
  return new CycleAccumulatorNode(name, collected);
}

// Recording node — stamps firings array and passes items through.
function makeCycleRecordingNode(
  name: string,
  firings: number[],
): MonadicNode<CycleState, 'done'> {
  class CycleRecordingNode extends MonadicNode<CycleState, 'done'> {
    readonly name: string;
    readonly outputs = ['done'] as const;

    constructor(
      name: string,
      private readonly firings: number[],
    ) {
      super();
      this.name = name;
    }

    override async execute(
      batch: Batch<CycleState>,
      _ctx: NodeContextInterface,
    ): Promise<RoutedBatch<'done', CycleState>> {
      this.firings.push(batch.size);
      const result = new Map<'done', Batch<CycleState>>();
      result.set('done', batch);
      return result;
    }
  }
  return new CycleRecordingNode(name, firings);
}

// ===========================================================================
// Size-1 parity — every placement kind reached by a size-1 batch produces the
// same executedNodes / outcome as the single-item path.
// ===========================================================================

void describe('Batch walk — size-1 parity', () => {
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

  void it('EmbeddedDAGNode via size-1 batch produces same executedNodes/outcome as direct execute', async () => {
    // Simple child DAG: one transform node → terminal.
    const childDAG = makeDAG('parity-child', 'transform', [
      singleNode('parity-child', 'transform', 'transform-node', { 'ok': 'child-end' }),
      terminalNode('parity-child', 'child-end', 'completed'),
    ]);

    const valueMapping = { 'input': { 'value': 'value' }, 'output': { 'value': 'value' } } as const;

    // Parent DAG: single entry → embed → terminal.
    const parentDAG = makeDAG('parity-parent', 'entry', [
      singleNode('parity-parent', 'entry', 'entry-node', { 'ok': 'embed' }),
      embedNode(
        'parity-parent',
        'embed',
        'parity-child',
        { 'success': 'parity-end', 'error': 'parity-end' },
        valueMapping,
      ),
      terminalNode('parity-parent', 'parity-end', 'completed'),
    ]);

    const dispatcher = new Dagonizer<CompositeState>();
    dispatcher.registerNode(TestNode.make('entry-node', ['ok'], () => 'ok'));
    dispatcher.registerNode(TestNode.make('transform-node', ['ok'], () => 'ok'));
    dispatcher.registerDAG(childDAG);
    dispatcher.registerDAG(parentDAG);

    const initialState = new CompositeState();
    initialState.value = 42;

    const result = await dispatcher.execute('parity-parent', initialState);

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

    class ParityBodyNode extends MonadicNode<ScatterParentState, 'success'> {
      readonly name = 'parity-body';
      readonly outputs = ['success'] as const;

      override async execute(batch: Batch<ScatterParentState>): Promise<RoutedBatch<'success', ScatterParentState>> {
        const result = new Map<'success', Batch<ScatterParentState>>();
        result.set('success', batch);
        return result;
      }
    }

    const bodyNode = new ParityBodyNode();

    const parity1Dag = makeDAG('parity-scatter-1', 'parity-scatter', [
      {
        '@id': 'urn:noocodex:dag:parity-scatter-1/node/parity-scatter',
        '@type': 'ScatterNode',
        'name': 'parity-scatter',
        'body': { 'node': 'parity-body' },
        'source': 'items',
        'itemKey': 'currentItem',
        'gather': { 'strategy': 'append', 'target': 'gathered' },
        'outputs': {
          'all-success': 'parity-scatter-end',
          'partial': 'parity-scatter-end',
          'all-error': 'parity-scatter-end',
          'empty': 'parity-scatter-end',
        },
      },
      terminalNode('parity-scatter-1', 'parity-scatter-end', 'completed'),
    ]);

    const dispatcher = new Dagonizer<ScatterParentState>();
    dispatcher.registerNode(bodyNode);
    dispatcher.registerDAG(parity1Dag);

    const result = await dispatcher.execute('parity-scatter-1', singleParentState);

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

  void it('diamond join (D) fires exactly once over the merged batch from B and C', async () => {
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

    class ChildIncrNode extends MonadicNode<CompositeState, 'done'> {
      readonly name = 'child-incr';
      readonly outputs = ['done'] as const;

      constructor(private readonly childItemsSeen: number[]) {
        super();
      }

      override async execute(batch: Batch<CompositeState>): Promise<RoutedBatch<'done', CompositeState>> {
        for (const item of batch) {
          this.childItemsSeen.push(item.state.value);
          item.state.value += 10;
          item.state.log.push(`child-incr:${item.state.value}`);
        }
        const result = new Map<'done', Batch<CompositeState>>();
        result.set('done', batch);
        return result;
      }
    }

    const childIncrNode = new ChildIncrNode(childItemsSeen);

    // Child DAG: child-incr → child-end (success terminal).
    const childDAG = makeDAG('embed-uniform-child', 'child-incr', [
      singleNode('embed-uniform-child', 'child-incr', 'child-incr', { 'done': 'child-end' }),
      terminalNode('embed-uniform-child', 'child-end', 'completed'),
    ]);

    // Value mapping: parent `value` → child `value`; child `value` → parent `value`.
    const valueMapping = { 'input': { 'value': 'value' }, 'output': { 'value': 'value' } } as const;

    // Parent DAG: fan → embed-placement → downstream-acc → parent-end.
    const downstreamCollected: CompositeState[] = [];
    const downstreamFirings: number[] = [];

    const parentDAG = makeDAG('embed-uniform-parent', 'fan', [
      {
        '@id': 'urn:noocodex:dag:embed-uniform-parent/node/fan',
        '@type': 'SingleNode',
        'name': 'fan',
        'node': 'fan4',
        'outputs': { 'out': 'embed' },
      },
      embedNode(
        'embed-uniform-parent',
        'embed',
        'embed-uniform-child',
        { 'success': 'downstream', 'error': 'parent-end' },
        valueMapping,
      ),
      singleNode('embed-uniform-parent', 'downstream', 'downstream-rec', { 'done': 'acc' }),
      singleNode('embed-uniform-parent', 'acc', 'acc-node', { 'done': 'parent-end' }),
      terminalNode('embed-uniform-parent', 'parent-end', 'completed'),
    ]);

    const dispatcher = new Dagonizer<CompositeState>();
    dispatcher.registerNode(makeCompositeFanOutNode('fan4', 4));
    dispatcher.registerNode(childIncrNode);
    dispatcher.registerNode(makeCompositeRecordingNode('downstream-rec', downstreamFirings));
    dispatcher.registerNode(makeCompositeAccumulatorNode('acc-node', downstreamCollected));
    dispatcher.registerDAG(childDAG);
    dispatcher.registerDAG(parentDAG);

    const result = await dispatcher.execute('embed-uniform-parent', new CompositeState());

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
    class ChildRouterNode extends MonadicNode<CompositeState, 'success' | 'failure'> {
      readonly name = 'child-router';
      readonly outputs = ['success', 'failure'] as const;

      override async execute(batch: Batch<CompositeState>): Promise<RoutedBatch<'success' | 'failure', CompositeState>> {
        const even: Array<Item<CompositeState>> = [];
        const odd: Array<Item<CompositeState>> = [];
        for (const item of batch) {
          if (item.state.value % 2 === 0) {
            even.push(item);
          } else {
            odd.push(item);
          }
        }
        const result = new Map<'success' | 'failure', Batch<CompositeState>>();
        if (even.length > 0) result.set('success', Batch.from(even));
        if (odd.length > 0) result.set('failure', Batch.from(odd));
        return result;
      }
    }

    const childRouterNode = new ChildRouterNode();

    // Child DAG: router → success-terminal or failure-terminal.
    // success terminal outcome = 'completed', failure terminal outcome = 'failed'.
    // The engine maps 'completed' → 'success' output, 'failed' → 'error' output.
    const childDAG = makeDAG('embed-split-child', 'child-router', [
      {
        '@id': 'urn:noocodex:dag:embed-split-child/node/child-router',
        '@type': 'SingleNode',
        'name': 'child-router',
        'node': 'child-router',
        'outputs': { 'success': 'child-success-end', 'failure': 'child-fail-end' },
      },
      terminalNode('embed-split-child', 'child-success-end', 'completed'),
      terminalNode('embed-split-child', 'child-fail-end', 'failed'),
    ]);

    // Parent DAG: fan → embed → split to even-acc (success) or odd-acc (error).
    const evenCollected: CompositeState[] = [];
    const oddCollected: CompositeState[] = [];

    const valueMapping = { 'input': { 'value': 'value' }, 'output': { 'value': 'value' } } as const;

    const parentDAG = makeDAG('embed-split-parent', 'fan', [
      {
        '@id': 'urn:noocodex:dag:embed-split-parent/node/fan',
        '@type': 'SingleNode',
        'name': 'fan',
        'node': 'fan6',
        'outputs': { 'out': 'embed' },
      },
      embedNode(
        'embed-split-parent',
        'embed',
        'embed-split-child',
        { 'success': 'even-acc', 'error': 'odd-acc' },
        valueMapping,
      ),
      singleNode('embed-split-parent', 'even-acc', 'even-collector', { 'done': 'parent-end' }),
      singleNode('embed-split-parent', 'odd-acc', 'odd-collector', { 'done': 'parent-end' }),
      terminalNode('embed-split-parent', 'parent-end', 'completed'),
    ]);

    const dispatcher = new Dagonizer<CompositeState>();
    dispatcher.registerNode(makeCompositeFanOutNode('fan6', 6));
    dispatcher.registerNode(childRouterNode);
    dispatcher.registerNode(makeCompositeAccumulatorNode('even-collector', evenCollected));
    dispatcher.registerNode(makeCompositeAccumulatorNode('odd-collector', oddCollected));
    dispatcher.registerDAG(childDAG);
    dispatcher.registerDAG(parentDAG);

    const result = await dispatcher.execute('embed-split-parent', new CompositeState());

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
    class ParentFanOutNode extends MonadicNode<ScatterParentState, 'out'> {
      readonly name = 'parent-fan';
      readonly outputs = ['out'] as const;

      override async execute(batch: Batch<ScatterParentState>): Promise<RoutedBatch<'out', ScatterParentState>> {
        const source = batch.row(0).state;
        const items: Array<Item<ScatterParentState>> = [];
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
      }
    }

    const fanOutNode = new ParentFanOutNode();

    // Body node: runs once per scatter item; the append gather strategy (target:
    // `gathered`, itemKey: 'currentItem') reads the clone's currentItem metadata
    // and appends it to the parent's `gathered` array. The body node itself does
    // nothing to `gathered` — that is the gather strategy's job.
    class ScatterBodyNode extends MonadicNode<ScatterParentState, 'success'> {
      readonly name = 'scatter-body';
      readonly outputs = ['success'] as const;

      override async execute(batch: Batch<ScatterParentState>): Promise<RoutedBatch<'success', ScatterParentState>> {
        const result = new Map<'success', Batch<ScatterParentState>>();
        result.set('success', batch);
        return result;
      }
    }

    const scatterBodyNode = new ScatterBodyNode();

    // Downstream accumulator collects all parent states after scatter+gather.
    const downstreamCollected: ScatterParentState[] = [];
    class DownstreamNode extends MonadicNode<ScatterParentState, 'done'> {
      readonly name = 'downstream';
      readonly outputs = ['done'] as const;

      constructor(private readonly downstreamCollected: ScatterParentState[]) {
        super();
      }

      override async execute(batch: Batch<ScatterParentState>): Promise<RoutedBatch<'done', ScatterParentState>> {
        for (const item of batch) {
          this.downstreamCollected.push(item.state);
        }
        const result = new Map<'done', Batch<ScatterParentState>>();
        result.set('done', batch);
        return result;
      }
    }

    const downstreamNode = new DownstreamNode(downstreamCollected);

    const dag = makeDAG('scatter-per-parent', 'fan', [
      {
        '@id': 'urn:noocodex:dag:scatter-per-parent/node/fan',
        '@type': 'SingleNode',
        'name': 'fan',
        'node': 'parent-fan',
        'outputs': { 'out': 'scatter' },
      },
      {
        '@id': 'urn:noocodex:dag:scatter-per-parent/node/scatter',
        '@type': 'ScatterNode',
        'name': 'scatter',
        'body': { 'node': 'scatter-body' },
        'source': 'items',
        'itemKey': 'currentItem',
        'gather': { 'strategy': 'append', 'target': 'gathered' },
        'outputs': {
          'all-success': 'downstream',
          'partial': 'downstream',
          'all-error': 'downstream',
          'empty': 'downstream',
        },
      },
      singleNode('scatter-per-parent', 'downstream', 'downstream', { 'done': 'end' }),
      terminalNode('scatter-per-parent', 'end', 'completed'),
    ]);

    const dispatcher = new Dagonizer<ScatterParentState>();
    dispatcher.registerNode(fanOutNode);
    dispatcher.registerNode(scatterBodyNode);
    dispatcher.registerNode(downstreamNode);
    dispatcher.registerDAG(dag);

    const result = await dispatcher.execute('scatter-per-parent', new ScatterParentState());

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

    dispatcher.registerNode(makeRetryNode('retrier', firings));
    const collected: CycleState[] = [];
    dispatcher.registerNode(makeCycleAccumulatorNode('acc', collected));

    const dag: DAG = {
      '@context': DAG_CONTEXT,
      '@id': 'urn:noocodex:dag:cycle-size1',
      '@type': 'DAG',
      'name': 'cycle-size1',
      'version': '1',
      'entrypoint': 'a',
      'nodes': [
        {
          '@id': 'urn:noocodex:dag:cycle-size1/node/a',
          '@type': 'SingleNode',
          'name': 'a',
          'node': 'retrier',
          'outputs': { 'retry': 'a', 'done': 'collect' },
        },
        {
          '@id': 'urn:noocodex:dag:cycle-size1/node/collect',
          '@type': 'SingleNode',
          'name': 'collect',
          'node': 'acc',
          'outputs': { 'done': 'end' },
        },
        {
          '@id': 'urn:noocodex:dag:cycle-size1/node/end',
          '@type': 'TerminalNode',
          'name': 'end',
          'outcome': 'completed',
        },
      ],
    };
    dispatcher.registerDAG(dag);

    const input = new CycleState();
    input.exitAt = 3; // exits after attempt 4 (attempts 1,2,3 loop; attempt 4 exits)

    const result = await dispatcher.execute('cycle-size1', input);

    assert.equal(result.terminalOutcome, 'completed');
    assert.equal(result.state.lifecycle.kind, 'completed');
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

    dispatcher.registerNode(makeRetryNode('retrier', firings));
    const collected: CycleState[] = [];
    dispatcher.registerNode(makeCycleAccumulatorNode('acc', collected));

    const dag: DAG = {
      '@context': DAG_CONTEXT,
      '@id': 'urn:noocodex:dag:cycle-immediate',
      '@type': 'DAG',
      'name': 'cycle-immediate',
      'version': '1',
      'entrypoint': 'a',
      'nodes': [
        {
          '@id': 'urn:noocodex:dag:cycle-immediate/node/a',
          '@type': 'SingleNode',
          'name': 'a',
          'node': 'retrier',
          'outputs': { 'retry': 'a', 'done': 'collect' },
        },
        {
          '@id': 'urn:noocodex:dag:cycle-immediate/node/collect',
          '@type': 'SingleNode',
          'name': 'collect',
          'node': 'acc',
          'outputs': { 'done': 'end' },
        },
        {
          '@id': 'urn:noocodex:dag:cycle-immediate/node/end',
          '@type': 'TerminalNode',
          'name': 'end',
          'outcome': 'completed',
        },
      ],
    };
    dispatcher.registerDAG(dag);

    const input = new CycleState();
    input.exitAt = 0; // attempts becomes 1 which is > 0 → immediate exit

    const result = await dispatcher.execute('cycle-immediate', input);

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

    dispatcher.registerNode(makeHomogeneousFanOutNode('fan', 4, 2));
    dispatcher.registerNode(makeRetryNode('retrier', firings));
    const collected: CycleState[] = [];
    dispatcher.registerNode(makeCycleAccumulatorNode('acc', collected));

    const dag: DAG = {
      '@context': DAG_CONTEXT,
      '@id': 'urn:noocodex:dag:cycle-homogeneous',
      '@type': 'DAG',
      'name': 'cycle-homogeneous',
      'version': '1',
      'entrypoint': 'fan',
      'nodes': [
        {
          '@id': 'urn:noocodex:dag:cycle-homogeneous/node/fan',
          '@type': 'SingleNode',
          'name': 'fan',
          'node': 'fan',
          'outputs': { 'out': 'a' },
        },
        {
          '@id': 'urn:noocodex:dag:cycle-homogeneous/node/a',
          '@type': 'SingleNode',
          'name': 'a',
          'node': 'retrier',
          'outputs': { 'retry': 'a', 'done': 'collect' },
        },
        {
          '@id': 'urn:noocodex:dag:cycle-homogeneous/node/collect',
          '@type': 'SingleNode',
          'name': 'collect',
          'node': 'acc',
          'outputs': { 'done': 'end' },
        },
        {
          '@id': 'urn:noocodex:dag:cycle-homogeneous/node/end',
          '@type': 'TerminalNode',
          'name': 'end',
          'outcome': 'completed',
        },
      ],
    };
    dispatcher.registerDAG(dag);

    const result = await dispatcher.execute('cycle-homogeneous', new CycleState());

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

    dispatcher.registerNode(makeCycleFanOutNode('fan', 5));
    dispatcher.registerNode(makeRetryNode('retrier', firings));
    const collected: CycleState[] = [];
    dispatcher.registerNode(makeCycleAccumulatorNode('acc', collected));

    const dag: DAG = {
      '@context': DAG_CONTEXT,
      '@id': 'urn:noocodex:dag:cycle-heterogeneous',
      '@type': 'DAG',
      'name': 'cycle-heterogeneous',
      'version': '1',
      'entrypoint': 'fan',
      'nodes': [
        {
          '@id': 'urn:noocodex:dag:cycle-heterogeneous/node/fan',
          '@type': 'SingleNode',
          'name': 'fan',
          'node': 'fan',
          'outputs': { 'out': 'a' },
        },
        {
          '@id': 'urn:noocodex:dag:cycle-heterogeneous/node/a',
          '@type': 'SingleNode',
          'name': 'a',
          'node': 'retrier',
          'outputs': { 'retry': 'a', 'done': 'collect' },
        },
        {
          '@id': 'urn:noocodex:dag:cycle-heterogeneous/node/collect',
          '@type': 'SingleNode',
          'name': 'collect',
          'node': 'acc',
          'outputs': { 'done': 'end' },
        },
        {
          '@id': 'urn:noocodex:dag:cycle-heterogeneous/node/end',
          '@type': 'TerminalNode',
          'name': 'end',
          'outcome': 'completed',
        },
      ],
    };
    dispatcher.registerDAG(dag);

    const result = await dispatcher.execute('cycle-heterogeneous', new CycleState());

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
    class MixedFanOutNode extends MonadicNode<CycleState, 'out'> {
      readonly name = 'mix-fan';
      readonly outputs = ['out'] as const;

      override async execute(
        batch: Batch<CycleState>,
        _ctx: NodeContextInterface,
      ): Promise<RoutedBatch<'out', CycleState>> {
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
      }
    }
    const mixedFanOut = new MixedFanOutNode();

    dispatcher.registerNode(mixedFanOut);
    dispatcher.registerNode(makeBudgetRetryNode('budget-retrier', MAX_ATTEMPTS, firings));

    const successCollected: CycleState[] = [];
    const salvageCollected: CycleState[] = [];
    dispatcher.registerNode(makeCycleAccumulatorNode('success-acc', successCollected));
    dispatcher.registerNode(makeCycleAccumulatorNode('salvage-acc', salvageCollected));

    const dag: DAG = {
      '@context': DAG_CONTEXT,
      '@id': 'urn:noocodex:dag:cycle-budget',
      '@type': 'DAG',
      'name': 'cycle-budget',
      'version': '1',
      'entrypoint': 'fan',
      'nodes': [
        {
          '@id': 'urn:noocodex:dag:cycle-budget/node/fan',
          '@type': 'SingleNode',
          'name': 'fan',
          'node': 'mix-fan',
          'outputs': { 'out': 'b' },
        },
        {
          '@id': 'urn:noocodex:dag:cycle-budget/node/b',
          '@type': 'SingleNode',
          'name': 'b',
          'node': 'budget-retrier',
          'outputs': { 'retry': 'b', 'done': 'success-collect', 'salvage': 'salvage-collect' },
        },
        {
          '@id': 'urn:noocodex:dag:cycle-budget/node/success-collect',
          '@type': 'SingleNode',
          'name': 'success-collect',
          'node': 'success-acc',
          'outputs': { 'done': 'end' },
        },
        {
          '@id': 'urn:noocodex:dag:cycle-budget/node/salvage-collect',
          '@type': 'SingleNode',
          'name': 'salvage-collect',
          'node': 'salvage-acc',
          'outputs': { 'done': 'end' },
        },
        {
          '@id': 'urn:noocodex:dag:cycle-budget/node/end',
          '@type': 'TerminalNode',
          'name': 'end',
          'outcome': 'completed',
        },
      ],
    };
    dispatcher.registerDAG(dag);

    const result = await dispatcher.execute('cycle-budget', new CycleState());

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
    class CycleJoinFanNode extends MonadicNode<CycleState, 'loop-out' | 'straight-out'> {
      readonly name = 'cycle-join-fan';
      readonly outputs = ['loop-out', 'straight-out'] as const;

      override async execute(
        batch: Batch<CycleState>,
        _ctx: NodeContextInterface,
      ): Promise<RoutedBatch<'loop-out' | 'straight-out', CycleState>> {
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
      }
    }
    const fanNode = new CycleJoinFanNode();

    dispatcher.registerNode(fanNode);
    dispatcher.registerNode(makeRetryNode('cycle-retrier', []));
    dispatcher.registerNode(makeCycleRecordingNode('j-join', jFirings));
    dispatcher.registerNode(makeCycleAccumulatorNode('j-acc', collected));

    const dag: DAG = {
      '@context': DAG_CONTEXT,
      '@id': 'urn:noocodex:dag:cycle-join',
      '@type': 'DAG',
      'name': 'cycle-join',
      'version': '1',
      'entrypoint': 'fan',
      'nodes': [
        {
          '@id': 'urn:noocodex:dag:cycle-join/node/fan',
          '@type': 'SingleNode',
          'name': 'fan',
          'node': 'cycle-join-fan',
          'outputs': { 'loop-out': 'a', 'straight-out': 'j' },
        },
        {
          '@id': 'urn:noocodex:dag:cycle-join/node/a',
          '@type': 'SingleNode',
          'name': 'a',
          'node': 'cycle-retrier',
          'outputs': { 'retry': 'a', 'done': 'j' },
        },
        {
          '@id': 'urn:noocodex:dag:cycle-join/node/j',
          '@type': 'SingleNode',
          'name': 'j',
          'node': 'j-join',
          'outputs': { 'done': 'collect' },
        },
        {
          '@id': 'urn:noocodex:dag:cycle-join/node/collect',
          '@type': 'SingleNode',
          'name': 'collect',
          'node': 'j-acc',
          'outputs': { 'done': 'end' },
        },
        {
          '@id': 'urn:noocodex:dag:cycle-join/node/end',
          '@type': 'TerminalNode',
          'name': 'end',
          'outcome': 'completed',
        },
      ],
    };
    dispatcher.registerDAG(dag);

    const result = await dispatcher.execute('cycle-join', new CycleState());

    assert.equal(result.terminalOutcome, 'completed');

    // j fires once with all 5 items (3 from cycle + 2 from straight path).
    assert.deepEqual(jFirings, [5], 'join fires exactly once over all 5 items after cycle drains');

    // All 5 items reach the accumulator.
    assert.equal(collected.length, 5, 'all 5 items coalesce at the join and reach the terminal');
  });
});
