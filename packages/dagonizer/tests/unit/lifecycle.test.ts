import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DAGLifecycleMachine } from '../../src/lifecycle/DAGLifecycleMachine.js';
import type { DAGLifecycleStateType } from '../../src/lifecycle/DAGLifecycleState.js';

void describe('DAGLifecycleMachine', () => {
  void it('starts in pending', () => {
    const s = DAGLifecycleMachine.initial();
    assert.equal(s.kind, 'pending');
    assert.equal(DAGLifecycleMachine.isTerminal(s), false);
  });

  void it('pending + start → running with stamped clock', () => {
    const next = DAGLifecycleMachine.transition(
      DAGLifecycleMachine.initial(),
      { 'type': 'start', 'at': 1000 },
    );
    assert.equal(next.kind, 'running');
    assert.equal((next as Extract<DAGLifecycleStateType, { kind: 'running' }>).startedAt, 1000);
  });

  void it('running + succeed → completed', () => {
    const running = DAGLifecycleMachine.transition(
      DAGLifecycleMachine.initial(),
      { 'type': 'start', 'at': 1000 },
    );
    const next = DAGLifecycleMachine.transition(running, { 'type': 'succeed', 'at': 2000 });
    assert.equal(next.kind, 'completed');
    assert.equal(DAGLifecycleMachine.isTerminal(next), true);
  });

  void it('running + fail → failed with error carried', () => {
    const running = DAGLifecycleMachine.transition(
      DAGLifecycleMachine.initial(),
      { 'type': 'start', 'at': 1000 },
    );
    const error = new Error('boom');
    const next = DAGLifecycleMachine.transition(running, { 'type': 'fail', 'error': error, 'at': 2000 });
    assert.equal(next.kind, 'failed');
    assert.equal((next as Extract<DAGLifecycleStateType, { kind: 'failed' }>).error, error);
  });

  void it('terminal states are sticky (return same reference)', () => {
    const running = DAGLifecycleMachine.transition(
      DAGLifecycleMachine.initial(),
      { 'type': 'start', 'at': 1000 },
    );
    const completed = DAGLifecycleMachine.transition(running, { 'type': 'succeed', 'at': 2000 });
    const again = DAGLifecycleMachine.transition(completed, { 'type': 'fail', 'error': new Error(), 'at': 3000 });
    assert.equal(again, completed);
  });

  void it('illegal transitions return the input by reference', () => {
    const pending = DAGLifecycleMachine.initial();
    const same = DAGLifecycleMachine.transition(pending, { 'type': 'succeed', 'at': 1000 });
    assert.equal(same, pending);
  });

  void it('cancel carries reason when provided', () => {
    const running = DAGLifecycleMachine.transition(
      DAGLifecycleMachine.initial(),
      { 'type': 'start', 'at': 1000 },
    );
    const cancelled = DAGLifecycleMachine.transition(running, { 'type': 'cancel', 'reason': 'user-abort', 'at': 1500 });
    assert.equal(cancelled.kind, 'cancelled');
    assert.equal((cancelled as Extract<DAGLifecycleStateType, { kind: 'cancelled' }>).reason, 'user-abort');
  });
});
