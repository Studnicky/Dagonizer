import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DAGBuilder } from '../../src/builder/DAGBuilder.js';
import { PlaceholderNode } from '../../src/core/PlaceholderNode.js';
import { Dagonizer } from '../../src/Dagonizer.js';
import { Batch } from '../../src/entities/batch/Batch.js';
import { NodeContext } from '../../src/entities/node/NodeContext.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';

const STUB_DAG_IRI = 'urn:noocodec:dag:stub-dag';
const STUB_VALIDATE_IRI = 'urn:noocodec:dag:stub-dag/node/validate';
const STUB_END_IRI = 'urn:noocodec:dag:stub-dag/node/end';
const PLACEHOLDER_E2E_DAG_IRI = 'urn:noocodec:dag:placeholder-e2e';
const PLACEHOLDER_E2E_PROCESS_IRI = 'urn:noocodec:dag:placeholder-e2e/node/process';
const PLACEHOLDER_E2E_END_IRI = 'urn:noocodec:dag:placeholder-e2e/node/end';

void describe('PlaceholderNode', () => {
  void it('routes to first output regardless of state', async () => {
    const node = new PlaceholderNode<NodeStateBase, 'success' | 'error'>(
      'urn:noocodec:node:stub',
      ['success', 'error'],
      { 'name': 'stub' },
    );

    const state = new NodeStateBase();
    const batch = Batch.of(state);
    const context = NodeContext.create('test-dag', 'stub', new AbortController().signal);

    const routed = await node.execute(batch, context);

    assert.ok(routed.has('success'), 'should route to first output "success"');
    assert.ok(!routed.has('error'), 'should not route to "error"');
    const successBatch = routed.get('success');
    assert.ok(successBatch !== undefined);
    assert.equal([...successBatch].length, 1);
  });

  void it('name and outputs match constructor arguments', () => {
    const node = new PlaceholderNode<NodeStateBase, 'ok' | 'fail' | 'skip'>(
      'urn:noocodec:node:classify',
      ['ok', 'fail', 'skip'],
      { 'name': 'classify' },
    );
    assert.equal(node.name, 'classify');
    assert.deepEqual([...node.outputs], ['ok', 'fail', 'skip']);
  });

  void it('outputSchema covers all declared outputs', () => {
    const node = new PlaceholderNode<NodeStateBase, 'a' | 'b'>('urn:noocodec:node:multi', ['a', 'b']);
    const schema = node.outputSchema;
    assert.ok('a' in schema, 'schema should have port "a"');
    assert.ok('b' in schema, 'schema should have port "b"');
  });
});

void describe('DAGBuilder.placeholder', () => {
  void it('creates a valid SingleNode placement', () => {
    const dag = new DAGBuilder(STUB_DAG_IRI, '1.0', { 'name': 'stub-dag' })
      .placeholder(STUB_VALIDATE_IRI, ['success', 'error'], { 'success': STUB_END_IRI, 'error': STUB_END_IRI }, { 'name': 'validate' })
      .terminal(STUB_END_IRI, { 'name': 'end' })
      .build();

    assert.equal(dag.entrypoints['main'], STUB_VALIDATE_IRI);
    const placement = dag.nodes.find((n) => n.name === 'validate');
    assert.ok(placement !== undefined);
    assert.equal(placement['@type'], 'SingleNode');
    assert.ok(placement['@id'].includes('stub-dag/node/validate'));
  });

  void it('executes end-to-end through Dagonizer, completing via first output route', async () => {
    const dag = new DAGBuilder(PLACEHOLDER_E2E_DAG_IRI, '1.0', { 'name': 'placeholder-e2e' })
      .placeholder(PLACEHOLDER_E2E_PROCESS_IRI, ['done', 'error'], {
        'done': PLACEHOLDER_E2E_END_IRI,
        'error': PLACEHOLDER_E2E_END_IRI,
      }, { 'name': 'process' })
      .terminal(PLACEHOLDER_E2E_END_IRI, { 'name': 'end' })
      .build();

    const dispatcher = new Dagonizer<NodeStateBase>();
    // PlaceholderNode registers itself via builder — manually register the node
    // that was constructed during .placeholder() by retrieving by name.
    const placeholderNode = new PlaceholderNode<NodeStateBase, 'done' | 'error'>(
      PLACEHOLDER_E2E_PROCESS_IRI,
      ['done', 'error'],
      { 'name': 'process' },
    );
    dispatcher.registerNode(placeholderNode);
    dispatcher.registerDAG(dag);

    const state = new NodeStateBase();
    const result = await dispatcher.execute(PLACEHOLDER_E2E_DAG_IRI, state);

    assert.ok(result.executedNodes.includes('process'), 'process node should execute');
    assert.ok(result.executedNodes.includes('end'), 'end terminal should be reached');
    assert.equal(state.lifecycle.variant, 'completed');
  });
});
