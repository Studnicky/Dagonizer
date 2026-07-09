import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DAGBuilder } from '../../src/builder/DAGBuilder.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';
import { TestDag } from '../_support/TestDag.js';
import { TestNode } from '../_support/TestNode.js';

class EmbedState extends NodeStateBase {
  value = '';
}

const entryNode = TestNode.make<EmbedState>('urn:noocodec:node:entry', ['success']);
const CHILD_DAG_IRI = 'urn:noocodec:dag:child-dag';
const CHILD_ENTRY_IRI = 'urn:noocodec:dag:child-dag/node/entry';
const CHILD_END_IRI = 'urn:noocodec:dag:child-dag/node/end';
const STRING_EMBED_DAG_IRI = 'urn:noocodec:dag:string-embed';
const STRING_EMBED_INVOKE_IRI = 'urn:noocodec:dag:string-embed/node/invoke';
const STRING_EMBED_ENTRY_IRI = 'urn:noocodec:dag:string-embed/node/entry';
const STRING_EMBED_END_IRI = 'urn:noocodec:dag:string-embed/node/end';
const DAG_REF_EMBED_DAG_IRI = 'urn:noocodec:dag:dag-ref-embed';
const DAG_REF_EMBED_INVOKE_IRI = 'urn:noocodec:dag:dag-ref-embed/node/invoke';
const DAG_REF_EMBED_ENTRY_IRI = 'urn:noocodec:dag:dag-ref-embed/node/entry';
const DAG_REF_EMBED_END_IRI = 'urn:noocodec:dag:dag-ref-embed/node/end';
const DAG_FROM_EMBED_DAG_IRI = 'urn:noocodec:dag:dag-from-embed';
const DAG_FROM_EMBED_INVOKE_IRI = 'urn:noocodec:dag:dag-from-embed/node/invoke';
const DAG_FROM_EMBED_ENTRY_IRI = 'urn:noocodec:dag:dag-from-embed/node/entry';
const DAG_FROM_EMBED_END_IRI = 'urn:noocodec:dag:dag-from-embed/node/end';
const BAD_EMBED_MODE_DAG_IRI = 'urn:noocodec:dag:bad-embed-mode';
const BAD_EMBED_MODE_INVOKE_IRI = 'urn:noocodec:dag:bad-embed-mode/node/invoke';
const BAD_EMBED_MODE_END_IRI = 'urn:noocodec:dag:bad-embed-mode/node/end';
const BAD_SCATTER_MODE_DAG_IRI = 'urn:noocodec:dag:bad-scatter-mode';
const BAD_SCATTER_MODE_FAN_IRI = 'urn:noocodec:dag:bad-scatter-mode/node/fan';
const BAD_SCATTER_MODE_END_IRI = 'urn:noocodec:dag:bad-scatter-mode/node/end';
const GATHER_RESULT_EMBED_DAG_IRI = 'urn:noocodec:dag:gather-result-embed';
const GATHER_RESULT_EMBED_INVOKE_IRI = 'urn:noocodec:dag:gather-result-embed/node/invoke';
const GATHER_RESULT_EMBED_END_IRI = 'urn:noocodec:dag:gather-result-embed/node/end';

void describe('DAGBuilder.embed', () => {
  void it('emits an embedded-DAG placement for string references', () => {
    const routes = {
      'success': STRING_EMBED_END_IRI,
      'error': STRING_EMBED_END_IRI,
    } as const;

    const viaEmbed = new DAGBuilder(STRING_EMBED_DAG_IRI, '1', { 'name': 'string-embed' })
      .embed(STRING_EMBED_INVOKE_IRI, CHILD_DAG_IRI, routes, { 'name': 'invoke' })
      .node(STRING_EMBED_ENTRY_IRI, entryNode, { 'success': STRING_EMBED_END_IRI }, { 'name': 'entry' })
      .terminal(STRING_EMBED_END_IRI, { 'name': 'end' })
      .build();

    const viaDirectBody = new DAGBuilder(STRING_EMBED_DAG_IRI, '1', { 'name': 'string-embed' })
      .embed(STRING_EMBED_INVOKE_IRI, CHILD_DAG_IRI, routes, { 'name': 'invoke' })
      .node(STRING_EMBED_ENTRY_IRI, entryNode, { 'success': STRING_EMBED_END_IRI }, { 'name': 'entry' })
      .terminal(STRING_EMBED_END_IRI, { 'name': 'end' })
      .build();

    assert.deepEqual(viaEmbed.nodes[0], viaDirectBody.nodes[0]);
  });

  void it('accepts a DAGType and emits the DAG IRI', () => {
    const childDag = TestDag.of(CHILD_DAG_IRI, CHILD_ENTRY_IRI, [
      {
        '@id': CHILD_ENTRY_IRI,
        '@type': 'SingleNode',
        'name': 'entry',
        'node': 'urn:noocodec:node:entry',
        'outputs': { 'success': CHILD_END_IRI },
      },
      { '@id': CHILD_END_IRI, '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' },
    ], { 'name': 'child-dag' });

    const dag = new DAGBuilder(DAG_REF_EMBED_DAG_IRI, '1', { 'name': 'dag-ref-embed' })
      .embed(DAG_REF_EMBED_INVOKE_IRI, childDag, {
        'success': DAG_REF_EMBED_END_IRI,
        'error': DAG_REF_EMBED_END_IRI,
      }, { 'name': 'invoke' })
      .node(DAG_REF_EMBED_ENTRY_IRI, entryNode, { 'success': DAG_REF_EMBED_END_IRI }, { 'name': 'entry' })
      .terminal(DAG_REF_EMBED_END_IRI, { 'name': 'end' })
      .build();

    assert.equal(dag.nodes[0]?.['@type'], 'EmbeddedDAGNode');
    assert.equal(dag.nodes[0]?.dag, CHILD_DAG_IRI);
    assert.deepEqual(dag.nodes[0]?.dag, CHILD_DAG_IRI);
  });

  void it('accepts a dynamic DAG reference object and emits DagReference', () => {
    const dag = new DAGBuilder(DAG_FROM_EMBED_DAG_IRI, '1', { 'name': 'dag-from-embed' })
      .embed(DAG_FROM_EMBED_INVOKE_IRI, { 'from': 'state', 'path': 'selectedDag', 'candidates': [CHILD_DAG_IRI] }, {
        'success': DAG_FROM_EMBED_END_IRI,
        'error': DAG_FROM_EMBED_END_IRI,
      }, { 'name': 'invoke' })
      .node(DAG_FROM_EMBED_ENTRY_IRI, entryNode, { 'success': DAG_FROM_EMBED_END_IRI }, { 'name': 'entry' })
      .terminal(DAG_FROM_EMBED_END_IRI, { 'name': 'end' })
      .build();

    assert.equal(dag.nodes[0]?.['@type'], 'EmbeddedDAGNode');
    assert.deepEqual(dag.nodes[0]?.dag, {
      '@type': 'DagReference',
      'from': 'state',
      'path': 'selectedDag',
      'candidates': [CHILD_DAG_IRI],
    });
  });

  void it('rejects item-scoped dynamic references at the embed builder boundary', () => {
    assert.throws(
      () => Reflect.apply(DAGBuilder.prototype.embed, new DAGBuilder(BAD_EMBED_MODE_DAG_IRI, '1', { 'name': 'bad-embed-mode' }), [
        BAD_EMBED_MODE_INVOKE_IRI,
        { 'from': 'item', 'path': 'dagIri', 'candidates': [CHILD_DAG_IRI] },
        { 'success': BAD_EMBED_MODE_END_IRI, 'error': BAD_EMBED_MODE_END_IRI },
        { 'name': 'invoke' },
      ]),
      /DAGBuilder\.embed\(\): dynamic DAG reference must use from='state'/u,
    );
  });

  void it('rejects state-scoped dynamic references at the scatter builder boundary', () => {
    assert.throws(
      () => Reflect.apply(DAGBuilder.prototype.scatter, new DAGBuilder(BAD_SCATTER_MODE_DAG_IRI, '1', { 'name': 'bad-scatter-mode' }), [
        BAD_SCATTER_MODE_FAN_IRI,
        'items',
        { 'dag': { 'from': 'state', 'path': 'selectedDag', 'candidates': [CHILD_DAG_IRI] } },
        { 'all-success': BAD_SCATTER_MODE_END_IRI, 'partial': BAD_SCATTER_MODE_END_IRI, 'all-error': BAD_SCATTER_MODE_END_IRI, 'empty': BAD_SCATTER_MODE_END_IRI },
        { 'name': 'fan' },
      ]),
      /DAGBuilder\.scatter\(\): dynamic DAG reference must use from='item'/u,
    );
  });

  void it('emits gatherResult projection for embedded scalar producers', () => {
    const dag = new DAGBuilder(GATHER_RESULT_EMBED_DAG_IRI, '1', { 'name': 'gather-result-embed' })
      .embed<EmbedState>(GATHER_RESULT_EMBED_INVOKE_IRI, CHILD_DAG_IRI, {
        'success': GATHER_RESULT_EMBED_END_IRI,
        'error': GATHER_RESULT_EMBED_END_IRI,
      }, {
        'name': 'invoke',
        'gatherResult': { 'resultField': 'value' },
      })
      .terminal(GATHER_RESULT_EMBED_END_IRI, { 'name': 'end' })
      .build();

    assert.equal(dag.nodes[0]?.['@type'], 'EmbeddedDAGNode');
    assert.deepEqual(dag.nodes[0]?.gatherResult, { 'resultField': 'value' });
  });
});
