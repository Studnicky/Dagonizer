import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DAGBuilder } from '../../src/builder/DAGBuilder.js';
import { Dagonizer } from '../../src/Dagonizer.js';
import type { NodeContextType } from '../../src/entities/node/NodeContext.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';
import { DagExecutionContext } from '../../src/runtime/DagExecutionContext.js';
import { TestNode } from '../_support/TestNode.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

/** A signal with no registered `DagExecutionContext` scope — the "invoked outside execute()" case. */
const UNSCOPED_SIGNAL = new AbortController().signal;

class SeenState extends NodeStateBase {
  correlationId: string | undefined;
  dagName: string | undefined;
}

void describe('DagExecutionContext.correlationIdOf / .dagNameOf convenience', () => {
  void it('a node reads its own run\'s correlation id and dagName via the shorthand, without knowing the reserved key names', async () => {
    const dispatcher = new Dagonizer<SeenState>();
    const only = TestNode.make<SeenState>('only', ['success'], (state: SeenState, context: NodeContextType) => {
      // The discoverable entry point: no `DagExecutionContextKeys` import, no
      // generic `tryGet(signal, key)` call — just the shorthand off `context.signal`.
      state.correlationId = DagExecutionContext.correlationIdOf(context.signal);
      state.dagName = DagExecutionContext.dagNameOf(context.signal);
      return 'success';
    });
    dispatcher.registerNode(only);
    const dag = new DAGBuilder('convenience-dag', '1')
      .node('only', only, { 'success': 'end' })
      .terminal('end')
      .build();
    dispatcher.registerDAG(dag);

    const state = new SeenState();
    await dispatcher.execute('convenience-dag', state);

    assert.ok(state.correlationId !== undefined && UUID_PATTERN.test(state.correlationId));
    assert.equal(state.dagName, 'convenience-dag');
  });

  void it('returns undefined for a signal with no registered scope', () => {
    assert.equal(DagExecutionContext.correlationIdOf(UNSCOPED_SIGNAL), undefined);
    assert.equal(DagExecutionContext.dagNameOf(UNSCOPED_SIGNAL), undefined);
  });
});
