import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { ConversationTurnType } from '../../DispatcherState.ts';
import { DispatcherRunnerSetup } from '../../runtime/DispatcherRunnerSetup.ts';

void describe('DispatcherRunnerSetup', () => {
  void it('restores a sensible dispatch UI snapshot after provider setup rejection', () => {
    const conversation: ConversationTurnType[] = [
      { 'role': 'agent', 'text': 'Existing response', 'ts': 10 },
    ];
    const setup = DispatcherRunnerSetup.forDispatch(
      {
        conversation,
        'customerQuery': 'New customer question',
        'isRunning': false,
        'leftActiveKey': 'customer',
        'operatorInput': '',
        'parked': null,
        'parkedExecution': null,
        'terminalVariant': 'completed',
        'trace': ['existing trace'],
      },
      'New customer question',
      20,
    );

    assert.equal(setup.initialState.isRunning, true);
    assert.equal(setup.initialState.customerQuery, '');
    assert.deepEqual(setup.initialState.conversation, [
      { 'role': 'customer', 'text': 'New customer question', 'ts': 20 },
    ]);

    const rollback = setup.rollbackState();
    assert.equal(rollback.isRunning, false);
    assert.equal(rollback.customerQuery, 'New customer question');
    assert.equal(rollback.leftActiveKey, 'customer');
    assert.deepEqual(rollback.conversation, conversation);
    assert.deepEqual(rollback.trace, ['existing trace']);
  });

  void it('restores parked resume controls after service setup rejection', () => {
    const parkedExecution = { 'cursor': 'cursor-1' };
    const setup = DispatcherRunnerSetup.forResume(
      {
        'conversation': [{ 'role': 'customer', 'text': 'Escalated request', 'ts': 30 }],
        'customerQuery': '',
        'isRunning': false,
        'leftActiveKey': 'operator',
        'operatorInput': 'Operator response',
        'parked': { 'cursor': 'cursor-1', 'dagName': 'support-dispatcher' },
        parkedExecution,
        'terminalVariant': 'pending',
        'trace': ['parked trace'],
      },
      'operator trace',
    );

    assert.equal(setup.initialState.isRunning, true);
    assert.equal(setup.initialState.operatorInput, '');

    const rollback = setup.rollbackState();
    assert.equal(rollback.isRunning, false);
    assert.equal(rollback.leftActiveKey, 'operator');
    assert.equal(rollback.operatorInput, 'Operator response');
    assert.deepEqual(rollback.parked, { 'cursor': 'cursor-1', 'dagName': 'support-dispatcher' });
    assert.equal(rollback.parkedExecution, parkedExecution);
    assert.deepEqual(rollback.trace, ['parked trace']);
  });
});
