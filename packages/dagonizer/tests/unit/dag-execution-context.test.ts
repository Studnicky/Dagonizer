import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DAGBuilder } from '../../src/builder/DAGBuilder.js';
import { Dagonizer } from '../../src/Dagonizer.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';
import { DagExecutionContext, DagExecutionContextKeys } from '../../src/runtime/DagExecutionContext.js';
import { TestNode } from '../_support/TestNode.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

class SeenState extends NodeStateBase {
  seen: { nodeName: string; correlationId: string | undefined; dagName: string | undefined }[] = [];
}

void describe('DagExecutionContext correlation propagation', () => {
  void it('seeds a correlation id and dagName readable from every node during one run, without NodeContextType', async () => {
    const dispatcher = new Dagonizer<SeenState>();
    const record = (name: string): (state: SeenState) => string => (state) => {
      state.seen.push({
        'nodeName': name,
        'correlationId': DagExecutionContext.tryGet<string>(DagExecutionContextKeys.CORRELATION_ID),
        'dagName': DagExecutionContext.tryGet<string>(DagExecutionContextKeys.DAG_NAME),
      });
      return 'success';
    };
    const firstNode = TestNode.make<SeenState>('first', ['success'], record('first'));
    const secondNode = TestNode.make<SeenState>('second', ['success'], record('second'));
    dispatcher.registerNode(firstNode);
    dispatcher.registerNode(secondNode);

    const dag = new DAGBuilder('correlated', '1')
      .node('first', firstNode, { 'success': 'second-step' })
      .node('second-step', secondNode, { 'success': 'end' })
      .terminal('end')
      .build();
    dispatcher.registerDAG(dag);

    const state = new SeenState();
    await dispatcher.execute('correlated', state);

    assert.equal(state.seen.length, 2);
    const [seenFirst, seenSecond] = state.seen;
    assert.ok(seenFirst);
    assert.ok(seenSecond);

    // Both nodes ran inside the same run and observed the same correlation id.
    assert.equal(seenFirst.correlationId, seenSecond.correlationId);
    assert.ok(seenFirst.correlationId !== undefined && UUID_PATTERN.test(seenFirst.correlationId));

    // Both nodes see the running DAG's name without it being threaded through
    // NodeContextType or any node constructor argument.
    assert.equal(seenFirst.dagName, 'correlated');
    assert.equal(seenSecond.dagName, 'correlated');

    // No active scope after the run completes: the scope was terminated.
    assert.equal(DagExecutionContext.tryGet(DagExecutionContextKeys.CORRELATION_ID), undefined);
  });

  void it('generates a distinct correlation id per execute() call', async () => {
    const dispatcher = new Dagonizer<SeenState>();
    const seenIds: string[] = [];
    const only = TestNode.make<SeenState>('only', ['success'], () => {
      const id = DagExecutionContext.tryGet<string>(DagExecutionContextKeys.CORRELATION_ID);
      if (id !== undefined) seenIds.push(id);
      return 'success';
    });
    dispatcher.registerNode(only);
    const dag = new DAGBuilder('single-run', '1')
      .node('only', only, { 'success': 'end' })
      .terminal('end')
      .build();
    dispatcher.registerDAG(dag);

    await dispatcher.execute('single-run', new SeenState());
    await dispatcher.execute('single-run', new SeenState());

    assert.equal(seenIds.length, 2);
    assert.notEqual(seenIds[0], seenIds[1]);
  });

  void it('tryGet returns undefined for a node invoked outside any Dagonizer.execute() run', () => {
    assert.equal(DagExecutionContext.tryGet(DagExecutionContextKeys.CORRELATION_ID), undefined);
    assert.equal(DagExecutionContext.isActive(), false);
  });
});
