import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DAGBuilder } from '../../src/builder/DAGBuilder.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';
import { TestDag } from '../_support/TestDag.js';
import { TestNode } from '../_support/TestNode.js';

class EmbedState extends NodeStateBase {
  value = '';
}

const entryNode = TestNode.make<EmbedState>('entry', ['success']);

void describe('DAGBuilder.embed', () => {
  void it('emits the same placement shape as embeddedDAG for string references', () => {
    const routes = { 'success': 'end', 'error': 'end' } as const;

    const viaEmbed = new DAGBuilder('string-embed', '1')
      .embed('invoke', 'child-dag', routes)
      .node('entry', entryNode, { 'success': 'end' })
      .terminal('end')
      .build();

    const viaLegacy = new DAGBuilder('string-embed', '1')
      .embeddedDAG('invoke', 'child-dag', routes)
      .node('entry', entryNode, { 'success': 'end' })
      .terminal('end')
      .build();

    assert.deepEqual(viaEmbed.nodes[0], viaLegacy.nodes[0]);
  });

  void it('accepts a DAGType and emits the DAG name', () => {
    const childDag = TestDag.of('child-dag', 'entry', [
      {
        '@id': 'urn:noocodex:dag:child-dag/node/entry',
        '@type': 'SingleNode',
        'name': 'entry',
        'node': 'entry',
        'outputs': { 'success': 'end' },
      },
      { '@id': 'urn:noocodex:dag:child-dag/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' },
    ]);

    const dag = new DAGBuilder('dag-ref-embed', '1')
      .embed('invoke', childDag, { 'success': 'end', 'error': 'end' })
      .node('entry', entryNode, { 'success': 'end' })
      .terminal('end')
      .build();

    assert.equal(dag.nodes[0]?.['@type'], 'EmbeddedDAGNode');
    assert.equal(dag.nodes[0]?.dag, 'child-dag');
    assert.deepEqual(dag.nodes[0]?.dag, 'child-dag');
  });

  void it('accepts a dynamic DAG reference object and emits DagReference', () => {
    const dag = new DAGBuilder('dag-from-embed', '1')
      .embed('invoke', { 'from': 'state', 'path': 'selectedDag', 'candidates': ['child-dag'] }, { 'success': 'end', 'error': 'end' })
      .node('entry', entryNode, { 'success': 'end' })
      .terminal('end')
      .build();

    assert.equal(dag.nodes[0]?.['@type'], 'EmbeddedDAGNode');
    assert.deepEqual(dag.nodes[0]?.dag, {
      '@type': 'DagReference',
      'from': 'state',
      'path': 'selectedDag',
      'candidates': ['child-dag'],
    });
  });
});
