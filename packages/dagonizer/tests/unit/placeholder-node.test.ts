import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DAGBuilder } from '../../src/builder/DAGBuilder.js';
import { PlaceholderNode } from '../../src/core/PlaceholderNode.js';
import { Dagonizer } from '../../src/Dagonizer.js';
import { Batch } from '../../src/entities/batch/Batch.js';
import { NodeContext } from '../../src/entities/node/NodeContext.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';

void describe('PlaceholderNode', () => {
  void it('routes to first output regardless of state', async () => {
    const node = new PlaceholderNode<NodeStateBase, 'success' | 'error'>(
      'stub',
      ['success', 'error'],
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
      'classify',
      ['ok', 'fail', 'skip'],
    );
    assert.equal(node.name, 'classify');
    assert.deepEqual([...node.outputs], ['ok', 'fail', 'skip']);
  });

  void it('outputSchema covers all declared outputs', () => {
    const node = new PlaceholderNode<NodeStateBase, 'a' | 'b'>('multi', ['a', 'b']);
    const schema = node.outputSchema;
    assert.ok('a' in schema, 'schema should have port "a"');
    assert.ok('b' in schema, 'schema should have port "b"');
  });
});

void describe('DAGBuilder.placeholder', () => {
  void it('creates a valid SingleNode placement', () => {
    const dag = new DAGBuilder('stub-dag', '1.0')
      .placeholder('validate', ['success', 'error'], { 'success': 'end', 'error': 'end' })
      .terminal('end')
      .build();

    assert.equal(dag.entrypoints['main'], 'validate');
    const placement = dag.nodes.find((n) => n.name === 'validate');
    assert.ok(placement !== undefined);
    assert.equal(placement['@type'], 'SingleNode');
    assert.ok(placement['@id'].includes('stub-dag/node/validate'));
  });

  void it('executes end-to-end through Dagonizer, completing via first output route', async () => {
    const dag = new DAGBuilder('placeholder-e2e', '1.0')
      .placeholder('process', ['done', 'error'], { 'done': 'end', 'error': 'end' })
      .terminal('end')
      .build();

    const dispatcher = new Dagonizer<NodeStateBase>();
    // PlaceholderNode registers itself via builder — manually register the node
    // that was constructed during .placeholder() by retrieving by name.
    const placeholderNode = new PlaceholderNode<NodeStateBase, 'done' | 'error'>(
      'process',
      ['done', 'error'],
    );
    dispatcher.registerNode(placeholderNode);
    dispatcher.registerDAG(dag);

    const state = new NodeStateBase();
    const result = await dispatcher.execute('placeholder-e2e', state);

    assert.ok(result.executedNodes.includes('process'), 'process node should execute');
    assert.ok(result.executedNodes.includes('end'), 'end terminal should be reached');
    assert.equal(state.lifecycle.variant, 'completed');
  });
});
