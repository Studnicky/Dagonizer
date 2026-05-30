import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DAGBuilder } from '../../src/builder/DAGBuilder.js';
import type { NodeInterface } from '../../src/contracts/NodeInterface.js';
import { Dagonizer } from '../../src/Dagonizer.js';
import type { NodeStateBase } from '../../src/NodeStateBase.js';

const greet: NodeInterface<NodeStateBase, 'success'> = {
  'name': 'greet',
  'outputs': ['success'],
  async execute() { return { 'output': 'success' }; },
};
const plan: NodeInterface<NodeStateBase, 'success' | 'error'> = {
  'name': 'plan',
  'outputs': ['success', 'error'],
  async execute() { return { 'output': 'success' }; },
};

void describe('DAGBuilder', () => {
  void it('builds a single-node DAG in JSON-LD canonical form', () => {
    const dag = new DAGBuilder('demo', '1.0')
      .node('greet', greet, { 'success': null })
      .build();

    assert.equal(dag.name, 'demo');
    assert.equal(dag.version, '1.0');
    assert.equal(dag.entrypoint, 'greet');
    assert.equal(dag.nodes.length, 1);
    // JSON-LD shape: @type discriminator, @id URN, @context at root
    assert.equal(dag['@type'], 'DAG');
    assert.ok(dag['@id'].startsWith('urn:noocodex:dag:'));
    assert.ok(dag['@context'] !== undefined);
    const first = dag.nodes[0];
    assert.equal(first?.['@type'], 'SingleNode');
    assert.ok((first?.['@id'] as string).includes('demo/node/greet'));
  });

  void it('uses explicit entrypoint when set', () => {
    const dag = new DAGBuilder('demo', '1')
      .entrypoint('plan')
      .node('greet', greet, { 'success': 'plan' })
      .node('plan', plan, { 'success': null, 'error': null })
      .build();
    assert.equal(dag.entrypoint, 'plan');
  });

  void it('produces a config the dispatcher accepts', () => {
    const dag = new DAGBuilder('via-builder', '1')
      .node('greet', greet, { 'success': 'plan' })
      .node('plan', plan, { 'success': null, 'error': null })
      .build();

    const dispatcher = new Dagonizer<NodeStateBase>();
    dispatcher.registerNode(greet);
    dispatcher.registerNode(plan);
    dispatcher.registerDAG(dag);
  });

  void it('build() without nodes throws', () => {
    assert.throws(() => new DAGBuilder('empty', '1').build());
  });

  void it('parallel/scatter/embeddedDAG round-trip into DAG shape', () => {
    const dag = new DAGBuilder('mix', '1')
      .node('a', greet, { 'success': 'b' })
      .node('b', greet, { 'success': 'group' })
      .parallel('group', ['a', 'b'], 'all-success', { 'success': null })
      .build();
    assert.equal(dag.nodes.length, 3);
    assert.equal(dag.nodes[2]?.['@type'], 'ParallelNode');
  });
});
