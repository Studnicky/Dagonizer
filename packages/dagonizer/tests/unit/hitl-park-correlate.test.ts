/**
 * Unit tests for the HITL park-and-correlate primitive.
 *
 * Covers:
 *   - DAGLifecycleMachine: park event, isParked predicate, awaiting-input → running resume
 *   - NodeStateBase: park() method, parked getter
 *   - NodeScheduler: 'parked' output detection, ParkedType on result, resume re-entry
 *   - Checkpoint.capture: works on parked result (cursor is set)
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Checkpoint, CheckpointRestoreAdapter } from '../../src/checkpoint/Checkpoint.js';
import { Dagonizer } from '../../src/Dagonizer.js';
import { DAGLifecycleMachine } from '../../src/lifecycle/DAGLifecycleMachine.js';
import { NodeOutputBuilder } from '../../src/entities/node/NodeOutput.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';
import { TestDag } from '../_support/TestDag.js';
import { TestNode } from '../_support/TestNode.js';

// ---------------------------------------------------------------------------
// Shared state fixture
// ---------------------------------------------------------------------------

class HitlState extends NodeStateBase {
  decision = '';
  log: string[] = [];

  protected override snapshotData() {
    return { 'decision': this.decision, 'log': [...this.log] };
  }

  protected override restoreData(snap: Record<string, unknown>) {
    if (typeof snap['decision'] === 'string') this.decision = snap['decision'];
    if (Array.isArray(snap['log'])) this.log = snap['log'] as string[];
  }
}

// ---------------------------------------------------------------------------
// DAGLifecycleMachine — awaiting-input variant
// ---------------------------------------------------------------------------

void describe('DAGLifecycleMachine — park event', () => {
  void it('running + park → awaiting-input with correlationKey', () => {
    const running = DAGLifecycleMachine.transition(
      DAGLifecycleMachine.initial(),
      { 'type': 'start', 'at': 1000 },
    );
    assert.equal(running.variant, 'running');
    const parked = DAGLifecycleMachine.transition(running, { 'type': 'park', 'correlationKey': 'req-abc', 'at': 2000 });
    assert.equal(parked.variant, 'awaiting-input');
    if (parked.variant !== 'awaiting-input') throw new Error('expected awaiting-input');
    assert.equal(parked.correlationKey, 'req-abc');
    assert.equal(parked.finishedAt, null);
  });

  void it('isTerminal returns false for awaiting-input', () => {
    const running = DAGLifecycleMachine.transition(DAGLifecycleMachine.initial(), { 'type': 'start', 'at': 1 });
    const parked = DAGLifecycleMachine.transition(running, { 'type': 'park', 'correlationKey': 'k', 'at': 2 });
    assert.equal(DAGLifecycleMachine.isTerminal(parked), false);
  });

  void it('isParked returns true for awaiting-input', () => {
    const running = DAGLifecycleMachine.transition(DAGLifecycleMachine.initial(), { 'type': 'start', 'at': 1 });
    const parked = DAGLifecycleMachine.transition(running, { 'type': 'park', 'correlationKey': 'k', 'at': 2 });
    assert.equal(DAGLifecycleMachine.isParked(parked), true);
  });

  void it('awaiting-input + start → running (resume transition)', () => {
    const running = DAGLifecycleMachine.transition(DAGLifecycleMachine.initial(), { 'type': 'start', 'at': 1 });
    const parked = DAGLifecycleMachine.transition(running, { 'type': 'park', 'correlationKey': 'k', 'at': 2 });
    const resumed = DAGLifecycleMachine.transition(parked, { 'type': 'start', 'at': 3 });
    assert.equal(resumed.variant, 'running');
  });

  void it('initial state has correlationKey null', () => {
    const initial = DAGLifecycleMachine.initial();
    assert.equal(initial.correlationKey, null);
  });
});

// ---------------------------------------------------------------------------
// NodeStateBase — park() and parked getter
// ---------------------------------------------------------------------------

void describe('NodeStateBase — park()', () => {
  void it('park() transitions lifecycle to awaiting-input and stores correlationKey in metadata', () => {
    const state = new HitlState();
    state.markRunning();
    state.park('order-456');
    assert.equal(state.lifecycle.variant, 'awaiting-input');
    assert.equal(state.parked, true);
    assert.equal(state.getMetadata('correlationKey'), 'order-456');
  });

  void it('parked getter returns false when not parked', () => {
    const state = new HitlState();
    state.markRunning();
    assert.equal(state.parked, false);
  });

  void it('resetLifecycle resets from awaiting-input to pending', () => {
    const state = new HitlState();
    state.markRunning();
    state.park('k');
    state.resetLifecycle();
    assert.equal(state.lifecycle.variant, 'pending');
    assert.equal(state.parked, false);
  });
});

// ---------------------------------------------------------------------------
// Full engine integration — park detection and resume
// ---------------------------------------------------------------------------

void describe('Engine — park-and-correlate integration', () => {
  void it('node routing "parked" stops execution and populates result.parked', async () => {
    const approvalNode = TestNode.make<HitlState>(
      'approve',
      ['parked', 'approved', 'rejected'],
      (state) => {
        state.setMetadata('correlationKey', 'ticket-789');
        state.log.push('approve-called');
        return 'parked';
      },
    );

    const doneNode = TestNode.make<HitlState>('process', ['done'], (state) => {
      state.log.push('process-called');
      return 'done';
    });

    const dag = TestDag.of('hitl-test', 'approve', [
      {
        '@id':     'urn:noocodex:dag:hitl-test/node/approve',
        '@type':   'SingleNode',
        'name':    'approve',
        'node':    'approve',
        'outputs': { 'approved': 'process', 'rejected': 'end' },
      },
      {
        '@id':     'urn:noocodex:dag:hitl-test/node/process',
        '@type':   'SingleNode',
        'name':    'process',
        'node':    'process',
        'outputs': { 'done': 'end' },
      },
      {
        '@id':      'urn:noocodex:dag:hitl-test/node/end',
        '@type':    'TerminalNode',
        'name':     'end',
        'outcome':  'completed',
      },
    ]);

    const dispatcher = new Dagonizer<HitlState>();
    dispatcher.registerNode(approvalNode);
    dispatcher.registerNode(doneNode);
    dispatcher.registerDAG(dag);

    const state = new HitlState();
    const result = await dispatcher.execute('hitl-test', state);

    assert.equal(result.state.lifecycle.variant, 'awaiting-input');
    assert.ok(result.parked !== null, 'result.parked should be non-null');
    assert.equal(result.parked.correlationKey, 'ticket-789');
    assert.equal(result.parked.cursor, 'approve');
    assert.equal(result.parked.dagName, 'hitl-test');
    assert.equal(result.cursor, 'approve');
    assert.deepEqual(result.state.log, ['approve-called']);
  });

  void it('resume() after park re-enters at the parked node', async () => {
    const approvalNode = TestNode.make<HitlState>(
      'approve',
      ['parked', 'approved', 'rejected'],
      (state) => {
        // On resume: decision is pre-set, so route 'approved'
        if (state.decision === 'yes') return 'approved';
        state.setMetadata('correlationKey', 'ticket-789');
        state.log.push('parked');
        return 'parked';
      },
    );

    const processNode = TestNode.make<HitlState>('process', ['done'], (state) => {
      state.log.push('processed');
      return 'done';
    });

    const dag = TestDag.of('hitl-resume', 'approve', [
      {
        '@id':     'urn:noocodex:dag:hitl-resume/node/approve',
        '@type':   'SingleNode',
        'name':    'approve',
        'node':    'approve',
        'outputs': { 'approved': 'process', 'rejected': 'end' },
      },
      {
        '@id':     'urn:noocodex:dag:hitl-resume/node/process',
        '@type':   'SingleNode',
        'name':    'process',
        'node':    'process',
        'outputs': { 'done': 'end' },
      },
      {
        '@id':      'urn:noocodex:dag:hitl-resume/node/end',
        '@type':    'TerminalNode',
        'name':     'end',
        'outcome':  'completed',
      },
    ]);

    const dispatcher = new Dagonizer<HitlState>();
    dispatcher.registerNode(approvalNode);
    dispatcher.registerNode(processNode);
    dispatcher.registerDAG(dag);

    // First run: parks at 'approve'
    const firstState = new HitlState();
    const parkedResult = await dispatcher.execute('hitl-resume', firstState);

    assert.equal(parkedResult.state.lifecycle.variant, 'awaiting-input');
    assert.ok(parkedResult.parked !== null);
    assert.equal(parkedResult.parked.cursor, 'approve');

    // Human makes a decision; restore state via checkpoint + resume
    const ckpt = await Checkpoint.capture('hitl-resume', parkedResult);
    const { state: restoredState, cursor } = ckpt.restoreState(
      CheckpointRestoreAdapter.wrap((snap) => HitlState.restore(snap)),
    );

    // Set the decision on the restored state to simulate human input
    restoredState.decision = 'yes';

    const resumedResult = await dispatcher.resume('hitl-resume', restoredState, cursor);

    assert.equal(resumedResult.state.lifecycle.variant, 'completed');
    assert.equal(resumedResult.parked, null);
    assert.ok(resumedResult.state.log.includes('processed'), 'process node should have run');
  });

  void it('Checkpoint.capture works on a parked result (cursor is set)', async () => {
    const parkNode = TestNode.make<HitlState>(
      'wait',
      ['parked', 'done'],
      (state) => {
        state.setMetadata('correlationKey', 'ck-001');
        return 'parked';
      },
    );

    const dag = TestDag.of('ckpt-park', 'wait', [
      {
        '@id':     'urn:noocodex:dag:ckpt-park/node/wait',
        '@type':   'SingleNode',
        'name':    'wait',
        'node':    'wait',
        'outputs': { 'done': 'end' },
      },
      {
        '@id':      'urn:noocodex:dag:ckpt-park/node/end',
        '@type':    'TerminalNode',
        'name':     'end',
        'outcome':  'completed',
      },
    ]);

    const dispatcher = new Dagonizer<HitlState>();
    dispatcher.registerNode(parkNode);
    dispatcher.registerDAG(dag);

    const state = new HitlState();
    const result = await dispatcher.execute('ckpt-park', state);

    assert.ok(result.cursor !== null, 'cursor must be set for a parked result');
    // Checkpoint.capture should not throw (requires cursor !== null)
    const ckpt = await Checkpoint.capture('ckpt-park', result);
    assert.equal(ckpt.data.cursor, 'wait');
    assert.equal(ckpt.data.dagName, 'ckpt-park');
  });
});
