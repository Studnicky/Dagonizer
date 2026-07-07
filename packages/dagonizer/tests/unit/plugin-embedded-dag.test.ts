import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DAGBuilder } from '../../src/builder/DAGBuilder.js';
import { Dagonizer } from '../../src/Dagonizer.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';
import { defineDagonizerPlugin } from '../../src/plugin/defineDagonizerPlugin.js';
import { TestNode } from '../_support/TestNode.js';

class SharedState extends NodeStateBase {
  query = '';
  documents = '';
  answer = '';
}

void describe('plugin-authored embedded DAGs', () => {
  void it('execute through the same embed path as local DAGs', async () => {
    const searchNode = TestNode.make<SharedState>('search', ['success'], (state) => {
      state.documents = `docs:${state.query}`;
      return 'success';
    });
    const answerNode = TestNode.make<SharedState>('answer', ['success'], (state) => {
      state.answer = `${state.query}:${state.documents}`;
      return 'success';
    });

    const childDag = new DAGBuilder('retrieval:search', '1')
      .node('search', searchNode, { 'success': 'done' })
      .terminal('done')
      .build();

    const plugin = defineDagonizerPlugin({
      'id': '@example/retrieval-plugin',
      'context': { 'retrieval': 'https://noocodex.dev/plugins/retrieval#' },
      'nodes': [searchNode],
      'dags': [childDag],
      'exports': { 'search': 'retrieval:search' },
    });

    const parentDag = new DAGBuilder('answer-question', '1')
      .embed('retrieve', plugin.exports.search, { 'success': 'answer', 'error': 'failed' }, {
        'inputs': { 'query': 'query' },
        'outputs': { 'documents': 'documents' },
      })
      .node('answer', answerNode, { 'success': 'done' })
      .terminal('done')
      .terminal('failed', { 'outcome': 'failed' })
      .build();

    const dispatcher = new Dagonizer<SharedState>();
    dispatcher.registerPlugin(plugin);
    dispatcher.registerNode(answerNode);
    dispatcher.registerDAG(parentDag);

    const state = new SharedState();
    state.query = 'hello';

    const result = await dispatcher.execute('answer-question', state);

    assert.equal(result.terminalOutcome, 'completed');
    assert.equal(state.documents, 'docs:hello');
    assert.equal(state.answer, 'hello:docs:hello');
  });
});
