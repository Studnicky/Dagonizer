import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DAGBuilder } from '../../src/builder/DAGBuilder.js';
import { ContextResolver } from '../../src/dag/ContextResolver.js';
import type { DAGType } from '../../src/entities/index.js';
import { DAG_CONTEXT } from '../../src/entities/index.js';
import { DagGraphProjector } from '../../src/graph/DagGraphProjector.js';
import { DagGraphQueries } from '../../src/graph/DagGraphQueries.js';
import { DagGraphTerms } from '../../src/graph/DagGraphTerms.js';
import { TestNode } from '../_support/TestNode.js';

const GRAPH_CONTEXT = {
  ...DAG_CONTEXT,
  'plugin': 'https://example.test/plugin#',
};

function withGraphContext(dag: DAGType): DAGType {
  return { ...dag, '@context': GRAPH_CONTEXT };
}

void describe('DagGraphProjector', () => {
  void it('projects reachable literal and dynamic DAG references as expanded IRIs', () => {
    const dag = withGraphContext(new DAGBuilder('plugin:host', '1')
      .embed('choose', {
        'from': 'state',
        'path': 'selectedDag',
        'candidates': ['plugin:left', 'plugin:right'],
      }, { 'success': 'fan', 'error': 'failed' })
      .scatter('fan', 'items', {
        'dag': {
          'from': 'item',
          'path': 'dag',
          'candidates': ['plugin:item-a', 'plugin:item-b'],
        },
      }, {
        'all-success': 'done',
        'partial':     'done',
        'all-error':   'failed',
        'empty':       'done',
      }, {})
      .terminal('done')
      .terminal('failed', { 'outcome': 'failed' })
      .embed('dead', 'plugin:dead', { 'success': 'done', 'error': 'failed' })
      .build());

    const store = DagGraphProjector.store(dag);

    assert.deepEqual(
      DagGraphQueries.reachableCandidateDagIris(store),
      [
        'https://example.test/plugin#left',
        'https://example.test/plugin#right',
        'https://example.test/plugin#item-a',
        'https://example.test/plugin#item-b',
      ],
    );
    assert.equal(DagGraphQueries.candidateDagIris(store).includes('https://example.test/plugin#dead'), true);
  });

  void it('projects every entrypoint target and reachable placement route', () => {
    const dag = withGraphContext(new DAGBuilder('multi-root', '1')
      .terminal('left-done')
      .terminal('right-done')
      .entrypoints({ 'left': 'left-done', 'right': 'right-done' })
      .build());
    const dagIri = DagGraphProjector.dagIri(dag);
    const store = DagGraphProjector.store(dag);

    assert.deepEqual(
      [...DagGraphQueries.entryTargets(store).entries()],
      [
        ['left', `${dagIri}#left-done`],
        ['right', `${dagIri}#right-done`],
      ],
    );
    assert.deepEqual(
      DagGraphQueries.reachablePlacementIris(store),
      [`${dagIri}#left-done`, `${dagIri}#right-done`],
    );
  });

  void it('projects gather sources and runtime selected DAG bindings', () => {
    const leftNode = TestNode.make('left-node', ['success'], () => 'success');
    const rightNode = TestNode.make('right-node', ['success'], () => 'success');
    const dag = withGraphContext(new DAGBuilder('gather-host', '1')
      .node('left', leftNode, { 'success': 'join' })
      .node('right', rightNode, { 'success': 'join' })
      .gather('join', ['left', 'right'], { 'strategy': 'append', 'target': 'items' }, { 'success': 'done', 'error': 'failed' })
      .terminal('done')
      .terminal('failed', { 'outcome': 'failed' })
      .entrypoints({ 'left': 'left', 'right': 'right' })
      .build());
    const dagIri = DagGraphProjector.dagIri(dag);
    const store = DagGraphProjector.store(dag);
    const joinIri = DagGraphProjector.placementIri(dagIri, 'join');
    const selectedDagIri = ContextResolver.expand('plugin:selected', GRAPH_CONTEXT);

    DagGraphProjector.bindSelectedDag(store, joinIri, selectedDagIri);

    assert.deepEqual(
      store.select({
        'subject': DagGraphTerms.namedNode(joinIri),
        'predicate': DagGraphTerms.predicate('source'),
        'object': '?source',
      }).map((row) => row['source']?.value),
      ['left', 'right'],
    );
    assert.deepEqual(DagGraphQueries.selectedDagIris(store), [selectedDagIri]);
  });
});
