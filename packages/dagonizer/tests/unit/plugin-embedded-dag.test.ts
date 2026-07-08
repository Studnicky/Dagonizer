import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DAGBuilder } from '../../src/builder/DAGBuilder.js';
import { Dagonizer } from '../../src/Dagonizer.js';
import { DagGraphProjector } from '../../src/graph/DagGraphProjector.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';
import { defineDagonizerPlugin } from '../../src/plugin/defineDagonizerPlugin.js';
import { PluginDiscovery } from '../../src/plugin/PluginDiscovery.js';
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

void describe('PluginDiscovery', () => {
  void it('collects literal and dynamic DagReference candidate DAG names', () => {
    const parentDag = new DAGBuilder('dynamic-plugin-host', '1')
      .embed('choose-child', {
        'from': 'state',
        'path': 'selectedDag',
        'candidates': ['plugin:a', 'plugin:b'],
      }, { 'success': 'fan-out', 'error': 'failed' })
      .scatter('fan-out', 'items', {
        'dag': {
          'from': 'item',
          'path': 'dagName',
          'candidates': ['plugin:c', 'plugin:d'],
        },
      }, {
        'all-success': 'done',
        'partial':     'done',
        'all-error':   'failed',
        'empty':       'done',
      }, {})
      .terminal('done')
      .terminal('failed', { 'outcome': 'failed' })
      .embed('dead-child', 'plugin:dead', { 'success': 'done', 'error': 'failed' })
      .build();

    assert.deepEqual(
      PluginDiscovery.referencedDagNames(parentDag),
      ['plugin:a', 'plugin:b', 'plugin:c', 'plugin:d'],
    );
    assert.deepEqual(
      PluginDiscovery.referencedDagIris(parentDag),
      [
        'https://noocodex.dev/dag/default#plugin:a',
        'https://noocodex.dev/dag/default#plugin:b',
        'https://noocodex.dev/dag/default#plugin:c',
        'https://noocodex.dev/dag/default#plugin:d',
      ],
    );
  });

  void it('walks every DAG entrypoint root when collecting candidate DAG names', () => {
    const parentDag = new DAGBuilder('multi-root-plugin-host', '1')
      .embed('left-root', 'plugin:left', { 'success': 'left-done', 'error': 'failed' })
      .terminal('left-done')
      .scatter('right-root', 'items', {
        'dag': {
          'from': 'item',
          'path': 'dagName',
          'candidates': ['plugin:right-a', 'plugin:right-b'],
        },
      }, {
        'all-success': 'right-done',
        'partial':     'right-done',
        'all-error':   'failed',
        'empty':       'right-done',
      }, {})
      .terminal('right-done')
      .terminal('failed', { 'outcome': 'failed' })
      .entrypoints({ 'left': 'left-root', 'right': 'right-root' })
      .build();

    assert.deepEqual(
      PluginDiscovery.referencedDagNames(parentDag),
      ['plugin:left', 'plugin:right-a', 'plugin:right-b'],
    );
  });

  void it('walks DAG registries by expanded DAG IRI', () => {
    const childDag = new DAGBuilder('plugin:child', '1')
      .terminal('done')
      .build();
    const parentDag = new DAGBuilder('plugin-host', '1')
      .embed('invoke', 'plugin:child', { 'success': 'done', 'error': 'done' })
      .terminal('done')
      .build();

    assert.deepEqual(
      PluginDiscovery.walk(parentDag, new Map([[DagGraphProjector.dagIri(childDag), childDag]])),
      [DagGraphProjector.dagIri(parentDag), DagGraphProjector.dagIri(childDag)],
    );
  });
});
