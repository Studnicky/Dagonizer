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

const RETRIEVAL_SEARCH_DAG_IRI = 'urn:noocodec:dag:retrieval-search';
const RETRIEVAL_SEARCH_NODE_IRI = 'urn:noocodec:dag:retrieval-search/node/search';
const RETRIEVAL_SEARCH_DONE_IRI = 'urn:noocodec:dag:retrieval-search/node/done';
const ANSWER_QUESTION_DAG_IRI = 'urn:noocodec:dag:answer-question';
const ANSWER_QUESTION_RETRIEVE_IRI = 'urn:noocodec:dag:answer-question/node/retrieve';
const ANSWER_QUESTION_ANSWER_IRI = 'urn:noocodec:dag:answer-question/node/answer';
const ANSWER_QUESTION_DONE_IRI = 'urn:noocodec:dag:answer-question/node/done';
const ANSWER_QUESTION_FAILED_IRI = 'urn:noocodec:dag:answer-question/node/failed';
const DYNAMIC_PLUGIN_HOST_DAG_IRI = 'urn:noocodec:dag:dynamic-plugin-host';
const DYNAMIC_PLUGIN_HOST_CHOOSE_IRI = 'urn:noocodec:dag:dynamic-plugin-host/node/choose-child';
const DYNAMIC_PLUGIN_HOST_FAN_IRI = 'urn:noocodec:dag:dynamic-plugin-host/node/fan-out';
const DYNAMIC_PLUGIN_HOST_DONE_IRI = 'urn:noocodec:dag:dynamic-plugin-host/node/done';
const DYNAMIC_PLUGIN_HOST_FAILED_IRI = 'urn:noocodec:dag:dynamic-plugin-host/node/failed';
const DYNAMIC_PLUGIN_HOST_DEAD_IRI = 'urn:noocodec:dag:dynamic-plugin-host/node/dead-child';
const MULTI_ROOT_PLUGIN_HOST_DAG_IRI = 'urn:noocodec:dag:multi-root-plugin-host';
const MULTI_ROOT_PLUGIN_HOST_LEFT_IRI = 'urn:noocodec:dag:multi-root-plugin-host/node/left-root';
const MULTI_ROOT_PLUGIN_HOST_LEFT_DONE_IRI = 'urn:noocodec:dag:multi-root-plugin-host/node/left-done';
const MULTI_ROOT_PLUGIN_HOST_RIGHT_IRI = 'urn:noocodec:dag:multi-root-plugin-host/node/right-root';
const MULTI_ROOT_PLUGIN_HOST_RIGHT_DONE_IRI = 'urn:noocodec:dag:multi-root-plugin-host/node/right-done';
const MULTI_ROOT_PLUGIN_HOST_FAILED_IRI = 'urn:noocodec:dag:multi-root-plugin-host/node/failed';
const PLUGIN_CHILD_DAG_IRI = 'urn:noocodec:dag:plugin-child';
const PLUGIN_CHILD_DONE_IRI = 'urn:noocodec:dag:plugin-child/node/done';
const PLUGIN_HOST_DAG_IRI = 'urn:noocodec:dag:plugin-host';
const PLUGIN_HOST_INVOKE_IRI = 'urn:noocodec:dag:plugin-host/node/invoke';
const PLUGIN_HOST_DONE_IRI = 'urn:noocodec:dag:plugin-host/node/done';

void describe('plugin-authored embedded DAGs', () => {
  void it('execute through the same embed path as local DAGs', async () => {
    const searchNode = TestNode.make<SharedState>('urn:noocodec:node:search', ['success'], (state) => {
      state.documents = `docs:${state.query}`;
      return 'success';
    });
    const answerNode = TestNode.make<SharedState>('urn:noocodec:node:answer', ['success'], (state) => {
      state.answer = `${state.query}:${state.documents}`;
      return 'success';
    });

    const childDag = new DAGBuilder(RETRIEVAL_SEARCH_DAG_IRI, '1', { 'name': 'retrieval:search' })
      .node(RETRIEVAL_SEARCH_NODE_IRI, searchNode, { 'success': RETRIEVAL_SEARCH_DONE_IRI }, { 'name': 'search' })
      .terminal(RETRIEVAL_SEARCH_DONE_IRI, { 'name': 'done' })
      .build();

    const plugin = defineDagonizerPlugin({
      'id': '@example/retrieval-plugin',
      'context': { 'retrieval': 'https://noocodec.dev/plugins/retrieval#' },
      'nodes': [searchNode],
      'dags': [childDag],
      'exports': { 'search': RETRIEVAL_SEARCH_DAG_IRI },
    });

    const parentDag = new DAGBuilder(ANSWER_QUESTION_DAG_IRI, '1', { 'name': 'answer-question' })
      .embed(ANSWER_QUESTION_RETRIEVE_IRI, plugin.exports.search, {
        'success': ANSWER_QUESTION_ANSWER_IRI,
        'error': ANSWER_QUESTION_FAILED_IRI,
      }, {
        'name': 'retrieve',
        'inputs': { 'query': 'query' },
        'outputs': { 'documents': 'documents' },
      })
      .node(ANSWER_QUESTION_ANSWER_IRI, answerNode, { 'success': ANSWER_QUESTION_DONE_IRI }, { 'name': 'answer' })
      .terminal(ANSWER_QUESTION_DONE_IRI, { 'name': 'done' })
      .terminal(ANSWER_QUESTION_FAILED_IRI, { 'name': 'failed', 'outcome': 'failed' })
      .build();

    const dispatcher = new Dagonizer<SharedState>();
    dispatcher.registerPlugin(plugin);
    dispatcher.registerNode(answerNode);
    dispatcher.registerDAG(parentDag);

    const state = new SharedState();
    state.query = 'hello';

    const result = await dispatcher.execute(ANSWER_QUESTION_DAG_IRI, state);

    assert.equal(result.terminalOutcome, 'completed');
    assert.equal(state.documents, 'docs:hello');
    assert.equal(state.answer, 'hello:docs:hello');
  });
});

void describe('PluginDiscovery', () => {
  void it('collects literal and dynamic DagReference candidate DAG IRIs', () => {
    const parentDag = new DAGBuilder(DYNAMIC_PLUGIN_HOST_DAG_IRI, '1', { 'name': 'dynamic-plugin-host' })
      .embed(DYNAMIC_PLUGIN_HOST_CHOOSE_IRI, {
        'from': 'state',
        'path': 'selectedDag',
        'candidates': ['urn:noocodec:dag:plugin-a', 'urn:noocodec:dag:plugin-b'],
      }, { 'success': DYNAMIC_PLUGIN_HOST_FAN_IRI, 'error': DYNAMIC_PLUGIN_HOST_FAILED_IRI }, { 'name': 'choose-child' })
      .scatter(DYNAMIC_PLUGIN_HOST_FAN_IRI, 'items', {
        'dag': {
          'from': 'item',
          'path': 'dagIri',
          'candidates': ['urn:noocodec:dag:plugin-c', 'urn:noocodec:dag:plugin-d'],
        },
      }, {
        'all-success': DYNAMIC_PLUGIN_HOST_DONE_IRI,
        'partial':     DYNAMIC_PLUGIN_HOST_DONE_IRI,
        'all-error':   DYNAMIC_PLUGIN_HOST_FAILED_IRI,
        'empty':       DYNAMIC_PLUGIN_HOST_DONE_IRI,
      }, { 'name': 'fan-out' })
      .terminal(DYNAMIC_PLUGIN_HOST_DONE_IRI, { 'name': 'done' })
      .terminal(DYNAMIC_PLUGIN_HOST_FAILED_IRI, { 'name': 'failed', 'outcome': 'failed' })
      .embed(DYNAMIC_PLUGIN_HOST_DEAD_IRI, 'urn:noocodec:dag:plugin:dead', { 'success': DYNAMIC_PLUGIN_HOST_DONE_IRI, 'error': DYNAMIC_PLUGIN_HOST_FAILED_IRI }, { 'name': 'dead-child' })
      .build();

    assert.deepEqual(
      PluginDiscovery.referencedDagIris(parentDag),
      [
        'urn:noocodec:dag:plugin-a',
        'urn:noocodec:dag:plugin-b',
        'urn:noocodec:dag:plugin-c',
        'urn:noocodec:dag:plugin-d',
      ],
    );
  });

  void it('walks every DAG entrypoint root when collecting candidate DAG IRIs', () => {
    const parentDag = new DAGBuilder(MULTI_ROOT_PLUGIN_HOST_DAG_IRI, '1', { 'name': 'multi-root-plugin-host' })
      .embed(MULTI_ROOT_PLUGIN_HOST_LEFT_IRI, 'urn:noocodec:dag:plugin-left', { 'success': MULTI_ROOT_PLUGIN_HOST_LEFT_DONE_IRI, 'error': MULTI_ROOT_PLUGIN_HOST_FAILED_IRI }, { 'name': 'left-root' })
      .terminal(MULTI_ROOT_PLUGIN_HOST_LEFT_DONE_IRI, { 'name': 'left-done' })
      .scatter(MULTI_ROOT_PLUGIN_HOST_RIGHT_IRI, 'items', {
        'dag': {
          'from': 'item',
          'path': 'dagIri',
          'candidates': ['urn:noocodec:dag:plugin-right-a', 'urn:noocodec:dag:plugin-right-b'],
        },
      }, {
        'all-success': MULTI_ROOT_PLUGIN_HOST_RIGHT_DONE_IRI,
        'partial':     MULTI_ROOT_PLUGIN_HOST_RIGHT_DONE_IRI,
        'all-error':   MULTI_ROOT_PLUGIN_HOST_FAILED_IRI,
        'empty':       MULTI_ROOT_PLUGIN_HOST_RIGHT_DONE_IRI,
      }, { 'name': 'right-root' })
      .terminal(MULTI_ROOT_PLUGIN_HOST_RIGHT_DONE_IRI, { 'name': 'right-done' })
      .terminal(MULTI_ROOT_PLUGIN_HOST_FAILED_IRI, { 'name': 'failed', 'outcome': 'failed' })
      .entrypoints({
        'left': MULTI_ROOT_PLUGIN_HOST_LEFT_IRI,
        'right': MULTI_ROOT_PLUGIN_HOST_RIGHT_IRI,
      })
      .build();

    assert.deepEqual(
      PluginDiscovery.referencedDagIris(parentDag),
      [
        'urn:noocodec:dag:plugin-left',
        'urn:noocodec:dag:plugin-right-a',
        'urn:noocodec:dag:plugin-right-b',
      ],
    );
  });

  void it('walks DAG registries by expanded DAG IRI', () => {
    const childDag = new DAGBuilder(PLUGIN_CHILD_DAG_IRI, 'urn:noocodec:dag:1', { 'name': 'plugin:child' })
      .terminal(PLUGIN_CHILD_DONE_IRI, { 'name': 'done' })
      .build();
    const parentDag = new DAGBuilder(PLUGIN_HOST_DAG_IRI, '1', { 'name': 'plugin-host' })
      .embed(PLUGIN_HOST_INVOKE_IRI, PLUGIN_CHILD_DAG_IRI, {
        'success': PLUGIN_HOST_DONE_IRI,
        'error': PLUGIN_HOST_DONE_IRI,
      }, { 'name': 'invoke' })
      .terminal(PLUGIN_HOST_DONE_IRI, { 'name': 'done' })
      .build();

    assert.deepEqual(
      PluginDiscovery.walk(parentDag, new Map([[DagGraphProjector.dagIri(childDag), childDag]])),
      [DagGraphProjector.dagIri(parentDag), DagGraphProjector.dagIri(childDag)],
    );
  });
});
