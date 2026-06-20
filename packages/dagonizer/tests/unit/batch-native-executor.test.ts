/**
 * Batch-native executor tests: correctness of the three fixes applied to `runNodes`.
 *
 * Fix 1 — TerminalNode accumulator: multi-item batches continue the work-set loop
 *   after each terminal hit instead of breaking, so items can reach different
 *   terminals. Outcome is 'failed' when ANY item reaches a failed terminal.
 *
 * Fix 2 — `inputBatch` seed seam: internal parameter wires a pre-built Batch into
 *   the fresh-execute seed, enabling batch-native embedded-DAG dispatch.
 *
 * Fix 3 — EmbeddedDAGNode batch-native path: an EmbeddedDAGNode reached by an N-item
 *   batch runs the child DAG once over all N clones instead of N separate calls,
 *   producing the same outputs as per-item execution.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { MonadicNode } from '../../src/core/MonadicNode.js';
import { Dagonizer } from '../../src/Dagonizer.js';
import { Batch } from '../../src/entities/batch/Batch.js';
import type { ItemType } from '../../src/entities/batch/Item.js';
import type { RoutedBatchType } from '../../src/entities/batch/RoutedBatchType.js';
import type { DAGType } from '../../src/entities/dag/DAG.js';
import type { NodeContextType } from '../../src/entities/node/NodeContext.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';
import { TestDag } from '../_support/TestDag.js';

// ===========================================================================
// DAG builder helpers
// ===========================================================================

function singleNode(dag: string, name: string, node: string, outputs: Record<string, string>): DAGType['nodes'][number] {
  return {
    '@id': `urn:noocodex:dag:${dag}/node/${name}`,
    '@type': 'SingleNode',
    name,
    node,
    outputs,
  };
}

function terminalNode(dag: string, name: string, outcome: 'completed' | 'failed'): DAGType['nodes'][number] {
  return {
    '@id': `urn:noocodex:dag:${dag}/node/${name}`,
    '@type': 'TerminalNode',
    name,
    outcome,
  };
}

function embedNode(
  dag: string,
  name: string,
  childDag: string,
  outputs: Record<string, string>,
  stateMapping: { input: Record<string, string>; output: Record<string, string> },
): DAGType['nodes'][number] {
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
// ValueState — numeric value + log; used across all three test suites.
// ===========================================================================

class ValueState extends NodeStateBase {
  value: number;
  log: string[];

  constructor() {
    super();
    this.value = 0;
    this.log = [];
  }

  override clone(): this {
    const copy = new ValueState() as this;
    copy.value = this.value;
    copy.log = [...this.log];
    return copy;
  }

  override snapshotData() {
    return { 'value': this.value, 'log': [...this.log] };
  }

  protected override restoreData(snap: Record<string, unknown>): void {
    const v = snap['value'];
    if (typeof v === 'number') this.value = v;
    const l = snap['log'];
    if (Array.isArray(l)) this.log = l as string[];
  }
}

// ===========================================================================
// Shared node helpers
// ===========================================================================

class TestBatchNode {
  private constructor() { /* static class */ }

  // Fan-out node: takes a size-1 batch and emits N items with the given values.
  static fanOut(name: string, values: number[]): MonadicNode<ValueState, 'out'> {
    class FanOutNode extends MonadicNode<ValueState, 'out'> {
      readonly name: string;
      readonly outputs = ['out'] as const;

      constructor(
        nodeName: string,
        private readonly values: number[],
      ) {
        super();
        this.name = nodeName;
      }

      override async execute(batch: Batch<ValueState>, _ctx: NodeContextType): Promise<RoutedBatchType<'out', ValueState>> {
        const source = batch.row(0).state;
        const items: Array<ItemType<ValueState>> = [];
        for (let i = 0; i < this.values.length; i++) {
          const clone = source.clone();
          const v = this.values[i] as number;
          clone.value = v;
          clone.log.push(`fan:${v}`);
          items.push({ 'id': String(i), 'state': clone });
        }
        const result = new Map<'out', Batch<ValueState>>();
        result.set('out', Batch.from(items));
        return result;
      }
    }
    return new FanOutNode(name, values);
  }

  // Accumulator node: collects all items into an external array, passes through.
  static accumulator(name: string, collected: ValueState[]): MonadicNode<ValueState, 'done'> {
    class AccumulatorNode extends MonadicNode<ValueState, 'done'> {
      readonly name: string;
      readonly outputs = ['done'] as const;

      constructor(
        nodeName: string,
        private readonly collected: ValueState[],
      ) {
        super();
        this.name = nodeName;
      }

      override async execute(batch: Batch<ValueState>, _ctx: NodeContextType): Promise<RoutedBatchType<'done', ValueState>> {
        for (const item of batch) {
          this.collected.push(item.state);
        }
        const result = new Map<'done', Batch<ValueState>>();
        result.set('done', batch);
        return result;
      }
    }
    return new AccumulatorNode(name, collected);
  }
}

// ===========================================================================
// Test (a): Multi-item batch splits and re-converges at one terminal
//
// DAG shape:
//   fanout(values=[5,-3,7]) → dispatch(value>0→high, else→low)
//   → [high-branch(+100) | low-branch(-100)] → converge(*2) → acc → finish
//
// Assertions:
//   - terminalOutcome === 'completed'
//   - converge fires exactly ONCE over all 3 items (batch-native coalescing)
//   - final values: 5→(105*2=210), -3→(-103*2=-206), 7→(107*2=214)
// ===========================================================================

void describe('Batch-native executor — Fix 1: multi-item batch re-converges at one terminal', () => {
  void it('3 items split across high/low branches then converge at a single terminal', async () => {
    // Dispatch node: routes value > 0 → 'high', else → 'low'.
    class DispatchNode extends MonadicNode<ValueState, 'high' | 'low'> {
      readonly name = 'dispatch';
      readonly outputs = ['high', 'low'] as const;

      override async execute(batch: Batch<ValueState>, _ctx: NodeContextType): Promise<RoutedBatchType<'high' | 'low', ValueState>> {
        const high: Array<ItemType<ValueState>> = [];
        const low: Array<ItemType<ValueState>> = [];
        for (const item of batch) {
          if (item.state.value > 0) {
            high.push(item);
          } else {
            low.push(item);
          }
        }
        const result = new Map<'high' | 'low', Batch<ValueState>>();
        if (high.length > 0) result.set('high', Batch.from(high));
        if (low.length > 0) result.set('low', Batch.from(low));
        return result;
      }
    }

    // High-branch: adds 100 to value.
    class HighBranchNode extends MonadicNode<ValueState, 'done'> {
      readonly name = 'high-branch';
      readonly outputs = ['done'] as const;

      override async execute(batch: Batch<ValueState>, _ctx: NodeContextType): Promise<RoutedBatchType<'done', ValueState>> {
        for (const item of batch) {
          item.state.value += 100;
          item.state.log.push('high');
        }
        const result = new Map<'done', Batch<ValueState>>();
        result.set('done', batch);
        return result;
      }
    }

    // Low-branch: subtracts 100 from value.
    class LowBranchNode extends MonadicNode<ValueState, 'done'> {
      readonly name = 'low-branch';
      readonly outputs = ['done'] as const;

      override async execute(batch: Batch<ValueState>, _ctx: NodeContextType): Promise<RoutedBatchType<'done', ValueState>> {
        for (const item of batch) {
          item.state.value -= 100;
          item.state.log.push('low');
        }
        const result = new Map<'done', Batch<ValueState>>();
        result.set('done', batch);
        return result;
      }
    }

    // Converge node: multiplies each value by 2. Tracks how many times it fires.
    const convergeFirings: number[] = [];
    class ConvergeNode extends MonadicNode<ValueState, 'done'> {
      readonly name = 'converge';
      readonly outputs = ['done'] as const;

      override async execute(batch: Batch<ValueState>, _ctx: NodeContextType): Promise<RoutedBatchType<'done', ValueState>> {
        convergeFirings.push(batch.size);
        for (const item of batch) {
          item.state.value *= 2;
          item.state.log.push('converge');
        }
        const result = new Map<'done', Batch<ValueState>>();
        result.set('done', batch);
        return result;
      }
    }

    const collected: ValueState[] = [];

    const dag = TestDag.of('bne-converge', 'fan', [
      singleNode('bne-converge', 'fan', 'fanout', { 'out': 'dispatch' }),
      singleNode('bne-converge', 'dispatch', 'dispatch', { 'high': 'high-step', 'low': 'low-step' }),
      singleNode('bne-converge', 'high-step', 'high-branch', { 'done': 'converge-step' }),
      singleNode('bne-converge', 'low-step', 'low-branch', { 'done': 'converge-step' }),
      singleNode('bne-converge', 'converge-step', 'converge', { 'done': 'acc-step' }),
      singleNode('bne-converge', 'acc-step', 'acc', { 'done': 'finish' }),
      terminalNode('bne-converge', 'finish', 'completed'),
    ]);

    const dispatcher = new Dagonizer<ValueState>();
    dispatcher.registerNode(TestBatchNode.fanOut('fanout', [5, -3, 7]));
    dispatcher.registerNode(new DispatchNode());
    dispatcher.registerNode(new HighBranchNode());
    dispatcher.registerNode(new LowBranchNode());
    dispatcher.registerNode(new ConvergeNode());
    dispatcher.registerNode(TestBatchNode.accumulator('acc', collected));
    dispatcher.registerDAG(dag);

    const result = await dispatcher.execute('bne-converge', new ValueState());

    assert.equal(result.terminalOutcome, 'completed');

    // converge fires exactly once over all 3 items (rank coalescing).
    assert.deepEqual(convergeFirings, [3], 'converge must fire exactly once over all 3 items');

    // All 3 items collected at the accumulator before terminal.
    assert.equal(collected.length, 3, 'all 3 items reach acc');

    // Verify final values: 5→105→210, -3→-103→-206, 7→107→214.
    const values = collected.map((s) => s.value).sort((a, b) => a - b);
    assert.deepEqual(values, [-206, 210, 214], 'final values match expected transforms');

    // Verify each item's branch was correct.
    const negItem = collected.find((s) => s.value === -206);
    assert.ok(negItem?.log.includes('low'), '-3 item went through low-branch');
    const pos105Item = collected.find((s) => s.value === 210);
    assert.ok(pos105Item?.log.includes('high'), '5 item went through high-branch');
    const pos107Item = collected.find((s) => s.value === 214);
    assert.ok(pos107Item?.log.includes('high'), '7 item went through high-branch');
  });
});

// ===========================================================================
// Test (b): Multi-item batch reaches DIFFERENT terminals
//
// DAG shape:
//   fanout(values=[1,-1]) → router(value>0→'success-term', else→'failure-term')
//   success-term: TerminalNode outcome='completed'
//   failure-term: TerminalNode outcome='failed'
//
// Assertions:
//   - terminalOutcome === 'failed' (any 'failed' terminal → overall failed)
//   - executedNodes includes 'router', 'success-term', 'failure-term'
// ===========================================================================

void describe('Batch-native executor — Fix 1: multi-item batch reaches different terminals', () => {
  void it('items routed to different terminals; overall outcome is failed when any item reaches a failed terminal', async () => {
    // Router node: routes value > 0 → 'success-path', else → 'failure-path'.
    class RouterNode extends MonadicNode<ValueState, 'success-path' | 'failure-path'> {
      readonly name = 'router';
      readonly outputs = ['success-path', 'failure-path'] as const;

      override async execute(batch: Batch<ValueState>, _ctx: NodeContextType): Promise<RoutedBatchType<'success-path' | 'failure-path', ValueState>> {
        const success: Array<ItemType<ValueState>> = [];
        const failure: Array<ItemType<ValueState>> = [];
        for (const item of batch) {
          if (item.state.value > 0) {
            success.push(item);
          } else {
            failure.push(item);
          }
        }
        const result = new Map<'success-path' | 'failure-path', Batch<ValueState>>();
        if (success.length > 0) result.set('success-path', Batch.from(success));
        if (failure.length > 0) result.set('failure-path', Batch.from(failure));
        return result;
      }
    }

    const dag = TestDag.of('bne-diverge', 'fan', [
      singleNode('bne-diverge', 'fan', 'fanout', { 'out': 'router-step' }),
      singleNode('bne-diverge', 'router-step', 'router', {
        'success-path': 'success-term',
        'failure-path': 'failure-term',
      }),
      terminalNode('bne-diverge', 'success-term', 'completed'),
      terminalNode('bne-diverge', 'failure-term', 'failed'),
    ]);

    const dispatcher = new Dagonizer<ValueState>();
    dispatcher.registerNode(TestBatchNode.fanOut('fanout', [1, -1]));
    dispatcher.registerNode(new RouterNode());
    dispatcher.registerDAG(dag);

    const result = await dispatcher.execute('bne-diverge', new ValueState());

    // Any item reaching a 'failed' terminal makes the overall outcome 'failed'.
    assert.equal(result.terminalOutcome, 'failed', 'overall outcome is failed when any item reaches a failed terminal');

    // Both terminals must have been visited.
    assert.ok(result.executedNodes.includes('router-step'), 'router-step executed');
    assert.ok(result.executedNodes.includes('success-term'), 'success-term executed');
    assert.ok(result.executedNodes.includes('failure-term'), 'failure-term executed');
  });
});

// ===========================================================================
// Test (c): EmbeddedDAG multi-item batch parity
//
// Verifies that Fix 3 (batch-native embedded DAG path) produces the same
// output values as the per-item path.
//
// Child DAG: inc(+10) → child-end(completed)
// Parent DAG: fanout(values=[1,2,3]) → embed-child → acc → finish
//
// State mapping: { input: { value: value }, output: { value: value } }
//
// Assertions:
//   - terminalOutcome === 'completed'
//   - each item's final value equals original + 10 (i.e. 11, 12, 13)
//   - the child's inc node receives each item's distinct value (batch-native)
// ===========================================================================

void describe('Batch-native executor — Fix 3: EmbeddedDAG batch-native parity', () => {
  void it('child DAG runs batch-native over N=3 items; each item value incremented by 10', async () => {
    const childItemsSeen: number[] = [];

    class IncNode extends MonadicNode<ValueState, 'done'> {
      readonly name = 'inc';
      readonly outputs = ['done'] as const;

      constructor(private readonly seen: number[]) {
        super();
      }

      override async execute(batch: Batch<ValueState>, _ctx: NodeContextType): Promise<RoutedBatchType<'done', ValueState>> {
        for (const item of batch) {
          this.seen.push(item.state.value);
          item.state.value += 10;
          item.state.log.push(`inc:${item.state.value}`);
        }
        const result = new Map<'done', Batch<ValueState>>();
        result.set('done', batch);
        return result;
      }
    }

    const childDAG = TestDag.of('bne-child', 'inc-step', [
      singleNode('bne-child', 'inc-step', 'inc', { 'done': 'child-end' }),
      terminalNode('bne-child', 'child-end', 'completed'),
    ]);

    const valueMapping = { 'input': { 'value': 'value' }, 'output': { 'value': 'value' } } as const;

    const collected: ValueState[] = [];

    const parentDAG = TestDag.of('bne-parent', 'fan', [
      singleNode('bne-parent', 'fan', 'fanout', { 'out': 'embed-step' }),
      embedNode(
        'bne-parent',
        'embed-step',
        'bne-child',
        { 'success': 'acc-step', 'error': 'finish' },
        valueMapping,
      ),
      singleNode('bne-parent', 'acc-step', 'acc', { 'done': 'finish' }),
      terminalNode('bne-parent', 'finish', 'completed'),
    ]);

    const dispatcher = new Dagonizer<ValueState>();
    dispatcher.registerNode(TestBatchNode.fanOut('fanout', [1, 2, 3]));
    dispatcher.registerNode(new IncNode(childItemsSeen));
    dispatcher.registerNode(TestBatchNode.accumulator('acc', collected));
    dispatcher.registerDAG(childDAG);
    dispatcher.registerDAG(parentDAG);

    const result = await dispatcher.execute('bne-parent', new ValueState());

    assert.equal(result.terminalOutcome, 'completed');

    // All 3 items collected.
    assert.equal(collected.length, 3, 'all 3 items reach accumulator');

    // Each item's value incremented by 10.
    const values = collected.map((s) => s.value).sort((a, b) => a - b);
    assert.deepEqual(values, [11, 12, 13], 'each item value incremented by 10 via child DAG');

    // inc node received each distinct starting value (batch-native: single firing
    // over all 3 items; the childItemsSeen will have 3 entries from one batch call).
    assert.equal(childItemsSeen.length, 3, 'inc node processed exactly 3 items');
    const seenSorted = [...childItemsSeen].sort((a, b) => a - b);
    assert.deepEqual(seenSorted, [1, 2, 3], 'inc node received each item with its original value');
  });

  void it('single-item embedded DAG parity: batch-native path matches per-item value (value=42)', async () => {
    // Regression guard: size-1 batch must produce the same result as before.
    class IncNode42 extends MonadicNode<ValueState, 'done'> {
      readonly name = 'inc42';
      readonly outputs = ['done'] as const;

      override async execute(batch: Batch<ValueState>, _ctx: NodeContextType): Promise<RoutedBatchType<'done', ValueState>> {
        for (const item of batch) {
          item.state.value += 10;
        }
        const result = new Map<'done', Batch<ValueState>>();
        result.set('done', batch);
        return result;
      }
    }

    const childDAG = TestDag.of('bne-child42', 'inc-step', [
      singleNode('bne-child42', 'inc-step', 'inc42', { 'done': 'child-end' }),
      terminalNode('bne-child42', 'child-end', 'completed'),
    ]);

    const valueMapping = { 'input': { 'value': 'value' }, 'output': { 'value': 'value' } } as const;

    const parentDAG = TestDag.of('bne-parent42', 'entry', [
      singleNode('bne-parent42', 'entry', 'entry-node', { 'ok': 'embed-step' }),
      embedNode(
        'bne-parent42',
        'embed-step',
        'bne-child42',
        { 'success': 'finish', 'error': 'finish' },
        valueMapping,
      ),
      terminalNode('bne-parent42', 'finish', 'completed'),
    ]);

    // Passthrough entry node.
    class EntryNode extends MonadicNode<ValueState, 'ok'> {
      readonly name = 'entry-node';
      readonly outputs = ['ok'] as const;

      override async execute(batch: Batch<ValueState>, _ctx: NodeContextType): Promise<RoutedBatchType<'ok', ValueState>> {
        const result = new Map<'ok', Batch<ValueState>>();
        result.set('ok', batch);
        return result;
      }
    }

    const dispatcher = new Dagonizer<ValueState>();
    dispatcher.registerNode(new EntryNode());
    dispatcher.registerNode(new IncNode42());
    dispatcher.registerDAG(childDAG);
    dispatcher.registerDAG(parentDAG);

    const initial = new ValueState();
    initial.value = 42;

    const result = await dispatcher.execute('bne-parent42', initial);

    assert.equal(result.terminalOutcome, 'completed');
    assert.equal(result.state.value, 52, 'size-1 embed: value 42 + 10 = 52');
  });
});
