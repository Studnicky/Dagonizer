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

import type { SchemaObjectType } from '../../src/contracts/NodeInterface.js';
import { MonadicNode } from '../../src/core/MonadicNode.js';
import { Dagonizer } from '../../src/Dagonizer.js';
import { Batch } from '../../src/entities/batch/Batch.js';
import type { ItemType } from '../../src/entities/batch/Item.js';
import type { RoutedBatchType } from '../../src/entities/batch/RoutedBatchType.js';
import type { DAGType } from '../../src/entities/dag/DAG.js';
import type { NodeContextType } from '../../src/entities/node/NodeContext.js';
import { DagGraphProjector } from '../../src/graph/DagGraphProjector.js';
import { DagGraphQueries } from '../../src/graph/DagGraphQueries.js';
import { InMemoryTopologyStore } from '../../src/graph/InMemoryTopologyStore.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';
import { TestBatchNode } from '../_support/TestBatchNode.js';
import { TestDag } from '../_support/TestDag.js';

// ===========================================================================
// DAG builder helpers
// ===========================================================================

const placementIri = TestDag.placementIri;

class PlacementFixture {
  private constructor() {}

  static singleNode(dag: string, name: string, node: string, outputs: Record<string, string>): DAGType['nodes'][number] {
    return {
      '@id': placementIri(dag, name),
      '@type': 'SingleNode',
      name,
      node,
      outputs,
    };
  }

  static terminalNode(dag: string, name: string, outcome: 'completed' | 'failed'): DAGType['nodes'][number] {
    return {
      '@id': placementIri(dag, name),
      '@type': 'TerminalNode',
      name,
      outcome,
    };
  }

  static embedNode(
    dag: string,
    name: string,
    childDag: string,
    outputs: Record<string, string>,
    stateMapping: { input: Record<string, string>; output: Record<string, string> },
  ): DAGType['nodes'][number] {
    return {
      '@id': placementIri(dag, name),
      '@type': 'EmbeddedDAGNode',
      name,
      'dag': childDag,
      outputs,
      'stateMapping': stateMapping,
    };
  }
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
    const copy = super.clone();
    copy.value = this.value;
    copy.log = [...this.log];
    return copy;
  }


}

// ===========================================================================
// Shared node helpers — TestBatchNode.fanOut / TestBatchNode.accumulator
// imported from ../_support/TestBatchNode.js
// ===========================================================================

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
      readonly '@id' = 'urn:noocodec:node:dispatch';
      readonly outputs = ['high', 'low'] as const;
      override get outputSchema(): Record<string, SchemaObjectType> { return { 'high': { 'type': 'object' }, 'low': { 'type': 'object' } }; }

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
      readonly '@id' = 'urn:noocodec:node:high-branch';
      readonly outputs = ['done'] as const;
      override get outputSchema(): Record<string, SchemaObjectType> { return { 'done': { 'type': 'object' } }; }

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
      readonly '@id' = 'urn:noocodec:node:low-branch';
      readonly outputs = ['done'] as const;
      override get outputSchema(): Record<string, SchemaObjectType> { return { 'done': { 'type': 'object' } }; }

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
      readonly '@id' = 'urn:noocodec:node:converge';
      readonly outputs = ['done'] as const;
      override get outputSchema(): Record<string, SchemaObjectType> { return { 'done': { 'type': 'object' } }; }

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

    const dag = TestDag.of('urn:noocodec:dag:bne-converge', placementIri('urn:noocodec:dag:bne-converge', 'fan'), [
      PlacementFixture.singleNode('urn:noocodec:dag:bne-converge', 'fan', 'urn:noocodec:node:fanout', { 'out': placementIri('urn:noocodec:dag:bne-converge', 'dispatch') }),
      PlacementFixture.singleNode('urn:noocodec:dag:bne-converge', 'dispatch', 'urn:noocodec:node:dispatch', { 'high': placementIri('urn:noocodec:dag:bne-converge', 'high-step'), 'low': placementIri('urn:noocodec:dag:bne-converge', 'low-step') }),
      PlacementFixture.singleNode('urn:noocodec:dag:bne-converge', 'high-step', 'urn:noocodec:node:high-branch', { 'done': placementIri('urn:noocodec:dag:bne-converge', 'converge-step') }),
      PlacementFixture.singleNode('urn:noocodec:dag:bne-converge', 'low-step', 'urn:noocodec:node:low-branch', { 'done': placementIri('urn:noocodec:dag:bne-converge', 'converge-step') }),
      PlacementFixture.singleNode('urn:noocodec:dag:bne-converge', 'converge-step', 'urn:noocodec:node:converge', { 'done': placementIri('urn:noocodec:dag:bne-converge', 'acc-step') }),
      PlacementFixture.singleNode('urn:noocodec:dag:bne-converge', 'acc-step', 'urn:noocodec:node:acc', { 'done': placementIri('urn:noocodec:dag:bne-converge', 'finish') }),
      PlacementFixture.terminalNode('urn:noocodec:dag:bne-converge', 'finish', 'completed'),
    ]);

    const dispatcher = new Dagonizer<ValueState>();
    dispatcher.registerNode(TestBatchNode.of<ValueState, 'out'>('urn:noocodec:node:fanout', ['out'], (batch) => {
      const source = batch.row(0).state;
      const values = [5, -3, 7];
      const items: Array<ItemType<ValueState>> = values.map((v, i) => {
        const clone = source.clone();
        clone.value = v;
        clone.log.push(`fan:${v}`);
        return { 'id': String(i), 'state': clone };
      });
      const r = new Map<'out', Batch<ValueState>>();
      r.set('out', Batch.from(items));
      return r;
    }));
    dispatcher.registerNode(new DispatchNode());
    dispatcher.registerNode(new HighBranchNode());
    dispatcher.registerNode(new LowBranchNode());
    dispatcher.registerNode(new ConvergeNode());
    dispatcher.registerNode(TestBatchNode.of<ValueState, 'done'>('urn:noocodec:node:acc', ['done'], (batch) => {
      for (const item of batch) { collected.push(item.state); }
      const r = new Map<'done', Batch<ValueState>>();
      r.set('done', batch);
      return r;
    }));
    dispatcher.registerDAG(dag);

    const result = await dispatcher.execute('urn:noocodec:dag:bne-converge', new ValueState());

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
      readonly '@id' = 'urn:noocodec:node:router';
      readonly outputs = ['success-path', 'failure-path'] as const;
      override get outputSchema(): Record<string, SchemaObjectType> { return { 'success-path': { 'type': 'object' }, 'failure-path': { 'type': 'object' } }; }

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

    const dag = TestDag.of('urn:noocodec:dag:bne-diverge', placementIri('urn:noocodec:dag:bne-diverge', 'fan'), [
      PlacementFixture.singleNode('urn:noocodec:dag:bne-diverge', 'fan', 'urn:noocodec:node:fanout', { 'out': placementIri('urn:noocodec:dag:bne-diverge', 'router-step') }),
      PlacementFixture.singleNode('urn:noocodec:dag:bne-diverge', 'router-step', 'urn:noocodec:node:router', {
        'success-path': placementIri('urn:noocodec:dag:bne-diverge', 'success-term'),
        'failure-path': placementIri('urn:noocodec:dag:bne-diverge', 'failure-term'),
      }),
      PlacementFixture.terminalNode('urn:noocodec:dag:bne-diverge', 'success-term', 'completed'),
      PlacementFixture.terminalNode('urn:noocodec:dag:bne-diverge', 'failure-term', 'failed'),
    ]);

    const dispatcher = new Dagonizer<ValueState>();
    dispatcher.registerNode(TestBatchNode.of<ValueState, 'out'>('urn:noocodec:node:fanout', ['out'], (batch) => {
      const source = batch.row(0).state;
      const values = [1, -1];
      const items: Array<ItemType<ValueState>> = values.map((v, i) => {
        const clone = source.clone();
        clone.value = v;
        clone.log.push(`fan:${v}`);
        return { 'id': String(i), 'state': clone };
      });
      const r = new Map<'out', Batch<ValueState>>();
      r.set('out', Batch.from(items));
      return r;
    }));
    dispatcher.registerNode(new RouterNode());
    dispatcher.registerDAG(dag);

    const result = await dispatcher.execute('urn:noocodec:dag:bne-diverge', new ValueState());

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
      readonly '@id' = 'urn:noocodec:node:inc';
      readonly outputs = ['done'] as const;
      override get outputSchema(): Record<string, SchemaObjectType> { return { 'done': { 'type': 'object' } }; }

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

    const childDAG = TestDag.of('urn:noocodec:dag:bne-child', placementIri('urn:noocodec:dag:bne-child', 'inc-step'), [
      PlacementFixture.singleNode('urn:noocodec:dag:bne-child', 'inc-step', 'urn:noocodec:node:inc', { 'done': placementIri('urn:noocodec:dag:bne-child', 'child-end') }),
      PlacementFixture.terminalNode('urn:noocodec:dag:bne-child', 'child-end', 'completed'),
    ]);

    const valueMapping = { 'input': { 'value': 'value' }, 'output': { 'value': 'value' } } as const;

    const collected: ValueState[] = [];
    const store = new InMemoryTopologyStore();

    const parentDAG = TestDag.of('urn:noocodec:dag:bne-parent', placementIri('urn:noocodec:dag:bne-parent', 'fan'), [
      PlacementFixture.singleNode('urn:noocodec:dag:bne-parent', 'fan', 'urn:noocodec:node:fanout', { 'out': placementIri('urn:noocodec:dag:bne-parent', 'embed-step') }),
      PlacementFixture.embedNode(
        'urn:noocodec:dag:bne-parent',
        'embed-step',
        'urn:noocodec:dag:bne-child',
        { 'success': placementIri('urn:noocodec:dag:bne-parent', 'acc-step'), 'error': placementIri('urn:noocodec:dag:bne-parent', 'finish') },
        valueMapping,
      ),
      PlacementFixture.singleNode('urn:noocodec:dag:bne-parent', 'acc-step', 'urn:noocodec:node:acc', { 'done': placementIri('urn:noocodec:dag:bne-parent', 'finish') }),
      PlacementFixture.terminalNode('urn:noocodec:dag:bne-parent', 'finish', 'completed'),
    ]);

    const dispatcher = new Dagonizer<ValueState>({ 'executionTopologyStore': store });
    dispatcher.registerNode(TestBatchNode.of<ValueState, 'out'>('urn:noocodec:node:fanout', ['out'], (batch) => {
      const source = batch.row(0).state;
      const values = [1, 2, 3];
      const items: Array<ItemType<ValueState>> = values.map((v, i) => {
        const clone = source.clone();
        clone.value = v;
        clone.log.push(`fan:${v}`);
        return { 'id': String(i), 'state': clone };
      });
      const r = new Map<'out', Batch<ValueState>>();
      r.set('out', Batch.from(items));
      return r;
    }));
    dispatcher.registerNode(new IncNode(childItemsSeen));
    dispatcher.registerNode(TestBatchNode.of<ValueState, 'done'>('urn:noocodec:node:acc', ['done'], (batch) => {
      for (const item of batch) { collected.push(item.state); }
      const r = new Map<'done', Batch<ValueState>>();
      r.set('done', batch);
      return r;
    }));
    dispatcher.registerDAG(childDAG);
    dispatcher.registerDAG(parentDAG);

    const result = await dispatcher.execute('urn:noocodec:dag:bne-parent', new ValueState());

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
    assert.deepEqual(
      DagGraphQueries.selectedDagRows(store),
      [{
        'ownerIri': placementIri('urn:noocodec:dag:bne-parent', 'embed-step'),
        'dagIri':   DagGraphProjector.dagIri(childDAG),
      }],
    );
  });

  void it('single-item embedded DAG parity: batch-native path matches per-item value (value=42)', async () => {
    // Regression guard: size-1 batch must produce the same result as before.
    class IncNode42 extends MonadicNode<ValueState, 'done'> {
      readonly name = 'inc42';
      readonly '@id' = 'urn:noocodec:node:inc42';
      readonly outputs = ['done'] as const;
      override get outputSchema(): Record<string, SchemaObjectType> { return { 'done': { 'type': 'object' } }; }

      override async execute(batch: Batch<ValueState>, _ctx: NodeContextType): Promise<RoutedBatchType<'done', ValueState>> {
        for (const item of batch) {
          item.state.value += 10;
        }
        const result = new Map<'done', Batch<ValueState>>();
        result.set('done', batch);
        return result;
      }
    }

    const childDAG = TestDag.of('urn:noocodec:dag:bne-child42', placementIri('urn:noocodec:dag:bne-child42', 'inc-step'), [
      PlacementFixture.singleNode('urn:noocodec:dag:bne-child42', 'inc-step', 'urn:noocodec:node:inc42', { 'done': placementIri('urn:noocodec:dag:bne-child42', 'child-end') }),
      PlacementFixture.terminalNode('urn:noocodec:dag:bne-child42', 'child-end', 'completed'),
    ]);

    const valueMapping = { 'input': { 'value': 'value' }, 'output': { 'value': 'value' } } as const;

    const parentDAG = TestDag.of('urn:noocodec:dag:bne-parent42', placementIri('urn:noocodec:dag:bne-parent42', 'entry'), [
      PlacementFixture.singleNode('urn:noocodec:dag:bne-parent42', 'entry', 'urn:noocodec:node:entry-node', { 'ok': placementIri('urn:noocodec:dag:bne-parent42', 'embed-step') }),
      PlacementFixture.embedNode(
        'urn:noocodec:dag:bne-parent42',
        'embed-step',
        'urn:noocodec:dag:bne-child42',
        { 'success': placementIri('urn:noocodec:dag:bne-parent42', 'finish'), 'error': placementIri('urn:noocodec:dag:bne-parent42', 'finish') },
        valueMapping,
      ),
      PlacementFixture.terminalNode('urn:noocodec:dag:bne-parent42', 'finish', 'completed'),
    ]);

    // Passthrough entry node.
    class EntryNode extends MonadicNode<ValueState, 'ok'> {
      readonly name = 'entry-node';
      readonly '@id' = 'urn:noocodec:node:entry-node';
      readonly outputs = ['ok'] as const;
      override get outputSchema(): Record<string, SchemaObjectType> { return { 'ok': { 'type': 'object' } }; }

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

    const result = await dispatcher.execute('urn:noocodec:dag:bne-parent42', initial);

    assert.equal(result.terminalOutcome, 'completed');
    assert.equal(result.state.value, 52, 'size-1 embed: value 42 + 10 = 52');
  });
});
