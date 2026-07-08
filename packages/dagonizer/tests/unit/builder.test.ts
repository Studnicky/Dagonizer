import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DAGBuilder } from '../../src/builder/DAGBuilder.js';
import { Dagonizer } from '../../src/Dagonizer.js';
import type { NodeStateBase } from '../../src/NodeStateBase.js';
import { TestNode } from '../_support/TestNode.js';

const greet = TestNode.make('greet', ['success'] as const);
const plan = TestNode.make('plan', ['success', 'error'] as const);

void describe('DAGBuilder', () => {
  void it('builds a single-node DAG in JSON-LD canonical form', () => {
    const dag = new DAGBuilder('demo', '1.0')
      .node('greet', greet, { 'success': 'end' })
      .build();

    assert.equal(dag.name, 'demo');
    assert.equal(dag.version, '1.0');
    assert.deepEqual(dag.entrypoints, { 'main': 'greet' });
    assert.equal(dag.nodes.length, 1);
    // JSON-LD shape: @type discriminator, @id URN, @context at root
    assert.equal(dag['@type'], 'DAG');
    assert.ok(dag['@id'].startsWith('urn:noocodex:dag:'));
    assert.ok(dag['@context'] !== undefined);
    const first = dag.nodes[0];
    assert.equal(first?.['@type'], 'SingleNode');
    const firstId = first?.['@id'];
    assert.ok(typeof firstId === 'string' && firstId.includes('demo/node/greet'));
  });

  void it('uses explicit entrypoint when set', () => {
    const dag = new DAGBuilder('demo', '1')
      .entrypoint('plan')
      .node('greet', greet, { 'success': 'plan' })
      .node('plan', plan, { 'success': 'end', 'error': 'end' })
      .build();
    assert.deepEqual(dag.entrypoints, { 'main': 'plan' });
  });

  void it('rejects empty entrypoint node names', () => {
    assert.throws(
      () => new DAGBuilder('bad-entrypoint', '1').entrypoint(''),
      /entrypoint node name must be non-empty/u,
    );
  });

  void it('rejects empty labeled entrypoint keys and targets', () => {
    assert.throws(
      () => new DAGBuilder('bad-entrypoint-label', '1').entrypoints({ '': 'start' }),
      /entrypoint label must be non-empty/u,
    );
    assert.throws(
      () => new DAGBuilder('bad-entrypoint-target', '1').entrypoints({ 'main': '' }),
      /entrypoint 'main' node name must be non-empty/u,
    );
  });

  void it('rejects impossible gather quorum policy', () => {
    assert.throws(
      () => new DAGBuilder('bad-gather-quorum', '1')
        .gather('join', ['left', 'right'], { 'strategy': 'discard' }, { 'success': 'end' }, {
          'policy': { 'mode': 'quorum', 'quorum': 3 },
        }),
      /policy\.quorum 3 exceeds source count 2/u,
    );
    assert.throws(
      () => new DAGBuilder('ignored-gather-quorum', '1')
        .gather('join', ['left', 'right'], { 'strategy': 'discard' }, { 'success': 'end' }, {
          'policy': { 'mode': 'any', 'quorum': 1 },
        }),
      /policy\.quorum is only valid when policy\.mode is 'quorum'/u,
    );
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
