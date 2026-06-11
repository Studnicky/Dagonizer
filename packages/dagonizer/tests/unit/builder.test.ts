import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DAGBuilder } from '../../src/builder/DAGBuilder.js';
import type { NodeInterface } from '../../src/contracts/NodeInterface.js';
import { EMPTY_CONTRACT_FRAGMENT } from '../../src/contracts/OperationContractFragment.js';
import { Dagonizer } from '../../src/Dagonizer.js';
import type { NodeStateBase } from '../../src/NodeStateBase.js';
import { Timeout } from '../../src/runtime/Timeout.js';

class GreetNode implements NodeInterface<NodeStateBase, 'success'> {
  readonly name = 'greet';
  readonly outputs = ['success'] as const;
  readonly 'contract' = EMPTY_CONTRACT_FRAGMENT;
  readonly timeout = Timeout.none();
  async execute(_state: NodeStateBase) { return { 'errors': [], 'output': 'success' as const }; }
}

class PlanNode implements NodeInterface<NodeStateBase, 'success' | 'error'> {
  readonly name = 'plan';
  readonly outputs = ['success', 'error'] as const;
  readonly 'contract' = EMPTY_CONTRACT_FRAGMENT;
  readonly timeout = Timeout.none();
  async execute(_state: NodeStateBase) { return { 'errors': [], 'output': 'success' as const }; }
}

const greet = new GreetNode();
const plan = new PlanNode();

void describe('DAGBuilder', () => {
  void it('builds a single-node DAG in JSON-LD canonical form', () => {
    const dag = new DAGBuilder('demo', '1.0')
      .node('greet', greet, { 'success': 'end' })
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
      .node('plan', plan, { 'success': 'end', 'error': 'end' })
      .build();
    assert.equal(dag.entrypoint, 'plan');
  });

  void it('produces a config the dispatcher accepts', () => {
    const dag = new DAGBuilder('via-builder', '1')
      .node('greet', greet, { 'success': 'plan' })
      .node('plan', plan, { 'success': 'end', 'error': 'end' })
      .terminal('end')
      .build();

    const dispatcher = new Dagonizer<NodeStateBase>();
    dispatcher.registerNode(greet);
    dispatcher.registerNode(plan);
    dispatcher.registerDAG(dag);
  });

  void it('build() without nodes throws', () => {
    assert.throws(() => new DAGBuilder('empty', '1').build());
  });

});
