/**
 * Batch-walk composite tests: proves ScatterNode and EmbeddedDAGNode placements
 * fire batch-native when reached by a multi-item batch from an upstream fan-out.
 *
 * The engine iterates each item in the batch through the composite's per-item
 * logic (executeDAGNode / executeEmbeddedDAG / executeScatter), then routes each
 * item's outcome into the WorkSet's downstream entries. Downstream placements
 * receive the coalesced batch and fire once over all N items.
 *
 * Tests:
 *   1. Multi-item EmbeddedDAG — uniform outcome (all N → success → same terminal)
 *   2. Multi-item EmbeddedDAG — split outcomes (even → success terminal, odd → error terminal)
 *   3. Multi-item ScatterNode — node-body scatter, per-parent source isolation
 *   4. Size-1 composite parity guard — batch-path output byte-identical to prior behavior
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

// ---------------------------------------------------------------------------
// Shared state: carries a numeric value and an operation log.
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Fan-out node: takes a size-1 batch and emits N items on port 'out'.
// Each clone carries its index as `value`.
// ---------------------------------------------------------------------------

class FanOutNode extends MonadicNode<CompositeState, 'out'> {
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

function makeFanOutNode(name: string, n: number): FanOutNode {
  return new FanOutNode(name, n);
}

// ---------------------------------------------------------------------------
// Accumulator node: collects all items passing through into an external array.
// Routes all items to 'done'.
// ---------------------------------------------------------------------------

class AccumulatorNode extends MonadicNode<CompositeState, 'done'> {
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

function makeAccumulatorNode(
  name: string,
  collected: CompositeState[],
): AccumulatorNode {
  return new AccumulatorNode(name, collected);
}

// ---------------------------------------------------------------------------
// Recording node: records how many items fire through it per invocation.
// Routes all items to 'done'.
// ---------------------------------------------------------------------------

class RecordingNode extends MonadicNode<CompositeState, 'done'> {
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

function makeRecordingNode(
  name: string,
  firings: number[],
): RecordingNode {
  return new RecordingNode(name, firings);
}

// ---------------------------------------------------------------------------
// DAG builder helpers (match house style from embedded-dag-deep.test.ts).
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Test 1: Multi-item EmbeddedDAG — uniform outcome
//
// Fan-out produces N=4 items (values 0,1,2,3) → EmbeddedDAGNode placement.
// The child DAG increments `value` by 10, exits via `success`.
// All N items converge at the same downstream terminal.
// The child's increment node records how many items it sees.
// ---------------------------------------------------------------------------

void describe('Multi-item EmbeddedDAG — uniform outcome (all N via success)', () => {
  void it('N items each thread through the child DAG; downstream fires once over all N', async () => {
    // Child: increment `value` by 10, then terminal.
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
    dispatcher.registerNode(makeFanOutNode('fan4', 4));
    dispatcher.registerNode(childIncrNode);
    dispatcher.registerNode(makeRecordingNode('downstream-rec', downstreamFirings));
    dispatcher.registerNode(makeAccumulatorNode('acc-node', downstreamCollected));
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
});

// ---------------------------------------------------------------------------
// Test 2: Multi-item EmbeddedDAG — split outcomes (partition by sub-DAG terminal)
//
// Fan-out produces N=6 items (values 0..5) → EmbeddedDAGNode placement.
// Child DAG routes even values → 'done-even' terminal (→ 'success' output),
// odd values → 'done-odd' terminal (→ 'error' output, mapped via outputs).
// EmbeddedDAGNode.outputs: success → 'even-acc', error → 'odd-acc'.
// ---------------------------------------------------------------------------

void describe('Multi-item EmbeddedDAG — split outcomes (even→success, odd→error)', () => {
  void it('items partition correctly across two downstream terminals by sub-DAG route', async () => {
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
    dispatcher.registerNode(makeFanOutNode('fan6', 6));
    dispatcher.registerNode(childRouterNode);
    dispatcher.registerNode(makeAccumulatorNode('even-collector', evenCollected));
    dispatcher.registerNode(makeAccumulatorNode('odd-collector', oddCollected));
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
});

// ---------------------------------------------------------------------------
// Test 3: Multi-item ScatterNode — per-parent source isolation
//
// Fan-out produces N=3 parent states, each carrying a distinct `items` array:
//   parent 0: items = [0]          (1 item)
//   parent 1: items = [0, 1]       (2 items)
//   parent 2: items = [0, 1, 2]    (3 items)
//
// Each parent goes through a ScatterNode (node body, append gather into `log`).
// The gather result for each parent must reflect only that parent's source,
// proving no cross-parent mixing. All N parents converge at the downstream terminal.
// ---------------------------------------------------------------------------

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

void describe('Multi-item ScatterNode — per-parent source isolation', () => {
  void it('each parent scatters its own source; no cross-parent mixing in gather', async () => {
    // Fan-out: 3 parent states, each with distinct items arrays and parentId.
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

    // Body node: runs once per scatter item; appends the item value to `gathered` via gather.
    // The node itself does nothing to `gathered` — that is the gather strategy's job.
    // We use the `append` gather strategy (target: `gathered`) with `itemKey: 'currentItem'`.
    class ScatterBodyNode extends MonadicNode<ScatterParentState, 'success'> {
      readonly name = 'scatter-body';
      readonly outputs = ['success'] as const;

      override async execute(batch: Batch<ScatterParentState>): Promise<RoutedBatch<'success', ScatterParentState>> {
        // The append gather strategy reads the clone's currentItem metadata and
        // appends it to the parent's `gathered` array.
        // The body node itself simply routes success; gather does the fold.
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

// ---------------------------------------------------------------------------
// Test 4: Size-1 composite parity guard
//
// An EmbeddedDAGNode reached by a size-1 batch (standard flow) must produce
// the same executedNodes / terminalOutcome as the existing single-item path.
// Guards that the batch-native loop did not regress size-1 behavior.
// ---------------------------------------------------------------------------

void describe('Size-1 composite parity guard', () => {
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

  void it('ScatterNode via size-1 batch (single parent) gathers correctly as before', async () => {
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
