import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DAGBuilder } from '../../src/builder/DAGBuilder.js';
import { Dagonizer } from '../../src/Dagonizer.js';
import { DAGError } from '../../src/errors/index.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';
import { TestNode } from '../_support/TestNode.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const ERRORING_DAG_IRI = 'urn:noocodec:dag:erroring-dag';
const ERRORING_FAILING_IRI = 'urn:noocodec:dag:erroring-dag/node/failing';
const ERRORING_END_IRI = 'urn:noocodec:dag:erroring-dag/node/end';

class PlainState extends NodeStateBase {}

void describe('NodeScheduler error-context enrichment', () => {
  void it('a node throw is wrapped in a DAGError whose context carries dagName, placementPath, and correlationId', async () => {
    const failing = TestNode.make<PlainState>('urn:noocodec:node:failing', ['success'], () => {
      throw new Error('boom');
    });
    const dag = new DAGBuilder(ERRORING_DAG_IRI, '1', { 'name': 'erroring-dag' })
      .node(ERRORING_FAILING_IRI, failing, { 'success': ERRORING_END_IRI }, { 'name': 'failing' })
      .terminal(ERRORING_END_IRI, { 'name': 'end' })
      .build();

    let captured: Error | undefined;
    const observedDispatcher = new Dagonizer<PlainState>({
      'observers': [{
        "onError": (_nodeName, error) => { captured = error; },
      }],
    });
    observedDispatcher.registerNode(failing);
    observedDispatcher.registerDAG(dag);

    await observedDispatcher.execute(ERRORING_DAG_IRI, new PlainState());

    assert.ok(captured !== undefined);
    assert.ok(captured instanceof DAGError);
    const wrapped = captured;

    // The enriched wrapper carries structured context — not the empty `{}`
    // the wrapping DAGError used to construct with.
    assert.equal(wrapped.context['dagName'], ERRORING_DAG_IRI);
    assert.deepEqual(wrapped.context['placementPath'], []);
    const correlationId = wrapped.context['correlationId'];
    assert.equal(typeof correlationId, 'string');
    assert.ok(typeof correlationId === 'string' && UUID_PATTERN.test(correlationId));

    // The original error survives via the cause chain, not silently dropped.
    assert.ok(wrapped.cause instanceof Error);
    assert.equal(wrapped.cause?.message, 'boom');
  });
});
