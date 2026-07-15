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

const HOST_DAG_IRI = 'https://example.test/plugin#host';
const HOST_CHOOSE_IRI = 'https://example.test/plugin#host/node/choose';
const HOST_FAN_IRI = 'https://example.test/plugin#host/node/fan';
const HOST_DONE_IRI = 'https://example.test/plugin#host/node/done';
const HOST_FAILED_IRI = 'https://example.test/plugin#host/node/failed';
const HOST_DEAD_IRI = 'https://example.test/plugin#host/node/dead';

const MULTI_ROOT_DAG_IRI = 'urn:noocodec:dag:multi-root';
const MULTI_ROOT_LEFT_DONE_IRI = 'urn:noocodec:dag:multi-root/node/left-done';
const MULTI_ROOT_RIGHT_DONE_IRI = 'urn:noocodec:dag:multi-root/node/right-done';

const GATHER_HOST_DAG_IRI = 'urn:noocodec:dag:gather-host';
const GATHER_HOST_LEFT_IRI = 'urn:noocodec:dag:gather-host/node/left';
const GATHER_HOST_RIGHT_IRI = 'urn:noocodec:dag:gather-host/node/right';
const GATHER_HOST_JOIN_IRI = 'urn:noocodec:dag:gather-host/node/join';
const GATHER_HOST_DONE_IRI = 'urn:noocodec:dag:gather-host/node/done';
const GATHER_HOST_FAILED_IRI = 'urn:noocodec:dag:gather-host/node/failed';
const GATHER_HOST_LEFT_ENTRYPOINT_IRI = 'urn:noocodec:dag:gather-host/entrypoint/left';
const GATHER_HOST_RIGHT_ENTRYPOINT_IRI = 'urn:noocodec:dag:gather-host/entrypoint/right';

const SCHEMA_HOST_DAG_IRI = 'urn:noocodec:dag:schema-host';
const SCHEMA_HOST_STEP_IRI = 'urn:noocodec:dag:schema-host/node/step';
const SCHEMA_HOST_DONE_IRI = 'urn:noocodec:dag:schema-host/node/done';

const SCALE_PROJECTION_DAG_IRI = 'urn:noocodec:dag:scale-projection';
const SCALE_CANDIDATES_DAG_IRI = 'urn:noocodec:dag:scale-candidates';
const SCALE_CANDIDATES_DONE_IRI = 'urn:noocodec:dag:scale-candidates/node/done';
const SCALE_CANDIDATES_FAILED_IRI = 'urn:noocodec:dag:scale-candidates/node/failed';

const EDGE_HOST_DAG_IRI = 'https://example.test/plugin#edge-host';
const EDGE_HOST_LITERAL_CHILD_IRI = 'https://example.test/plugin#edge-host/node/literal-child';
const EDGE_HOST_DYNAMIC_CHILD_IRI = 'https://example.test/plugin#edge-host/node/dynamic-child';
const EDGE_HOST_DONE_IRI = 'https://example.test/plugin#edge-host/node/done';
const EDGE_HOST_FAILED_IRI = 'https://example.test/plugin#edge-host/node/failed';
const LITERAL_CHILD_DAG_IRI = 'https://example.test/plugin#literal-child';
const LITERAL_CHILD_DONE_IRI = 'https://example.test/plugin#literal-child/node/done';
const DYNAMIC_CHILD_DAG_IRI = 'https://example.test/plugin#dynamic-child';
const DYNAMIC_CHILD_DONE_IRI = 'https://example.test/plugin#dynamic-child/node/done';

const SELF_LOOP_DAG_IRI = 'https://example.test/plugin#self-loop';
const SELF_LOOP_SELF_IRI = 'https://example.test/plugin#self-loop/node/self';
const SELF_LOOP_DONE_IRI = 'https://example.test/plugin#self-loop/node/done';
const SELF_LOOP_FAILED_IRI = 'https://example.test/plugin#self-loop/node/failed';
const LEFT_LOOP_DAG_IRI = 'https://example.test/plugin#left-loop';
const LEFT_LOOP_RIGHT_IRI = 'https://example.test/plugin#left-loop/node/right';
const LEFT_LOOP_DONE_IRI = 'https://example.test/plugin#left-loop/node/done';
const LEFT_LOOP_FAILED_IRI = 'https://example.test/plugin#left-loop/node/failed';
const RIGHT_LOOP_DAG_IRI = 'https://example.test/plugin#right-loop';
const RIGHT_LOOP_LEFT_IRI = 'https://example.test/plugin#right-loop/node/left';
const RIGHT_LOOP_DONE_IRI = 'https://example.test/plugin#right-loop/node/done';
const RIGHT_LOOP_FAILED_IRI = 'https://example.test/plugin#right-loop/node/failed';

function withGraphContext(dag: DAGType): DAGType {
  return { ...dag, '@context': GRAPH_CONTEXT };
}

function dynamicReference(candidate: string, path: string): StateDAGReferenceInputType {
  const candidates: [string, ...string[]] = [candidate];
  return { 'from': 'state', path, candidates };
}

void describe('DagGraphProjector', () => {
  void it('stores and matches RDF 1.2 triple terms as annotation objects', () => {
    const store = DagGraphProjector.store(withGraphContext(new DAGBuilder(
      'urn:noocodec:dag:rdf12-terms',
      '1',
      { 'name': 'rdf12-terms' },
    ).terminal('urn:noocodec:dag:rdf12-terms/node/done', { 'name': 'done' }).build()));
    const subject = DagGraphTerms.namedNode('urn:noocodec:dag:rdf12-terms/node/step');
    const predicate = DagGraphTerms.predicate('route');
    const object = DagGraphTerms.namedNode('urn:noocodec:dag:rdf12-terms/node/done');
    const annotation = DagGraphTerms.namedNode('urn:noocodec:annotation/route');
    const triple = DagGraphTerms.tripleTerm(subject, predicate, object);

    store.assert(annotation, DagGraphTerms.predicate('reifies'), triple);

    const rows = store.select({
      'subject': annotation,
      'predicate': DagGraphTerms.predicate('reifies'),
      'object': DagGraphTerms.tripleTerm(subject, predicate, object),
    });
    assert.equal(rows.length, 1);
    assert.equal(store.count({ 'object': triple }), 1);
  });

  void it('projects reachable literal and dynamic DAG references as expanded IRIs', () => {
    const dag = withGraphContext(new DAGBuilder(HOST_DAG_IRI, '1', { 'name': 'host' })
      .embed(HOST_CHOOSE_IRI, {
        'from': 'state',
        'path': 'selectedDag',
        'candidates': ['plugin:left', 'plugin:right'],
      }, { 'success': HOST_FAN_IRI, 'error': HOST_FAILED_IRI }, { 'name': 'choose' })
      .scatter(HOST_FAN_IRI, 'items', {
        'dag': {
          'from': 'item',
          'path': 'dag',
          'candidates': ['plugin:item-a', 'plugin:item-b'],
        },
      }, {
        'all-success': HOST_DONE_IRI,
        'partial':     HOST_DONE_IRI,
        'all-error':   HOST_FAILED_IRI,
        'empty':       HOST_DONE_IRI,
      }, { 'name': 'fan' })
      .terminal(HOST_DONE_IRI, { 'name': 'done' })
      .terminal(HOST_FAILED_IRI, { 'name': 'failed', 'outcome': 'failed' })
      .embed(HOST_DEAD_IRI, 'plugin:dead', { 'success': HOST_DONE_IRI, 'error': HOST_FAILED_IRI }, { 'name': 'dead' })
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
    const dag = withGraphContext(new DAGBuilder(MULTI_ROOT_DAG_IRI, '1', { 'name': 'multi-root' })
      .terminal(MULTI_ROOT_LEFT_DONE_IRI, { 'name': 'left-done' })
      .terminal(MULTI_ROOT_RIGHT_DONE_IRI, { 'name': 'right-done' })
      .entrypoints({
        'left': MULTI_ROOT_LEFT_DONE_IRI,
        'right': MULTI_ROOT_RIGHT_DONE_IRI,
      })
      .build());
    const store = DagGraphProjector.store(dag);

    assert.deepEqual(
      [...DagGraphQueries.entryTargets(store).entries()],
      [
        ['left', MULTI_ROOT_LEFT_DONE_IRI],
        ['right', MULTI_ROOT_RIGHT_DONE_IRI],
      ],
    );
    assert.deepEqual(
      DagGraphQueries.reachablePlacementIris(store),
      [MULTI_ROOT_LEFT_DONE_IRI, MULTI_ROOT_RIGHT_DONE_IRI],
    );
  });

  void it('projects gather sources and runtime selected DAG bindings', () => {
    const leftNode = TestNode.make('urn:noocodec:node:left-node', ['success'], () => 'success');
    const rightNode = TestNode.make('urn:noocodec:node:right-node', ['success'], () => 'success');
    const dag = withGraphContext(new DAGBuilder(GATHER_HOST_DAG_IRI, '1', { 'name': 'gather-host' })
      .node(GATHER_HOST_LEFT_IRI, leftNode, { 'success': GATHER_HOST_JOIN_IRI }, { 'name': 'left' })
      .node(GATHER_HOST_RIGHT_IRI, rightNode, { 'success': GATHER_HOST_JOIN_IRI }, { 'name': 'right' })
      .gather(GATHER_HOST_JOIN_IRI, {
        [GATHER_HOST_LEFT_ENTRYPOINT_IRI]: {},
        [GATHER_HOST_RIGHT_ENTRYPOINT_IRI]: {},
      }, { 'strategy': 'append', 'target': 'items' }, {
        'success': GATHER_HOST_DONE_IRI,
        'error': GATHER_HOST_FAILED_IRI,
      }, { 'name': 'join' })
      .terminal(GATHER_HOST_DONE_IRI, { 'name': 'done' })
      .terminal(GATHER_HOST_FAILED_IRI, { 'name': 'failed', 'outcome': 'failed' })
      .entrypoints({
        'left': GATHER_HOST_LEFT_IRI,
        'right': GATHER_HOST_RIGHT_IRI,
      })
      .build());
    const store = DagGraphProjector.store(dag);
    const joinIri = dag.nodes.find((placement) => placement.name === 'join')?.['@id'] ?? '';
    const selectedDagIri = ContextResolver.expand('plugin:selected', GRAPH_CONTEXT);

    DagGraphProjector.bindSelectedDag(store, joinIri, selectedDagIri);

    assert.deepEqual(
      store.select({
        'subject': DagGraphTerms.namedNode(joinIri),
        'predicate': DagGraphTerms.predicate('source'),
        'object': '?source',
      }).map((row) => row['source']?.value),
      [
        `${joinIri}/source/${encodeURIComponent(GATHER_HOST_LEFT_ENTRYPOINT_IRI)}`,
        `${joinIri}/source/${encodeURIComponent(GATHER_HOST_RIGHT_ENTRYPOINT_IRI)}`,
      ],
    );
    assert.deepEqual(DagGraphQueries.selectedDagIris(store), [selectedDagIri]);
  });

  void it('projects registered node input and output schemas onto placement ports', () => {
    const node = TestNode.make('urn:noocodec:node:schema-node', ['success'], () => 'success');
    const dag = withGraphContext(new DAGBuilder(SCHEMA_HOST_DAG_IRI, '1', { 'name': 'schema-host' })
      .node(SCHEMA_HOST_STEP_IRI, node, { 'success': SCHEMA_HOST_DONE_IRI }, { 'name': 'step' })
      .terminal(SCHEMA_HOST_DONE_IRI, { 'name': 'done' })
      .build());
    const placementIriValue = dag.nodes.find((placement) => placement.name === 'step')?.['@id'] ?? '';
    const schemas = new SchemaRegistry();
    const store = DagGraphProjector.store(dag);

    DagGraphProjector.projectNodeSchemas({
      dag,
      'nodes': new Map([[node['@id'], node]]),
      schemas,
      store,
    });

    const inputSchemaIri = DagGraphQueries.placementInputSchemaIri(store, placementIriValue);
    const outputSchemaIri = DagGraphQueries.placementOutputSchemaIri(store, placementIriValue, 'success');
    assert.equal(typeof inputSchemaIri, 'string');
    assert.equal(typeof outputSchemaIri, 'string');
    assert.equal(schemas.has(inputSchemaIri ?? ''), true);
    assert.equal(schemas.has(outputSchemaIri ?? ''), true);
  });

  void it('annotates RDF 1.2 route statements with producer and consumer schemas', () => {
    const first = TestNode.make('urn:noocodec:node:rdf12-first', ['success'], () => 'success');
    const second = TestNode.make('urn:noocodec:node:rdf12-second', ['success'], () => 'success');
    const firstIri = 'urn:noocodec:dag:rdf12-route/node/first';
    const secondIri = 'urn:noocodec:dag:rdf12-route/node/second';
    const dag = new DAGBuilder('urn:noocodec:dag:rdf12-route', '1', { 'name': 'rdf12-route' })
      .node(firstIri, first, { 'success': secondIri }, { 'name': 'first' })
      .node(secondIri, second, { 'success': 'urn:noocodec:dag:rdf12-route/node/done' }, { 'name': 'second' })
      .terminal('urn:noocodec:dag:rdf12-route/node/done', { 'name': 'done' })
      .build();
    const schemas = new SchemaRegistry();
    const store = DagGraphProjector.store(dag);

    DagGraphProjector.projectNodeSchemas({
      dag,
      'nodes': new Map([[first['@id'], first], [second['@id'], second]]),
      schemas,
      store,
    });

    const routeSchemas = DagGraphQueries.routeSchemaIris(store, firstIri, secondIri);
    const firstOutputSchema = first.outputSchema['success'];
    assert.ok(firstOutputSchema);
    assert.equal(routeSchemas.produced, schemas.register(firstOutputSchema));
    assert.equal(routeSchemas.required, schemas.register(second.inputSchema));
    assert.equal(
      store.count({
        'subject': DagGraphTerms.tripleTerm(
          DagGraphTerms.namedNode(firstIri),
          DagGraphTerms.predicate('route'),
          DagGraphTerms.namedNode(secondIri),
        ),
      }),
      2,
    );
  });

  void it('projects a large DAG with one thousand placements and five thousand route edges', () => {
    const placementCount = 1000;
    const routesPerPlacement = 5;
    const routeNames = ['a', 'b', 'c', 'd', 'e'];
    const node = TestNode.make('urn:noocodec:node:scale-node', routeNames);
    const builder = new DAGBuilder(SCALE_PROJECTION_DAG_IRI, '1', { 'name': 'scale-projection' });

    for (let index = 0; index < placementCount; index += 1) {
      const placementIri = `${SCALE_PROJECTION_DAG_IRI}/node/step-${index}`;
      const routes: Record<string, string> = {};
      for (let offset = 1; offset <= routesPerPlacement; offset += 1) {
        routes[routeNames[offset - 1] ?? 'a'] = `${SCALE_PROJECTION_DAG_IRI}/node/step-${(index + offset) % placementCount}`;
      }
      builder.node(placementIri, node, routes, { 'name': `step-${index}` });
    }

    const store = DagGraphProjector.store(withGraphContext(builder.build()));

    assert.equal(store.count({ 'predicate': DagGraphTerms.predicate('placement') }), placementCount);
    assert.equal(store.count({ 'predicate': DagGraphTerms.predicate('route') }), placementCount * routesPerPlacement);
    assert.equal(DagGraphQueries.reachablePlacementIris(store).length, placementCount);
  });

  void it('queries candidate DAG closure for one thousand reachable dynamic references', () => {
    const referenceCount = 1000;
    const builder = new DAGBuilder(SCALE_CANDIDATES_DAG_IRI, '1', { 'name': 'scale-candidates' });

    for (let index = 0; index < referenceCount; index += 1) {
      builder.embed(
        `${SCALE_CANDIDATES_DAG_IRI}/node/invoke-${index}`,
        dynamicReference(`plugin:child-${index}`, `routes.${index}`),
        {
          'success': index === referenceCount - 1 ? SCALE_CANDIDATES_DONE_IRI : `${SCALE_CANDIDATES_DAG_IRI}/node/invoke-${index + 1}`,
          'error':   SCALE_CANDIDATES_FAILED_IRI,
        },
        { 'name': `invoke-${index}` },
      );
    }
    builder.terminal(SCALE_CANDIDATES_DONE_IRI, { 'name': 'done' }).terminal(SCALE_CANDIDATES_FAILED_IRI, { 'name': 'failed', 'outcome': 'failed' });

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
    const host = withGraphContext(new DAGBuilder(EDGE_HOST_DAG_IRI, '1', { 'name': 'edge-host' })
      .embed(EDGE_HOST_LITERAL_CHILD_IRI, LITERAL_CHILD_DAG_IRI, {
        'success': EDGE_HOST_DYNAMIC_CHILD_IRI,
        'error': EDGE_HOST_FAILED_IRI,
      }, { 'name': 'literal-child' })
      .embed(EDGE_HOST_DYNAMIC_CHILD_IRI, dynamicReference(DYNAMIC_CHILD_DAG_IRI, 'selectedDag'), {
        'success': EDGE_HOST_DONE_IRI,
        'error': EDGE_HOST_FAILED_IRI,
      }, { 'name': 'dynamic-child' })
      .terminal(EDGE_HOST_DONE_IRI, { 'name': 'done' })
      .terminal(EDGE_HOST_FAILED_IRI, { 'name': 'failed', 'outcome': 'failed' })
      .build());
    const literalChild = withGraphContext(new DAGBuilder(LITERAL_CHILD_DAG_IRI, '1', { 'name': 'literal-child' }).terminal(LITERAL_CHILD_DONE_IRI, { 'name': 'done' }).build());
    const dynamicChild = withGraphContext(new DAGBuilder(DYNAMIC_CHILD_DAG_IRI, '1', { 'name': 'dynamic-child' }).terminal(DYNAMIC_CHILD_DONE_IRI, { 'name': 'done' }).build());
    const registry = new Map([
      [DagGraphProjector.dagIri(host), host],
      [DagGraphProjector.dagIri(literalChild), literalChild],
      [DagGraphProjector.dagIri(dynamicChild), dynamicChild],
    ]);

    assert.deepEqual(DagReferenceGraph.referenceEdges(registry), [
      {
        'sourceDagIri': 'https://example.test/plugin#edge-host',
        'sourcePlacement': EDGE_HOST_LITERAL_CHILD_IRI,
        'targetDagIri': 'https://example.test/plugin#literal-child',
        'dynamic': false,
      },
      {
        'sourceDagIri': 'https://example.test/plugin#edge-host',
        'sourcePlacement': EDGE_HOST_DYNAMIC_CHILD_IRI,
        'targetDagIri': 'https://example.test/plugin#dynamic-child',
        'dynamic': true,
      },
    ]);
  });

  void it('classifies self-recursive and mutually recursive DAG reference components', () => {
    const self = withGraphContext(new DAGBuilder(SELF_LOOP_DAG_IRI, '1', { 'name': 'self-loop' })
      .embed(SELF_LOOP_SELF_IRI, dynamicReference(SELF_LOOP_DAG_IRI, 'nextDag'), {
        'success': SELF_LOOP_DONE_IRI,
        'error': SELF_LOOP_FAILED_IRI,
      }, { 'name': 'self' })
      .terminal(SELF_LOOP_DONE_IRI, { 'name': 'done' })
      .terminal(SELF_LOOP_FAILED_IRI, { 'name': 'failed', 'outcome': 'failed' })
      .build());
    const left = withGraphContext(new DAGBuilder(LEFT_LOOP_DAG_IRI, '1', { 'name': 'left-loop' })
      .embed(LEFT_LOOP_RIGHT_IRI, RIGHT_LOOP_DAG_IRI, {
        'success': LEFT_LOOP_DONE_IRI,
        'error': LEFT_LOOP_FAILED_IRI,
      }, { 'name': 'right' })
      .terminal(LEFT_LOOP_DONE_IRI, { 'name': 'done' })
      .terminal(LEFT_LOOP_FAILED_IRI, { 'name': 'failed', 'outcome': 'failed' })
      .build());
    const right = withGraphContext(new DAGBuilder(RIGHT_LOOP_DAG_IRI, '1', { 'name': 'right-loop' })
      .embed(RIGHT_LOOP_LEFT_IRI, LEFT_LOOP_DAG_IRI, {
        'success': RIGHT_LOOP_DONE_IRI,
        'error': RIGHT_LOOP_FAILED_IRI,
      }, { 'name': 'left' })
      .terminal(RIGHT_LOOP_DONE_IRI, { 'name': 'done' })
      .terminal(RIGHT_LOOP_FAILED_IRI, { 'name': 'failed', 'outcome': 'failed' })
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
