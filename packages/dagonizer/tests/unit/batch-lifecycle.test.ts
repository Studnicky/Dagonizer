/**
 * Batch lifecycle tests: `Dagonizer.executeBatch()` / `NodeScheduler.run()`
 * per-item lifecycle contract for a genuine multi-item batch (batch.size > 1).
 *
 * Covers:
 *   - every input item's lifecycle starts and every item that reaches a
 *     successful terminal completes, not just the representative item
 *   - a mixed batch where one non-representative item parks: the parked
 *     item's lifecycle stops at 'awaiting-input' while its siblings
 *     continue to their own terminals; the aggregate terminalOutcome does
 *     not falsely resolve while any item is still parked
 *   - a failed terminal marks only the items that reached it 'failed',
 *     leaving sibling items that reached a completed terminal 'completed'
 *   - a thrown node error, and an aborted signal, leave every input item's
 *     lifecycle in a terminal variant — never 'pending' or 'running'
 *   - a pre-phase placement receives the full batch exactly once, for both
 *     the size-1 and the batch-native (N>1) path
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Dagonizer } from '../../src/Dagonizer.js';
import { Batch } from '../../src/entities/batch/Batch.js';
import type { ItemType } from '../../src/entities/batch/Item.js';
import type { DAGType } from '../../src/entities/dag/DAG.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';
import { TestBatchNode } from '../_support/TestBatchNode.js';
import { TestDag } from '../_support/TestDag.js';

const placementIri = TestDag.placementIri;

class PlacementFixture {
  private constructor() { /* static class */ }

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

  static phaseNode(dag: string, name: string, node: string, phase: 'pre' | 'post'): DAGType['nodes'][number] {
    return {
      '@id': placementIri(dag, name),
      '@type': 'PhaseNode',
      name,
      node,
      phase,
    };
  }
}

// ===========================================================================
// (1) executeBatch starts every input state and completes every item that
//     reaches a successful terminal — not just the representative item.
// ===========================================================================

class WorkState extends NodeStateBase {
  value = 0;
  log: string[] = [];
}

void describe('Batch lifecycle — every item starts and completes, not just the representative', () => {
  void it('a 3-item batch: every item lifecycle reaches completed and carries its own mutation', async () => {
    const DAG_IRI = 'urn:noocodec:dag:lifecycle-all-complete';
    const MARK_NODE_IRI = 'urn:noocodec:node:lifecycle-mark';

    const dag = TestDag.of(DAG_IRI, placementIri(DAG_IRI, 'mark'), [
      PlacementFixture.singleNode(DAG_IRI, 'mark', MARK_NODE_IRI, { 'done': placementIri(DAG_IRI, 'finish') }),
      PlacementFixture.terminalNode(DAG_IRI, 'finish', 'completed'),
    ]);

    const dispatcher = new Dagonizer<WorkState>();
    dispatcher.registerNode(TestBatchNode.of<WorkState, 'done'>(MARK_NODE_IRI, ['done'], (batch) => {
      for (const item of batch) {
        item.state.value += 1;
        item.state.log.push('marked');
      }
      const r = new Map<'done', Batch<WorkState>>();
      r.set('done', batch);
      return r;
    }));
    dispatcher.registerDAG(dag);

    const items: Array<ItemType<WorkState>> = [0, 10, 20].map((value, i) => {
      const state = new WorkState();
      state.value = value;
      return { 'id': String(i), 'state': state };
    });
    const batch = Batch.from(items);
    const terminalByItemId = new Map<string, 'completed' | 'failed'>();

    const result = await dispatcher.executeBatch(DAG_IRI, batch, terminalByItemId);

    assert.equal(result.terminalOutcome, 'completed');

    for (const item of items) {
      assert.equal(item.state.lifecycle.variant, 'completed', `item ${item.id} lifecycle must be completed`);
      assert.equal(terminalByItemId.get(item.id), 'completed', `item ${item.id} recorded as completed`);
    }

    // Every item's own mutation survived (not just the representative row(0)).
    assert.deepEqual(items.map((item) => item.state.value), [1, 11, 21]);
    assert.ok(items.every((item) => item.state.log.includes('marked')), 'every item was individually processed');
  });
});

// ===========================================================================
// (2) A mixed batch where a non-representative item routes to 'parked'
//     leaves that exact state awaiting-input while siblings continue to
//     their own terminals; the aggregate must not falsely report one
//     terminal outcome while an item is parked.
// ===========================================================================

class TriageState extends NodeStateBase {
  category: 'routine' | 'offtopic' | 'review' = 'routine';
}

void describe('Batch lifecycle — mixed batch with a non-representative parked item', () => {
  void it('parked item stays awaiting-input while routine/off-topic siblings complete; aggregate outcome is not falsely reported', async () => {
    const DAG_IRI = 'urn:noocodec:dag:lifecycle-mixed-park';
    const TRIAGE_NODE_IRI = 'urn:noocodec:node:lifecycle-triage';

    const dag = TestDag.of(DAG_IRI, placementIri(DAG_IRI, 'triage'), [
      PlacementFixture.singleNode(DAG_IRI, 'triage', TRIAGE_NODE_IRI, {
        'routine':  placementIri(DAG_IRI, 'routine-term'),
        'offtopic': placementIri(DAG_IRI, 'offtopic-term'),
      }),
      PlacementFixture.terminalNode(DAG_IRI, 'routine-term', 'completed'),
      PlacementFixture.terminalNode(DAG_IRI, 'offtopic-term', 'completed'),
    ]);

    const dispatcher = new Dagonizer<TriageState>();
    dispatcher.registerNode(TestBatchNode.of<TriageState, 'parked' | 'routine' | 'offtopic'>(TRIAGE_NODE_IRI, ['parked', 'routine', 'offtopic'], (batch) => {
      const routine: Array<ItemType<TriageState>> = [];
      const offtopic: Array<ItemType<TriageState>> = [];
      const parked: Array<ItemType<TriageState>> = [];
      for (const item of batch) {
        if (item.state.category === 'review') {
          item.state.setMetadata('correlationKey', `ck-${item.id}`);
          parked.push(item);
        } else if (item.state.category === 'offtopic') {
          offtopic.push(item);
        } else {
          routine.push(item);
        }
      }
      const r = new Map<'parked' | 'routine' | 'offtopic', Batch<TriageState>>();
      if (routine.length > 0) r.set('routine', Batch.from(routine));
      if (offtopic.length > 0) r.set('offtopic', Batch.from(offtopic));
      if (parked.length > 0) r.set('parked', Batch.from(parked));
      return r;
    }));
    dispatcher.registerDAG(dag);

    const categories: Array<TriageState['category']> = ['routine', 'review', 'offtopic'];
    const items: Array<ItemType<TriageState>> = categories.map((category, i) => {
      const state = new TriageState();
      state.category = category;
      return { 'id': String(i), 'state': state };
    });
    const batch = Batch.from(items);
    const terminalByItemId = new Map<string, 'completed' | 'failed'>();

    // The parked item ('1') is deliberately NOT the representative (row(0)) item.
    assert.equal(batch.row(0).id, '0');
    assert.equal(items[1]?.state.category, 'review');

    const result = await dispatcher.executeBatch(DAG_IRI, batch, terminalByItemId);

    const [routineItem, parkedItem, offtopicItem] = items;
    if (routineItem === undefined || parkedItem === undefined || offtopicItem === undefined) {
      throw new Error('fixture invariant: 3 items expected');
    }

    // Parked item: stopped at awaiting-input, correlation key recorded, never
    // reached a terminal.
    assert.equal(parkedItem.state.lifecycle.variant, 'awaiting-input');
    assert.equal(parkedItem.state.parked, true);
    assert.equal(parkedItem.state.getMetadata('correlationKey'), 'ck-1');
    assert.equal(terminalByItemId.has('1'), false, 'parked item never reaches a terminal');

    // Siblings: each continues to its own terminal and completes independently.
    assert.equal(routineItem.state.lifecycle.variant, 'completed');
    assert.equal(terminalByItemId.get('0'), 'completed');
    assert.equal(offtopicItem.state.lifecycle.variant, 'completed');
    assert.equal(terminalByItemId.get('2'), 'completed');

    // Aggregate must not falsely report a single terminal outcome while one
    // item is still parked.
    assert.equal(result.terminalOutcome, null, 'aggregate outcome must not resolve while an item is parked');
    assert.equal(result.parked, null, 'result.parked is only populated on the size-1 early-return path');
    assert.ok(result.executedNodes.includes('routine-term'));
    assert.ok(result.executedNodes.includes('offtopic-term'));
  });
});

// ===========================================================================
// (3) A failed terminal marks only its item failed while other successful
//     items complete.
// ===========================================================================

class RouteState extends NodeStateBase {
  value = 0;
}

void describe('Batch lifecycle — failed terminal marks only its own item failed', () => {
  void it('one item reaches a failed terminal, the other reaches a completed terminal', async () => {
    const DAG_IRI = 'urn:noocodec:dag:lifecycle-mixed-outcome';
    const ROUTER_NODE_IRI = 'urn:noocodec:node:lifecycle-router';

    const dag = TestDag.of(DAG_IRI, placementIri(DAG_IRI, 'router'), [
      PlacementFixture.singleNode(DAG_IRI, 'router', ROUTER_NODE_IRI, {
        'success-path': placementIri(DAG_IRI, 'success-term'),
        'failure-path': placementIri(DAG_IRI, 'failure-term'),
      }),
      PlacementFixture.terminalNode(DAG_IRI, 'success-term', 'completed'),
      PlacementFixture.terminalNode(DAG_IRI, 'failure-term', 'failed'),
    ]);

    const dispatcher = new Dagonizer<RouteState>();
    dispatcher.registerNode(TestBatchNode.of<RouteState, 'success-path' | 'failure-path'>(ROUTER_NODE_IRI, ['success-path', 'failure-path'], (batch) => {
      const success: Array<ItemType<RouteState>> = [];
      const failure: Array<ItemType<RouteState>> = [];
      for (const item of batch) {
        if (item.state.value > 0) {
          success.push(item);
        } else {
          failure.push(item);
        }
      }
      const r = new Map<'success-path' | 'failure-path', Batch<RouteState>>();
      if (success.length > 0) r.set('success-path', Batch.from(success));
      if (failure.length > 0) r.set('failure-path', Batch.from(failure));
      return r;
    }));
    dispatcher.registerDAG(dag);

    const successState = new RouteState();
    successState.value = 1;
    const failureState = new RouteState();
    failureState.value = -1;
    const items: Array<ItemType<RouteState>> = [
      { 'id': '0', 'state': successState },
      { 'id': '1', 'state': failureState },
    ];
    const batch = Batch.from(items);
    const terminalByItemId = new Map<string, 'completed' | 'failed'>();

    const result = await dispatcher.executeBatch(DAG_IRI, batch, terminalByItemId);

    assert.equal(successState.lifecycle.variant, 'completed', 'the successful item completes');
    assert.equal(terminalByItemId.get('0'), 'completed');

    assert.equal(failureState.lifecycle.variant, 'failed', 'only the item that reached the failed terminal is failed');
    assert.equal(terminalByItemId.get('1'), 'failed');

    // Any item reaching a failed terminal makes the overall (aggregate) outcome failed.
    assert.equal(result.terminalOutcome, 'failed');
    assert.ok(result.executedNodes.includes('success-term'));
    assert.ok(result.executedNodes.includes('failure-term'));
  });
});

// ===========================================================================
// (4) A thrown node error, and an aborted signal, leave no input state
//     pending or running.
// ===========================================================================

class FailureState extends NodeStateBase {
  value = 0;
}

void describe('Batch lifecycle — thrown error and abort leave no item pending or running', () => {
  void it('a thrown node error fails every item in the batch', async () => {
    const DAG_IRI = 'urn:noocodec:dag:lifecycle-thrown';
    const BOOM_NODE_IRI = 'urn:noocodec:node:lifecycle-boom';

    const dag = TestDag.of(DAG_IRI, placementIri(DAG_IRI, 'boom'), [
      PlacementFixture.singleNode(DAG_IRI, 'boom', BOOM_NODE_IRI, { 'done': placementIri(DAG_IRI, 'finish') }),
      PlacementFixture.terminalNode(DAG_IRI, 'finish', 'completed'),
    ]);

    const dispatcher = new Dagonizer<FailureState>();
    dispatcher.registerNode(TestBatchNode.of<FailureState, 'done'>(BOOM_NODE_IRI, ['done'], async () => {
      throw new Error('boom');
    }));
    dispatcher.registerDAG(dag);

    const items: Array<ItemType<FailureState>> = [0, 1, 2].map((i) => ({ 'id': String(i), 'state': new FailureState() }));
    const batch = Batch.from(items);
    const terminalByItemId = new Map<string, 'completed' | 'failed'>();

    const result = await dispatcher.executeBatch(DAG_IRI, batch, terminalByItemId);

    assert.equal(result.terminalOutcome, null, 'no item ever reached a terminal placement');
    for (const item of items) {
      assert.equal(item.state.lifecycle.variant, 'failed', `item ${item.id} must be failed, not pending or running`);
      assert.notEqual(item.state.lifecycle.variant, 'pending');
      assert.notEqual(item.state.lifecycle.variant, 'running');
    }
  });

  void it('an already-aborted signal cancels every item in the batch before any placement fires', async () => {
    const DAG_IRI = 'urn:noocodec:dag:lifecycle-abort';
    const PASS_NODE_IRI = 'urn:noocodec:node:lifecycle-pass';

    const dag = TestDag.of(DAG_IRI, placementIri(DAG_IRI, 'pass'), [
      PlacementFixture.singleNode(DAG_IRI, 'pass', PASS_NODE_IRI, { 'done': placementIri(DAG_IRI, 'finish') }),
      PlacementFixture.terminalNode(DAG_IRI, 'finish', 'completed'),
    ]);

    const dispatcher = new Dagonizer<FailureState>();
    dispatcher.registerNode(TestBatchNode.of<FailureState, 'done'>(PASS_NODE_IRI, ['done'], (batch) => {
      const r = new Map<'done', Batch<FailureState>>();
      r.set('done', batch);
      return r;
    }));
    dispatcher.registerDAG(dag);

    const items: Array<ItemType<FailureState>> = [0, 1, 2].map((i) => ({ 'id': String(i), 'state': new FailureState() }));
    const batch = Batch.from(items);
    const terminalByItemId = new Map<string, 'completed' | 'failed'>();

    const controller = new AbortController();
    controller.abort(new Error('stop-now'));

    const result = await dispatcher.executeBatch(DAG_IRI, batch, terminalByItemId, { 'signal': controller.signal });

    assert.ok(result.interruptedAt !== null, 'result records the interruption');
    assert.equal(result.interruptedAt?.reason, 'abort');
    assert.equal(result.terminalOutcome, null, 'no item ever reached a terminal placement');
    for (const item of items) {
      assert.equal(item.state.lifecycle.variant, 'cancelled', `item ${item.id} must be cancelled, not pending or running`);
      assert.notEqual(item.state.lifecycle.variant, 'pending');
      assert.notEqual(item.state.lifecycle.variant, 'running');
    }
  });
});

// ===========================================================================
// (5) A pre-phase placement receives the full batch exactly once, and
//     preserves the established size-1 behavior.
// ===========================================================================

class PhaseState extends NodeStateBase {
  value = 0;
}

void describe('Batch lifecycle — pre-phase placement receives the full batch exactly once', () => {
  void it('size-1 execute(): the pre-phase fires once over a single-item batch (established behavior)', async () => {
    const DAG_IRI = 'urn:noocodec:dag:lifecycle-phase-single';
    const SETUP_NODE_IRI = 'urn:noocodec:node:lifecycle-setup-single';
    const PASS_NODE_IRI = 'urn:noocodec:node:lifecycle-pass-single';

    const calls: Array<{ size: number; ids: readonly string[] }> = [];

    const dag = TestDag.of(DAG_IRI, placementIri(DAG_IRI, 'pass'), [
      PlacementFixture.phaseNode(DAG_IRI, 'setup', SETUP_NODE_IRI, 'pre'),
      PlacementFixture.singleNode(DAG_IRI, 'pass', PASS_NODE_IRI, { 'done': placementIri(DAG_IRI, 'finish') }),
      PlacementFixture.terminalNode(DAG_IRI, 'finish', 'completed'),
    ]);

    const dispatcher = new Dagonizer<PhaseState>();
    dispatcher.registerNode(TestBatchNode.of<PhaseState, 'ok'>(SETUP_NODE_IRI, ['ok'], (batch) => {
      calls.push({ 'size': batch.size, 'ids': batch.ids() });
      const r = new Map<'ok', Batch<PhaseState>>();
      r.set('ok', batch);
      return r;
    }));
    dispatcher.registerNode(TestBatchNode.of<PhaseState, 'done'>(PASS_NODE_IRI, ['done'], (batch) => {
      const r = new Map<'done', Batch<PhaseState>>();
      r.set('done', batch);
      return r;
    }));
    dispatcher.registerDAG(dag);

    const result = await dispatcher.execute(DAG_IRI, new PhaseState());

    assert.equal(result.terminalOutcome, 'completed');
    assert.equal(calls.length, 1, 'pre-phase placement fires exactly once');
    assert.deepEqual(calls[0], { 'size': 1, 'ids': ['0'] });
  });

  void it('batch-native executeBatch(): the pre-phase fires once over the full N-item batch, not once per item', async () => {
    const DAG_IRI = 'urn:noocodec:dag:lifecycle-phase-batch';
    const SETUP_NODE_IRI = 'urn:noocodec:node:lifecycle-setup-batch';
    const PASS_NODE_IRI = 'urn:noocodec:node:lifecycle-pass-batch';

    const calls: Array<{ size: number; ids: readonly string[] }> = [];

    const dag = TestDag.of(DAG_IRI, placementIri(DAG_IRI, 'pass'), [
      PlacementFixture.phaseNode(DAG_IRI, 'setup', SETUP_NODE_IRI, 'pre'),
      PlacementFixture.singleNode(DAG_IRI, 'pass', PASS_NODE_IRI, { 'done': placementIri(DAG_IRI, 'finish') }),
      PlacementFixture.terminalNode(DAG_IRI, 'finish', 'completed'),
    ]);

    const dispatcher = new Dagonizer<PhaseState>();
    dispatcher.registerNode(TestBatchNode.of<PhaseState, 'ok'>(SETUP_NODE_IRI, ['ok'], (batch) => {
      calls.push({ 'size': batch.size, 'ids': batch.ids() });
      const r = new Map<'ok', Batch<PhaseState>>();
      r.set('ok', batch);
      return r;
    }));
    dispatcher.registerNode(TestBatchNode.of<PhaseState, 'done'>(PASS_NODE_IRI, ['done'], (batch) => {
      const r = new Map<'done', Batch<PhaseState>>();
      r.set('done', batch);
      return r;
    }));
    dispatcher.registerDAG(dag);

    const items: Array<ItemType<PhaseState>> = [0, 1, 2].map((i) => ({ 'id': String(i), 'state': new PhaseState() }));
    const batch = Batch.from(items);
    const terminalByItemId = new Map<string, 'completed' | 'failed'>();

    const result = await dispatcher.executeBatch(DAG_IRI, batch, terminalByItemId);

    assert.equal(result.terminalOutcome, 'completed');
    assert.equal(calls.length, 1, 'pre-phase placement fires exactly once for the whole batch');
    assert.deepEqual(calls[0], { 'size': 3, 'ids': ['0', '1', '2'] });
    for (const item of items) {
      assert.equal(item.state.lifecycle.variant, 'completed');
      assert.equal(terminalByItemId.get(item.id), 'completed');
    }
  });
});
