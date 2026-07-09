import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DAGBuilder } from '../../src/builder/DAGBuilder.js';
import { Dagonizer } from '../../src/Dagonizer.js';
import type { NodeStateBase } from '../../src/NodeStateBase.js';
import { TestNode } from '../_support/TestNode.js';

const greet = TestNode.make('urn:noocodec:node:greet', ['success'] as const);
const plan = TestNode.make('urn:noocodec:node:plan', ['success', 'error'] as const);
const DEMO_DAG_IRI = 'urn:noocodec:dag:demo';
const DEMO_GREET_IRI = 'urn:noocodec:dag:demo/node/greet';
const DEMO_PLAN_IRI = 'urn:noocodec:dag:demo/node/plan';
const DEMO_END_IRI = 'urn:noocodec:dag:demo/node/end';
const BAD_ENTRYPOINT_DAG_IRI = 'urn:noocodec:dag:bad-entrypoint';
const BAD_ENTRYPOINT_LABEL_DAG_IRI = 'urn:noocodec:dag:bad-entrypoint-label';
const BAD_ENTRYPOINT_LABEL_START_IRI = 'urn:noocodec:dag:bad-entrypoint-label/node/start';
const BAD_ENTRYPOINT_TARGET_DAG_IRI = 'urn:noocodec:dag:bad-entrypoint-target';
const BAD_GATHER_QUORUM_DAG_IRI = 'urn:noocodec:dag:bad-gather-quorum';
const BAD_GATHER_QUORUM_JOIN_IRI = 'urn:noocodec:dag:bad-gather-quorum/node/join';
const BAD_GATHER_QUORUM_LEFT_IRI = 'urn:noocodec:dag:bad-gather-quorum/node/left';
const BAD_GATHER_QUORUM_RIGHT_IRI = 'urn:noocodec:dag:bad-gather-quorum/node/right';
const BAD_GATHER_QUORUM_END_IRI = 'urn:noocodec:dag:bad-gather-quorum/node/end';
const IGNORED_GATHER_QUORUM_DAG_IRI = 'urn:noocodec:dag:ignored-gather-quorum';
const IGNORED_GATHER_QUORUM_JOIN_IRI = 'urn:noocodec:dag:ignored-gather-quorum/node/join';
const IGNORED_GATHER_QUORUM_LEFT_IRI = 'urn:noocodec:dag:ignored-gather-quorum/node/left';
const IGNORED_GATHER_QUORUM_RIGHT_IRI = 'urn:noocodec:dag:ignored-gather-quorum/node/right';
const IGNORED_GATHER_QUORUM_END_IRI = 'urn:noocodec:dag:ignored-gather-quorum/node/end';
const VIA_BUILDER_DAG_IRI = 'urn:noocodec:dag:via-builder';
const VIA_BUILDER_GREET_IRI = 'urn:noocodec:dag:via-builder/node/greet';
const VIA_BUILDER_PLAN_IRI = 'urn:noocodec:dag:via-builder/node/plan';
const VIA_BUILDER_END_IRI = 'urn:noocodec:dag:via-builder/node/end';
const EMPTY_DAG_IRI = 'urn:noocodec:dag:empty';

void describe('DAGBuilder', () => {
  void it('builds a single-node DAG in JSON-LD canonical form', () => {
    const dag = new DAGBuilder(DEMO_DAG_IRI, '1.0', { 'name': 'demo' })
      .node(DEMO_GREET_IRI, greet, { 'success': DEMO_END_IRI }, { 'name': 'greet' })
      .terminal(DEMO_END_IRI, { 'name': 'end' })
      .build();

    assert.equal(dag.name, 'demo');
    assert.equal(dag.version, '1.0');
    assert.deepEqual(dag.entrypoints, { 'main': 'urn:noocodec:dag:demo/node/greet' });
    assert.equal(dag.nodes.length, 2);
    // JSON-LD shape: @type discriminator, @id URN, @context at root
    assert.equal(dag['@type'], 'DAG');
    assert.ok(dag['@id'].startsWith('urn:noocodec:dag:'));
    assert.ok(dag['@context'] !== undefined);
    const first = dag.nodes[0];
    assert.equal(first?.['@type'], 'SingleNode');
    const firstId = first?.['@id'];
    assert.ok(typeof firstId === 'string' && firstId.includes('demo/node/greet'));
    assert.deepEqual(first?.outputs, { 'success': 'urn:noocodec:dag:demo/node/end' });
  });

  void it('uses explicit entrypoint when set', () => {
    const dag = new DAGBuilder(DEMO_DAG_IRI, '1', { 'name': 'demo' })
      .entrypoints({ 'main': DEMO_PLAN_IRI })
      .node(DEMO_GREET_IRI, greet, { 'success': DEMO_PLAN_IRI }, { 'name': 'greet' })
      .node(DEMO_PLAN_IRI, plan, {
        'success': DEMO_END_IRI,
        'error': DEMO_END_IRI,
      }, { 'name': 'plan' })
      .terminal(DEMO_END_IRI, { 'name': 'end' })
      .build();
    assert.deepEqual(dag.entrypoints, { 'main': 'urn:noocodec:dag:demo/node/plan' });
  });

  void it('rejects empty entrypoint node names', () => {
    assert.throws(
      () => new DAGBuilder(BAD_ENTRYPOINT_DAG_IRI, '1', { 'name': 'bad-entrypoint' }).entrypoints({ 'main': '' }),
      /entrypoint 'main' placement IRI must be non-empty/u,
    );
  });

  void it('rejects empty labeled entrypoint keys and targets', () => {
    assert.throws(
      () => new DAGBuilder(BAD_ENTRYPOINT_LABEL_DAG_IRI, '1', { 'name': 'bad-entrypoint-label' }).entrypoints({ '': BAD_ENTRYPOINT_LABEL_START_IRI }),
      /entrypoint label must be non-empty/u,
    );
    assert.throws(
      () => new DAGBuilder(BAD_ENTRYPOINT_TARGET_DAG_IRI, '1', { 'name': 'bad-entrypoint-target' }).entrypoints({ 'main': '' }),
      /entrypoint 'main' placement IRI must be non-empty/u,
    );
  });

  void it('rejects impossible gather quorum policy', () => {
    assert.throws(
      () => new DAGBuilder(BAD_GATHER_QUORUM_DAG_IRI, '1', { 'name': 'bad-gather-quorum' })
        .gather(BAD_GATHER_QUORUM_JOIN_IRI, { [BAD_GATHER_QUORUM_LEFT_IRI]: {}, [BAD_GATHER_QUORUM_RIGHT_IRI]: {} }, { 'strategy': 'discard' }, { 'success': BAD_GATHER_QUORUM_END_IRI }, {
          'name': 'join',
          'policy': { 'mode': 'quorum', 'quorum': 3 },
        }),
      /policy\.quorum 3 exceeds source count 2/u,
    );
    assert.throws(
      () => new DAGBuilder(IGNORED_GATHER_QUORUM_DAG_IRI, '1', { 'name': 'ignored-gather-quorum' })
        .gather(IGNORED_GATHER_QUORUM_JOIN_IRI, { [IGNORED_GATHER_QUORUM_LEFT_IRI]: {}, [IGNORED_GATHER_QUORUM_RIGHT_IRI]: {} }, { 'strategy': 'discard' }, { 'success': IGNORED_GATHER_QUORUM_END_IRI }, {
          'name': 'join',
          'policy': { 'mode': 'any', 'quorum': 1 },
        }),
      /policy\.quorum is only valid when policy\.mode is 'quorum'/u,
    );
  });

  void it('produces a config the dispatcher accepts', () => {
    const dag = new DAGBuilder(VIA_BUILDER_DAG_IRI, '1', { 'name': 'via-builder' })
      .node(VIA_BUILDER_GREET_IRI, greet, { 'success': VIA_BUILDER_PLAN_IRI }, { 'name': 'greet' })
      .node(VIA_BUILDER_PLAN_IRI, plan, {
        'success': VIA_BUILDER_END_IRI,
        'error': VIA_BUILDER_END_IRI,
      }, { 'name': 'plan' })
      .terminal(VIA_BUILDER_END_IRI, { 'name': 'end' })
      .build();

    const dispatcher = new Dagonizer<NodeStateBase>();
    dispatcher.registerNode(greet);
    dispatcher.registerNode(plan);
    dispatcher.registerDAG(dag);
  });

  void it('build() without nodes throws', () => {
    assert.throws(() => new DAGBuilder(EMPTY_DAG_IRI, '1', { 'name': 'empty' }).build());
  });

});
