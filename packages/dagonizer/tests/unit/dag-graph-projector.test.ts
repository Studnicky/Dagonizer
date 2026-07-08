import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DAGBuilder, type StateDAGReferenceInputType } from '../../src/builder/DAGBuilder.js';
import { ContextResolver } from '../../src/dag/ContextResolver.js';
import type { DAGType } from '../../src/entities/index.js';
import { DAG_CONTEXT } from '../../src/entities/index.js';
import { DagGraphProjector } from '../../src/graph/DagGraphProjector.js';
import { DagGraphQueries } from '../../src/graph/DagGraphQueries.js';
import { DagGraphTerms } from '../../src/graph/DagGraphTerms.js';
import { DagReferenceGraph } from '../../src/graph/DagReferenceGraph.js';
import { SchemaRegistry } from '../../src/schema/index.js';
import { TestNode } from '../_support/TestNode.js';

const GRAPH_CONTEXT = {
  ...DAG_CONTEXT,
  'plugin': 'https://example.test/plugin#',
};

function withGraphContext(dag: DAGType): DAGType {
  return { ...dag, '@context': GRAPH_CONTEXT };
}

function dynamicReference(candidate: string, path: string): StateDAGReferenceInputType {
  const candidates: [string, ...string[]] = [candidate];
  return { 'from': 'state', path, candidates };
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

  void it('projects registered node input and output schemas onto placement ports', () => {
    const node = TestNode.make('schema-node', ['success'], () => 'success');
    const dag = withGraphContext(new DAGBuilder('schema-host', '1')
      .node('step', node, { 'success': 'done' })
      .terminal('done')
      .build());
    const dagIri = DagGraphProjector.dagIri(dag);
    const placementIri = DagGraphProjector.placementIri(dagIri, 'step');
    const schemas = new SchemaRegistry();
    const store = DagGraphProjector.store(dag);

    DagGraphProjector.projectNodeSchemas({
      dag,
      'nodes': new Map([[ContextResolver.expand(node.name, GRAPH_CONTEXT), node]]),
      schemas,
      store,
    });

    const inputSchemaIri = DagGraphQueries.placementInputSchemaIri(store, placementIri);
    const outputSchemaIri = DagGraphQueries.placementOutputSchemaIri(store, placementIri, 'success');
    assert.equal(typeof inputSchemaIri, 'string');
    assert.equal(typeof outputSchemaIri, 'string');
    assert.equal(schemas.has(inputSchemaIri ?? ''), true);
    assert.equal(schemas.has(outputSchemaIri ?? ''), true);
  });

  void it('projects a large DAG with one thousand placements and five thousand route edges', () => {
    const placementCount = 1000;
    const routesPerPlacement = 5;
    const routeNames = ['a', 'b', 'c', 'd', 'e'];
    const node = TestNode.make('scale-node', routeNames);
    const builder = new DAGBuilder('scale-projection', '1');

    for (let index = 0; index < placementCount; index += 1) {
      const routes: Record<string, string> = {};
      for (let offset = 1; offset <= routesPerPlacement; offset += 1) {
        routes[routeNames[offset - 1] ?? 'a'] = `step-${(index + offset) % placementCount}`;
      }
      builder.node(`step-${index}`, node, routes);
    }

    const store = DagGraphProjector.store(withGraphContext(builder.build()));

    assert.equal(store.count({ 'predicate': DagGraphTerms.predicate('placement') }), placementCount);
    assert.equal(store.count({ 'predicate': DagGraphTerms.predicate('route') }), placementCount * routesPerPlacement);
    assert.equal(DagGraphQueries.reachablePlacementIris(store).length, placementCount);
  });

  void it('queries candidate DAG closure for one thousand reachable dynamic references', () => {
    const referenceCount = 1000;
    const builder = new DAGBuilder('scale-candidates', '1');

    for (let index = 0; index < referenceCount; index += 1) {
      builder.embed(
        `invoke-${index}`,
        dynamicReference(`plugin:child-${index}`, `routes.${index}`),
        {
          'success': index === referenceCount - 1 ? 'done' : `invoke-${index + 1}`,
          'error':   'failed',
        },
      );
    }
    builder.terminal('done').terminal('failed', { 'outcome': 'failed' });

    const store = DagGraphProjector.store(withGraphContext(builder.build()));
    const candidateIris = DagGraphQueries.reachableCandidateDagIris(store);
    const rows = DagGraphQueries.candidateDagRows(store);

    assert.equal(candidateIris.length, referenceCount);
    assert.equal(candidateIris[0], 'https://example.test/plugin#child-0');
    assert.equal(candidateIris[referenceCount - 1], 'https://example.test/plugin#child-999');
    assert.equal(rows.length, referenceCount);
    assert.equal(rows.every((row) => row.dynamic), true);
  });

  void it('extracts reference graph edges from projected DAG reference rows', () => {
    const host = withGraphContext(new DAGBuilder('plugin:edge-host', '1')
      .embed('literal-child', 'plugin:literal-child', { 'success': 'dynamic-child', 'error': 'failed' })
      .embed('dynamic-child', dynamicReference('plugin:dynamic-child', 'selectedDag'), { 'success': 'done', 'error': 'failed' })
      .terminal('done')
      .terminal('failed', { 'outcome': 'failed' })
      .build());
    const literalChild = withGraphContext(new DAGBuilder('plugin:literal-child', '1').terminal('done').build());
    const dynamicChild = withGraphContext(new DAGBuilder('plugin:dynamic-child', '1').terminal('done').build());
    const registry = new Map([
      [DagGraphProjector.dagIri(host), host],
      [DagGraphProjector.dagIri(literalChild), literalChild],
      [DagGraphProjector.dagIri(dynamicChild), dynamicChild],
    ]);

    assert.deepEqual(DagReferenceGraph.referenceEdges(registry), [
      {
        'sourceDagIri': 'https://example.test/plugin#edge-host',
        'sourcePlacement': 'literal-child',
        'targetDagIri': 'https://example.test/plugin#literal-child',
        'dynamic': false,
      },
      {
        'sourceDagIri': 'https://example.test/plugin#edge-host',
        'sourcePlacement': 'dynamic-child',
        'targetDagIri': 'https://example.test/plugin#dynamic-child',
        'dynamic': true,
      },
    ]);
  });

  void it('classifies self-recursive and mutually recursive DAG reference components', () => {
    const self = withGraphContext(new DAGBuilder('plugin:self-loop', '1')
      .embed('self', dynamicReference('plugin:self-loop', 'nextDag'), { 'success': 'done', 'error': 'failed' })
      .terminal('done')
      .terminal('failed', { 'outcome': 'failed' })
      .build());
    const left = withGraphContext(new DAGBuilder('plugin:left-loop', '1')
      .embed('right', 'plugin:right-loop', { 'success': 'done', 'error': 'failed' })
      .terminal('done')
      .terminal('failed', { 'outcome': 'failed' })
      .build());
    const right = withGraphContext(new DAGBuilder('plugin:right-loop', '1')
      .embed('left', 'plugin:left-loop', { 'success': 'done', 'error': 'failed' })
      .terminal('done')
      .terminal('failed', { 'outcome': 'failed' })
      .build());
    const registry = new Map([
      [DagGraphProjector.dagIri(self), self],
      [DagGraphProjector.dagIri(left), left],
      [DagGraphProjector.dagIri(right), right],
    ]);
    const edges = DagReferenceGraph.referenceEdges(registry);
    const components = DagReferenceGraph.stronglyConnectedComponents(registry.keys(), edges)
      .map((component) => [...component].sort())
      .sort((a, b) => a[0]?.localeCompare(b[0] ?? '') ?? 0);

    assert.equal(DagReferenceGraph.hasSelfEdge('https://example.test/plugin#self-loop', edges), true);
    assert.deepEqual(components, [
      ['https://example.test/plugin#left-loop', 'https://example.test/plugin#right-loop'],
      ['https://example.test/plugin#self-loop'],
    ]);
  });
});
