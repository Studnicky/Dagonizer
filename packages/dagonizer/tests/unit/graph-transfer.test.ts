import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { N3GraphDataset } from '../../src/adapter/N3GraphDataset.js';
import type { QuadType } from '../../src/contracts/TripleStoreInterface.js';
import { DagGraphTerms } from '../../src/graph/DagGraphTerms.js';
import { GraphStateTerms } from '../../src/graph/GraphStateTerms.js';
import { GraphRetentionManager, GraphStateJsonLdCodec, GraphStateTransferCodec, InMemoryGraphDataset, InMemoryGraphStateTransferStore } from '../../src/index.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';

const toAsync = async function* <T>(values: Iterable<T>): AsyncIterable<T> {
  for (const value of values) {
    yield value;
  }
};

void describe('GraphStateTransferCodec', () => {
  const transferIdentity = (runIri: string, graphIri: string) => ({
    'dagIri': `${runIri}#dag`,
    'placementPath': [`${graphIri}/placement`],
    'placementIri': `${graphIri}/placement`,
    'stateGraphIri': graphIri,
  });
  void it('round-trips RDF 1.2 triple terms and named graphs', () => {
    const graph = DagGraphTerms.namedNode('urn:dagonizer:run:test#state');
    const triple = DagGraphTerms.tripleTerm(
      DagGraphTerms.namedNode('urn:subject'),
      DagGraphTerms.namedNode('urn:predicate'),
      DagGraphTerms.literal('value'),
    );
    const source = [{
      "subject": DagGraphTerms.namedNode('urn:run'),
      "predicate": DagGraphTerms.namedNode('urn:annotation'),
      "object": triple,
      graph,
    }];

    const encoded = GraphStateTransferCodec.encode(source);
    const decoded = GraphStateTransferCodec.decode(encoded);
    assert.deepEqual(decoded, source);
  });

  void it('preserves literal language tags and explicit datatypes', () => {
    const graph = DagGraphTerms.namedNode('urn:terms:graph');
    const source = [
      { "subject": DagGraphTerms.namedNode('urn:terms:subject'), "predicate": DagGraphTerms.namedNode('urn:terms:label'), "object": DagGraphTerms.literal('bonjour', undefined, 'fr'), graph },
      { "subject": DagGraphTerms.namedNode('urn:terms:subject'), "predicate": DagGraphTerms.namedNode('urn:terms:count'), "object": DagGraphTerms.literal('42', GraphStateTerms.XSD.integer), graph },
    ];

    assert.deepEqual(GraphStateTransferCodec.decode(GraphStateTransferCodec.encode(source)), source);
  });

  void it('round-trips graph state through context-bound JSON-LD', () => {
    const graph = DagGraphTerms.namedNode('urn:state:jsonld#graph');
    const source = [
      { "subject": DagGraphTerms.namedNode('urn:state:jsonld:run'), "predicate": DagGraphTerms.namedNode(GraphStateTerms.DAGONIZER.Lifecycle), "object": DagGraphTerms.namedNode(GraphStateTerms.lifecycleVariantIri('running')), graph },
      { "subject": DagGraphTerms.namedNode('urn:state:jsonld:run'), "predicate": DagGraphTerms.namedNode('urn:state:jsonld:answer'), "object": DagGraphTerms.literal('42', GraphStateTerms.XSD.integer), graph },
      { "subject": DagGraphTerms.namedNode('urn:state:jsonld:run'), "predicate": DagGraphTerms.namedNode('urn:state:jsonld:label'), "object": DagGraphTerms.literal('bonjour', undefined, 'fr'), graph },
      { "subject": DagGraphTerms.namedNode('urn:state:jsonld:run'), "predicate": DagGraphTerms.namedNode('urn:state:jsonld:annotation'), "object": DagGraphTerms.tripleTerm(DagGraphTerms.namedNode('urn:subject'), DagGraphTerms.namedNode('urn:predicate'), DagGraphTerms.literal('object')), graph },
    ];

    const document = GraphStateJsonLdCodec.encode(source);
    assert.equal(document['@context']['dag'], GraphStateTerms.JSON_LD_CONTEXT['dag']);
    assert.ok(JSON.stringify(document).includes('lifecycle'));
    const annotation = document['@graph'][0]?.['@graph'].find((node) => node['@id'] === 'urn:state:jsonld:run')?.['urn:state:jsonld:annotation'];
    if (!Array.isArray(annotation) || annotation[0] === undefined || typeof annotation[0] !== 'object' || annotation[0] === null || Array.isArray(annotation[0])) assert.fail('expected RDF 1.2 Basic Encoding node');
    assert.equal(annotation[0]['@type'], 'rdf:TripleTerm');
    assert.deepEqual(GraphStateJsonLdCodec.decode(document), source);
  });

  void it('represents default-graph quads without inventing a graph IRI', () => {
    const source = [{
      "subject": DagGraphTerms.namedNode('urn:default:subject'),
      "predicate": DagGraphTerms.namedNode('urn:default:predicate'),
      "object": DagGraphTerms.literal('value'),
      "graph": DagGraphTerms.defaultGraph(),
    }];
    const document = GraphStateJsonLdCodec.encode(source);
    assert.equal(document['@graph'][0]?.['@id'], undefined);
    assert.deepEqual(GraphStateJsonLdCodec.decode(document), source);
  });

  void it('restores a Node.js boundary transfer from inline N-Quads payload', async () => {
    const runIri = 'urn:state:nquads-transfer';
    const graphIri = `${runIri}#state`;
    const source = [{
      "subject": DagGraphTerms.namedNode(runIri),
      "predicate": DagGraphTerms.namedNode('urn:state:nquads:value'),
      "object": DagGraphTerms.literal('from-nquads'),
      "graph": DagGraphTerms.namedNode(graphIri),
    }];
    const transfer = GraphStateTransferCodec.inlineSync([{ runIri, 'quads': source }]);
    const state = new NodeStateBase(new InMemoryGraphDataset(), runIri);
    const [part] = await GraphStateTransferCodec.restore(transfer, [{ 'id': runIri, runIri }], null);
    assert.ok(part !== undefined);
    await state.restoreGraph(part.runIri, part.quads);
    assert.deepEqual([...state.graphDataset.match({ "graph": DagGraphTerms.namedNode(graphIri) })], source);
  });

  void it('encodes a graph stream without collecting the source iterable', async () => {
    async function* source(): AsyncIterable<{ subject: ReturnType<typeof DagGraphTerms.namedNode>; predicate: ReturnType<typeof DagGraphTerms.namedNode>; object: ReturnType<typeof DagGraphTerms.literal>; graph: ReturnType<typeof DagGraphTerms.namedNode> }> {
      yield { "subject": DagGraphTerms.namedNode('urn:stream:s'), "predicate": DagGraphTerms.namedNode('urn:stream:p'), "object": DagGraphTerms.literal('one'), "graph": DagGraphTerms.namedNode('urn:stream:g') };
      yield { "subject": DagGraphTerms.namedNode('urn:stream:s'), "predicate": DagGraphTerms.namedNode('urn:stream:p'), "object": DagGraphTerms.literal('two'), "graph": DagGraphTerms.namedNode('urn:stream:g') };
    }
    const chunks: string[] = [];
    for await (const chunk of GraphStateTransferCodec.encodeStream(source())) chunks.push(chunk);
    assert.equal(GraphStateTransferCodec.decode(chunks.join('')).length, 2);
  });

  void it('applies an inline transfer through the shared graph dataset port', async () => {
    const source = [{
      "subject": DagGraphTerms.namedNode('urn:run'),
      "predicate": DagGraphTerms.namedNode('urn:key'),
      "object": DagGraphTerms.literal('value'),
      "graph": DagGraphTerms.namedNode('urn:run#state'),
    }];
    const transfer = GraphStateTransferCodec.inlineSync([{ 'runIri': 'urn:run', 'quads': source }]);
    const dataset = new InMemoryGraphDataset();
    const [part] = await GraphStateTransferCodec.restore(transfer, [{ 'id': 'urn:run', 'runIri': 'urn:run' }], null);
    assert.ok(part !== undefined);
    const restored: QuadType[] = [];
    for await (const quad of part.quads) restored.push(quad);
    dataset.add(restored);

    assert.equal(transfer.transport, 'inline-nquads');
    assert.deepEqual(transfer.graphIris, ['urn:run#state']);
    assert.equal(transfer.quadCount, 1);
    assert.ok(transfer.byteSize > 0);
    assert.deepEqual([...dataset.match({ "graph": DagGraphTerms.namedNode('urn:run#state') })], source);
  });

  void it('rejects empty and independently duplicated item identities', () => {
    const firstRunIri = 'urn:identity:first';
    const secondRunIri = 'urn:identity:second';
    const transfer = GraphStateTransferCodec.inlineSync([
      { 'runIri': firstRunIri, 'quads': [] },
      { 'runIri': secondRunIri, 'quads': [] },
    ]);

    assert.throws(
      () => GraphStateTransferCodec.validateIdentity(transfer, [{ 'id': '', 'runIri': firstRunIri }]),
      /item id must be non-empty/u,
    );
    assert.throws(
      () => GraphStateTransferCodec.validateIdentity(transfer, [{ 'id': 'first', 'runIri': '' }]),
      /item run IRI must be non-empty/u,
    );
    assert.throws(
      () => GraphStateTransferCodec.validateIdentity(transfer, [
        { 'id': 'duplicate', 'runIri': firstRunIri },
        { 'id': 'duplicate', 'runIri': secondRunIri },
      ]),
      /duplicate item id/u,
    );
    assert.throws(
      () => GraphStateTransferCodec.validateIdentity(transfer, [
        { 'id': 'first', 'runIri': firstRunIri },
        { 'id': 'second', 'runIri': firstRunIri },
      ]),
      /duplicate item run IRI/u,
    );
  });

  void it('requires transfer graph IRIs to be a duplicate-free exact item graph set', () => {
    const firstRunIri = 'urn:graph-identity:first';
    const secondRunIri = 'urn:graph-identity:second';
    const firstGraphIri = GraphStateTerms.runGraphIri(firstRunIri);
    const secondGraphIri = GraphStateTerms.runGraphIri(secondRunIri);
    const items = [
      { 'id': 'first', 'runIri': firstRunIri },
      { 'id': 'second', 'runIri': secondRunIri },
    ];
    const transfer = GraphStateTransferCodec.inlineSync([
      { 'runIri': firstRunIri, 'quads': [] },
      { 'runIri': secondRunIri, 'quads': [] },
    ]);

    assert.throws(
      () => GraphStateTransferCodec.validateIdentity({ ...transfer, 'graphIris': [firstGraphIri, firstGraphIri] }, items),
      /duplicate graph IRIs/u,
    );
    assert.throws(
      () => GraphStateTransferCodec.validateIdentity({ ...transfer, 'graphIris': [firstGraphIri] }, items),
      /do not exactly match item run graphs/u,
    );
    assert.throws(
      () => GraphStateTransferCodec.validateIdentity({ ...transfer, 'graphIris': [firstGraphIri, secondGraphIri, 'urn:graph-identity:extra#state'] }, items),
      /do not exactly match item run graphs/u,
    );
    assert.throws(
      () => GraphStateTransferCodec.validateIdentity({ ...transfer, 'graphIris': [firstGraphIri, 'urn:graph-identity:other#state'] }, items),
      /do not exactly match item run graphs/u,
    );
  });

  void it('requires response identity pairs to exactly equal request pairs', () => {
    const firstRunIri = 'urn:response-identity:first';
    const secondRunIri = 'urn:response-identity:second';
    const requestItems = [
      { 'id': 'first', 'runIri': firstRunIri },
      { 'id': 'second', 'runIri': secondRunIri },
    ];
    const transfer = GraphStateTransferCodec.inlineSync([
      { 'runIri': firstRunIri, 'quads': [] },
      { 'runIri': secondRunIri, 'quads': [] },
    ]);

    assert.throws(
      () => GraphStateTransferCodec.validateIdentity(
        { ...transfer, 'graphIris': [GraphStateTerms.runGraphIri(firstRunIri)] },
        [{ 'id': 'first', 'runIri': firstRunIri }],
        requestItems,
      ),
      /response identities do not exactly match request identities/u,
    );
    assert.throws(
      () => GraphStateTransferCodec.validateIdentity(
        GraphStateTransferCodec.inlineSync([
          { 'runIri': firstRunIri, 'quads': [] },
          { 'runIri': secondRunIri, 'quads': [] },
          { 'runIri': 'urn:response-identity:extra', 'quads': [] },
        ]),
        [...requestItems, { 'id': 'extra', 'runIri': 'urn:response-identity:extra' }],
        requestItems,
      ),
      /response identities do not exactly match request identities/u,
    );
    assert.throws(
      () => GraphStateTransferCodec.validateIdentity(transfer, [
        { 'id': 'first', 'runIri': secondRunIri },
        { 'id': 'second', 'runIri': firstRunIri },
      ], requestItems),
      /response identities do not exactly match request identities/u,
    );
    assert.throws(
      () => GraphStateTransferCodec.validateIdentity(transfer, [
        { 'id': 'duplicate', 'runIri': firstRunIri },
        { 'id': 'duplicate', 'runIri': secondRunIri },
      ], requestItems),
      /duplicate item id/u,
    );
    assert.throws(
      () => GraphStateTransferCodec.validateIdentity(transfer, [
        { 'id': 'first', 'runIri': firstRunIri },
        { 'id': 'second', 'runIri': firstRunIri },
      ], requestItems),
      /duplicate item run IRI/u,
    );
  });

  void it('rejects undeclared graphs in full and delta payloads before partition restore', async () => {
    const runIri = 'urn:payload-identity:run';
    const undeclaredQuad = {
      'subject': DagGraphTerms.namedNode('urn:payload-identity:subject'),
      'predicate': DagGraphTerms.namedNode('urn:payload-identity:predicate'),
      'object': DagGraphTerms.literal('undeclared'),
      'graph': DagGraphTerms.namedNode('urn:payload-identity:extra#state'),
    };
    const items = [{ 'id': 'item', runIri }];
    const fullTransfer = GraphStateTransferCodec.inlineSync([{ runIri, 'quads': [undeclaredQuad] }]);
    const deltaTransfer = GraphStateTransferCodec.delta([
      { runIri, 'additions': [], 'deletions': [undeclaredQuad] },
    ], 'urn:payload-identity:base');

    await assert.rejects(
      () => GraphStateTransferCodec.restore(fullTransfer, items, null),
      /payload contains undeclared graph/u,
    );
    await assert.rejects(
      () => GraphStateTransferCodec.restore(deltaTransfer, items, null),
      /payload contains undeclared graph/u,
    );
  });

  void it('treats repeated semantic assertions as exact-set-idempotent', () => {
    const dataset = new InMemoryGraphDataset();
    const quad = {
      "subject": DagGraphTerms.namedNode('urn:memory:subject'),
      "predicate": DagGraphTerms.namedNode('urn:memory:related'),
      "object": DagGraphTerms.namedNode('urn:memory:object'),
      "graph": DagGraphTerms.namedNode('urn:memory:graph'),
    };

    dataset.add([quad, quad]);
    dataset.add([quad]);

    assert.equal(dataset.count({ "graph": quad.graph }), 1);
  });

  void it('protects checkpoint graphs during dry-run and applied retention', () => {
    const dataset = new InMemoryGraphDataset();
    const retained = DagGraphTerms.namedNode('urn:run:retained#state');
    const pruned = DagGraphTerms.namedNode('urn:run:pruned#state');
    const quad = (graph: ReturnType<typeof DagGraphTerms.namedNode>) => ({
      "subject": DagGraphTerms.namedNode('urn:run'),
      "predicate": DagGraphTerms.namedNode('urn:key'),
      "object": DagGraphTerms.literal('value'),
      graph,
    });
    dataset.add([quad(retained), quad(pruned)]);
    const manager = new GraphRetentionManager(dataset);

    const dryRun = manager.apply({ "graphIris": [retained.value, pruned.value], "protectedGraphIris": [retained.value], "dryRun": true });
    assert.equal(dryRun.removedQuadCount, 1);
    assert.equal(dataset.count({ "graph": pruned }), 1);
    manager.apply({ "graphIris": [retained.value, pruned.value], "protectedGraphIris": [retained.value] });
    assert.equal(dataset.count({ "graph": retained }), 1);
    assert.equal(dataset.count({ "graph": pruned }), 0);
  });

  void it('retains durable semantic graphs while pruning closed run graphs', () => {
    const dataset = new InMemoryGraphDataset();
    const durableGraph = DagGraphTerms.namedNode('urn:memory:durable');
    const runGraph = DagGraphTerms.namedNode('urn:run:closed#state');
    const quad = (graph: ReturnType<typeof DagGraphTerms.namedNode>) => ({
      "subject": DagGraphTerms.namedNode('urn:resource'),
      "predicate": DagGraphTerms.namedNode('urn:related'),
      "object": DagGraphTerms.namedNode('urn:other'),
      graph,
    });
    dataset.add([quad(durableGraph), quad(runGraph)]);

    const report = new GraphRetentionManager(dataset).apply({
      "graphIris": [durableGraph.value, runGraph.value],
      "protectedGraphIris": [],
      "durableGraphIris": [durableGraph.value],
    });

    assert.deepEqual(report.prunableGraphIris, [runGraph.value]);
    assert.deepEqual(report.retainedGraphIris, [durableGraph.value]);
    assert.equal(dataset.count({ "graph": durableGraph }), 1);
    assert.equal(dataset.count({ "graph": runGraph }), 0);
  });

  void it('applies configurable age and closure policy to catalogued old state', () => {
    const dataset = new InMemoryGraphDataset();
    const oldGraph = DagGraphTerms.namedNode('urn:run:old#state');
    const recentGraph = DagGraphTerms.namedNode('urn:run:recent#state');
    const openGraph = DagGraphTerms.namedNode('urn:run:open#state');
    const catalog = (graph: ReturnType<typeof DagGraphTerms.namedNode>, closedAt?: string) => [
      { "subject": graph, "predicate": DagGraphTerms.namedNode(DagGraphTerms.RDF_TYPE), "object": DagGraphTerms.namedNode(GraphStateTerms.DAGONIZER.RunDetail), "graph": graph },
      ...(closedAt === undefined ? [] : [
        { "subject": graph, "predicate": DagGraphTerms.namedNode(GraphStateTerms.DAGONIZER.GraphStatus), "object": DagGraphTerms.namedNode(GraphStateTerms.DAGONIZER.Closed), "graph": graph },
        { "subject": graph, "predicate": DagGraphTerms.namedNode(GraphStateTerms.DAGONIZER.ClosedAt), "object": DagGraphTerms.literal(closedAt, GraphStateTerms.XSD.dateTime), "graph": graph },
      ]),
      { "subject": graph, "predicate": DagGraphTerms.namedNode(GraphStateTerms.DAGONIZER.RetentionClass), "object": DagGraphTerms.namedNode(GraphStateTerms.DAGONIZER.Transient), "graph": graph },
      { "subject": graph, "predicate": DagGraphTerms.namedNode('urn:content'), "object": DagGraphTerms.literal('state'), "graph": graph },
    ];
    dataset.add([
      ...catalog(oldGraph, '2026-07-01T00:00:00.000Z'),
      ...catalog(recentGraph, '2026-07-14T18:00:00.000Z'),
      ...catalog(openGraph),
    ]);

    const report = new GraphRetentionManager(dataset).evaluate({
      "graphIris": [oldGraph.value, recentGraph.value, openGraph.value],
      "protectedGraphIris": [],
      "now": '2026-07-15T00:00:00.000Z',
      "retentionPolicy": { "defaultRetentionMs": 86_400_000, "requireClosed": true },
    });
    assert.deepEqual(report.prunableGraphIris, [oldGraph.value]);
    assert.deepEqual(report.retainedGraphIris, [recentGraph.value, openGraph.value]);
  });

  void it('uses the graph catalog when retention scope and roots are omitted', () => {
    const dataset = new InMemoryGraphDataset();
    const oldGraph = DagGraphTerms.namedNode('urn:run:catalog-old#state');
    const durableGraph = DagGraphTerms.namedNode('urn:run:catalog-durable#state');
    const catalog = (graph: ReturnType<typeof DagGraphTerms.namedNode>, retentionClass: string) => [
      { "subject": graph, "predicate": DagGraphTerms.namedNode(DagGraphTerms.RDF_TYPE), "object": DagGraphTerms.namedNode(GraphStateTerms.DAGONIZER.RunDetail), "graph": graph },
      { "subject": graph, "predicate": DagGraphTerms.namedNode(GraphStateTerms.DAGONIZER.GraphStatus), "object": DagGraphTerms.namedNode(GraphStateTerms.DAGONIZER.Closed), "graph": graph },
      { "subject": graph, "predicate": DagGraphTerms.namedNode(GraphStateTerms.DAGONIZER.ClosedAt), "object": DagGraphTerms.literal('2026-07-01T00:00:00.000Z', GraphStateTerms.XSD.dateTime), "graph": graph },
      { "subject": graph, "predicate": DagGraphTerms.namedNode(GraphStateTerms.DAGONIZER.RetentionClass), "object": DagGraphTerms.namedNode(retentionClass), "graph": graph },
      { "subject": graph, "predicate": DagGraphTerms.namedNode('urn:content'), "object": DagGraphTerms.literal('state'), "graph": graph },
    ];
    dataset.add([...catalog(oldGraph, GraphStateTerms.DAGONIZER.Transient), ...catalog(durableGraph, GraphStateTerms.DAGONIZER.Durable)]);

    const report = new GraphRetentionManager(dataset).evaluate({
      "now": '2026-07-15T00:00:00.000Z',
      "retentionPolicy": { "defaultRetentionMs": 86_400_000, "requireClosed": true },
    });
    assert.deepEqual(report.consideredGraphIris, [oldGraph.value, durableGraph.value]);
    assert.deepEqual(report.prunableGraphIris, [oldGraph.value]);
    assert.deepEqual(report.retainedGraphIris, [durableGraph.value]);
  });

  void it('protects live-checkpoint and externally referenced graphs', () => {
    const dataset = new InMemoryGraphDataset();
    const live = DagGraphTerms.namedNode('urn:run:live#state');
    const referenced = DagGraphTerms.namedNode('urn:run:referenced#state');
    const transient = DagGraphTerms.namedNode('urn:run:transient#state');
    const quad = (graph: ReturnType<typeof DagGraphTerms.namedNode>) => ({
      "subject": DagGraphTerms.namedNode('urn:retention:subject'),
      "predicate": DagGraphTerms.namedNode('urn:retention:predicate'),
      "object": DagGraphTerms.literal('value'),
      graph,
    });
    dataset.add([quad(live), quad(referenced), quad(transient)]);

    const report = new GraphRetentionManager(dataset).apply({
      "graphIris": [live.value, referenced.value, transient.value],
      "protectedGraphIris": [],
      "liveCheckpointGraphIris": [live.value],
      "referencedGraphIris": [referenced.value],
    });

    assert.deepEqual(report.retainedGraphIris, [live.value, referenced.value]);
    assert.equal(dataset.count({ "graph": live }), 1);
    assert.equal(dataset.count({ "graph": referenced }), 1);
    assert.equal(dataset.count({ "graph": transient }), 0);
  });

  void it('discovers graph retention dependencies from semantic protection facts', () => {
    const dataset = new InMemoryGraphDataset();
    const checkpoint = DagGraphTerms.namedNode('urn:checkpoint:1');
    const protectedGraph = DagGraphTerms.namedNode('urn:run:protected#state');
    const transientGraph = DagGraphTerms.namedNode('urn:run:transient#state');
    const metadataGraph = DagGraphTerms.namedNode('urn:metadata');
    dataset.add([
      { "subject": checkpoint, "predicate": DagGraphTerms.namedNode(GraphStateTerms.DAGONIZER.ProtectsGraph), "object": protectedGraph, "graph": metadataGraph },
      { "subject": DagGraphTerms.namedNode('urn:memory'), "predicate": DagGraphTerms.namedNode(GraphStateTerms.DAGONIZER.RetentionClass), "object": DagGraphTerms.namedNode(GraphStateTerms.DAGONIZER.Durable), "graph": metadataGraph },
      { "subject": DagGraphTerms.namedNode('urn:s'), "predicate": DagGraphTerms.namedNode('urn:p'), "object": DagGraphTerms.literal('x'), "graph": protectedGraph },
      { "subject": DagGraphTerms.namedNode('urn:s'), "predicate": DagGraphTerms.namedNode('urn:p'), "object": DagGraphTerms.literal('x'), "graph": transientGraph },
    ]);

    const report = new GraphRetentionManager(dataset).apply({ "graphIris": [], "protectedGraphIris": [], "dryRun": true });
    assert.ok(report.retainedGraphIris.includes(protectedGraph.value));
    assert.ok(report.prunableGraphIris.includes(transientGraph.value));
  });

  void it('retains the transitive closure of semantic graph references', () => {
    const dataset = new InMemoryGraphDataset();
    const metadataGraph = DagGraphTerms.namedNode('urn:metadata:closure');
    const checkpoint = DagGraphTerms.namedNode('urn:checkpoint:closure');
    const first = DagGraphTerms.namedNode('urn:graph:first');
    const second = DagGraphTerms.namedNode('urn:graph:second');
    const transient = DagGraphTerms.namedNode('urn:graph:transient');
    dataset.add([
      { "subject": checkpoint, "predicate": DagGraphTerms.namedNode(GraphStateTerms.DAGONIZER.ProtectsGraph), "object": first, "graph": metadataGraph },
      { "subject": first, "predicate": DagGraphTerms.namedNode(GraphStateTerms.DAGONIZER.ReferencesGraph), "object": second, "graph": metadataGraph },
      { "subject": DagGraphTerms.namedNode('urn:first:s'), "predicate": DagGraphTerms.namedNode('urn:p'), "object": DagGraphTerms.literal('1'), "graph": first },
      { "subject": DagGraphTerms.namedNode('urn:second:s'), "predicate": DagGraphTerms.namedNode('urn:p'), "object": DagGraphTerms.literal('2'), "graph": second },
      { "subject": DagGraphTerms.namedNode('urn:transient:s'), "predicate": DagGraphTerms.namedNode('urn:p'), "object": DagGraphTerms.literal('3'), "graph": transient },
    ]);
    const report = new GraphRetentionManager(dataset).evaluate({ "graphIris": [], "protectedGraphIris": [], "dryRun": true });
    assert.ok(report.retainedGraphIris.includes(first.value));
    assert.ok(report.retainedGraphIris.includes(second.value));
    assert.ok(report.prunableGraphIris.includes(transient.value));
  });

  void it('closes a run by writing an additive summary before pruning transient facts', () => {
    const dataset = new InMemoryGraphDataset();
    const runIri = 'urn:run:closeout';
    const sourceGraph = DagGraphTerms.namedNode(`${runIri}#state`);
    dataset.add([{
      "subject": DagGraphTerms.namedNode(runIri),
      "predicate": DagGraphTerms.namedNode('urn:step'),
      "object": DagGraphTerms.literal('completed'),
      "graph": sourceGraph,
    }]);

    const manager = new GraphRetentionManager(dataset);
    const report = manager.compactRun(runIri, '2026-07-14T00:00:00.000Z');
    const summaryGraph = DagGraphTerms.namedNode(`${runIri}#state/summary`);

    assert.equal(report.removedQuadCount, 1);
    assert.equal(dataset.count({ "graph": sourceGraph }), 0);
    assert.equal(dataset.count({ "graph": summaryGraph }), 7);
    assert.equal(dataset.count({ "graph": summaryGraph, "predicate": DagGraphTerms.namedNode(GraphStateTerms.DAGONIZER.GraphStatus) }), 1);
  });

  void it('implements the shared port with N3 and preserves triple terms', () => {
    const dataset = new N3GraphDataset();
    const graph = DagGraphTerms.namedNode('urn:n3:graph');
    const triple = DagGraphTerms.tripleTerm(
      DagGraphTerms.namedNode('urn:n3:subject'),
      DagGraphTerms.namedNode('urn:n3:predicate'),
      DagGraphTerms.literal('value'),
    );
    const quad = {
      "subject": DagGraphTerms.namedNode('urn:n3:annotation'),
      "predicate": DagGraphTerms.namedNode('urn:n3:reifies'),
      "object": triple,
      graph,
    };

    dataset.add([quad]);

    assert.equal(dataset.count({ "graph": graph }), 1);
    assert.deepEqual([...dataset.match({ "graph": graph })], [quad]);
    assert.deepEqual(dataset.select({ "subject": '?subject' }), [{ "subject": quad.subject }]);
    assert.match(dataset.revision(), /^graph-rev-[0-9a-f]{64}$/u);
  });

  void it('keeps ground graph revisions stable across insertion order', () => {
    const graph = DagGraphTerms.namedNode('urn:revision:graph');
    const quads = [
      { "subject": DagGraphTerms.namedNode('urn:revision:b'), "predicate": DagGraphTerms.namedNode('urn:revision:p'), "object": DagGraphTerms.literal('two'), graph },
      { "subject": DagGraphTerms.namedNode('urn:revision:a'), "predicate": DagGraphTerms.namedNode('urn:revision:p'), "object": DagGraphTerms.literal('one'), graph },
    ];
    const first = new N3GraphDataset();
    const second = new N3GraphDataset();
    first.add(quads);
    second.add([...quads].reverse());

    assert.equal(first.revision(), second.revision());
    const cached = first.revision();
    first.add([]);
    assert.equal(first.revision(), cached);
  });

  void it('rolls back N3 graph transactions when a write fails', () => {
    const dataset = new N3GraphDataset();
    const graph = DagGraphTerms.namedNode('urn:transaction:graph');
    assert.throws(() => dataset.transact((transaction) => {
      transaction.assert(
        DagGraphTerms.namedNode('urn:transaction:subject'),
        DagGraphTerms.namedNode('urn:transaction:predicate'),
        DagGraphTerms.literal('partial'),
        graph,
      );
      throw new Error('transaction failed');
    }), /transaction failed/u);
    assert.equal(dataset.count({ "graph": graph }), 0);
  });

  void it('rejects a durable graph transaction against a stale revision', () => {
    const dataset = new InMemoryGraphDataset();
    const revision = dataset.revision();
    dataset.add([{
      "subject": DagGraphTerms.namedNode('urn:cas:s'),
      "predicate": DagGraphTerms.namedNode('urn:cas:p'),
      "object": DagGraphTerms.literal('changed'),
      "graph": DagGraphTerms.namedNode('urn:cas:g'),
    }]);
    assert.throws(() => dataset.transactAtRevision(revision, (transaction) => transaction.add([])), /revision mismatch/);
  });

  void it('imports a by-reference snapshot through the transfer store', async () => {
    const source = [{
      "subject": DagGraphTerms.namedNode('urn:ref:subject'),
      "predicate": DagGraphTerms.namedNode('urn:ref:predicate'),
      "object": DagGraphTerms.literal('snapshot'),
      "graph": DagGraphTerms.namedNode('urn:ref:run#state'),
    }];
    const store = new InMemoryGraphStateTransferStore('urn:transfer:local');
    const transfer = await GraphStateTransferCodec.reference(store, [{ 'runIri': 'urn:ref:run', 'quads': toAsync(source) }], transferIdentity('urn:ref:run', 'urn:ref:run#state'));
    const destination = new InMemoryGraphDataset();

    const [part] = await GraphStateTransferCodec.restore(transfer, [{ 'id': 'urn:ref:run', 'runIri': 'urn:ref:run' }], store);
    assert.ok(part !== undefined);
    const quads: QuadType[] = [];
    for await (const quad of part.quads) quads.push(quad);
    destination.add(quads);

    assert.equal(destination.count({ "graph": DagGraphTerms.namedNode('urn:ref:run#state') }), 1);
  });

  void it('applies deltas against a referenced base snapshot without replacing relationships', async () => {
    const graph = DagGraphTerms.namedNode('urn:delta:run#state');
    const base = [{
      "subject": DagGraphTerms.namedNode('urn:delta:subject'),
      "predicate": DagGraphTerms.namedNode('urn:delta:related'),
      "object": DagGraphTerms.namedNode('urn:delta:old'),
      graph,
    }];
    const addition = {
      "subject": DagGraphTerms.namedNode('urn:delta:subject'),
      "predicate": DagGraphTerms.namedNode('urn:delta:related'),
      "object": DagGraphTerms.namedNode('urn:delta:new'),
      graph,
    };
    const store = new InMemoryGraphStateTransferStore('urn:transfer:delta');
    const snapshot = await GraphStateTransferCodec.reference(store, [{ 'runIri': 'urn:delta:run', 'quads': toAsync(base) }], transferIdentity('urn:delta:run', graph.value));
    const transfer = GraphStateTransferCodec.delta([{ 'runIri': 'urn:delta:run', 'additions': [addition], 'deletions': [] }], snapshot.graphSnapshotRef);
    const destination = new InMemoryGraphDataset();

    const [part] = await GraphStateTransferCodec.restore(transfer, [{ 'id': 'urn:delta:run', 'runIri': 'urn:delta:run' }], store);
    assert.ok(part !== undefined);
    const quads: QuadType[] = [];
    for await (const quad of part.quads) quads.push(quad);
    destination.add(quads);

    assert.equal(destination.count({ "graph": graph }), 1);
    assert.equal(destination.count({ "object": addition.object, "graph": graph }), 1);
  });

  void it('applies a delta-reference envelope against its stored base snapshot', async () => {
    const graph = DagGraphTerms.namedNode('urn:delta-ref:run#state');
    const base = [{
      "subject": DagGraphTerms.namedNode('urn:delta-ref:subject'),
      "predicate": DagGraphTerms.namedNode('urn:delta-ref:related'),
      "object": DagGraphTerms.namedNode('urn:delta-ref:old'),
      graph,
    }];
    const addition = {
      "subject": DagGraphTerms.namedNode('urn:delta-ref:subject'),
      "predicate": DagGraphTerms.namedNode('urn:delta-ref:related'),
      "object": DagGraphTerms.namedNode('urn:delta-ref:new'),
      graph,
    };
    const store = new InMemoryGraphStateTransferStore('urn:transfer:delta-ref');
    const snapshot = await GraphStateTransferCodec.reference(store, [{ 'runIri': 'urn:delta-ref:run', 'quads': toAsync(base) }], transferIdentity('urn:delta-ref:run', graph.value));
    const transfer = GraphStateTransferCodec.delta([{ 'runIri': 'urn:delta-ref:run', 'additions': [addition], 'deletions': [] }], snapshot.graphSnapshotRef, { 'reference': true });
    const destination = new InMemoryGraphDataset();

    const [part] = await GraphStateTransferCodec.restore(transfer, [{ 'id': 'urn:delta-ref:run', 'runIri': 'urn:delta-ref:run' }], store);
    assert.ok(part !== undefined);
    const quads: QuadType[] = [];
    for await (const quad of part.quads) quads.push(quad);
    destination.add(quads);

    assert.equal(destination.count({ "graph": graph }), 1);
    assert.equal(destination.count({ "object": addition.object, "graph": graph }), 1);
  });

  void it('requires an active scoped lease for shared graph reads', async () => {
    const runIri = 'urn:shared:run';
    const graph = DagGraphTerms.namedNode(GraphStateTerms.runGraphIri(runIri));
    const sourceQuad = {
      "subject": DagGraphTerms.namedNode('urn:shared:subject'),
      "predicate": DagGraphTerms.namedNode('urn:shared:predicate'),
      "object": DagGraphTerms.literal('shared'),
      graph,
    };
    const store = new InMemoryGraphStateTransferStore('urn:transfer:shared');
    const transfer = await GraphStateTransferCodec.shared(store, [{ runIri, 'quads': toAsync([sourceQuad]) }], 10_000);
    const destination = new InMemoryGraphDataset();
    const items = [{ 'id': runIri, runIri }];

    const [part] = await GraphStateTransferCodec.restore(transfer, items, store);
    assert.ok(part !== undefined);
    const quads: QuadType[] = [];
    for await (const quad of part.quads) quads.push(quad);
    destination.add(quads);
    assert.equal(destination.count({ "graph": graph }), 1);
    await store.releaseLease({ "endpoint": transfer.endpoint, "token": transfer.lease, "graphIris": transfer.graphIris, "expiresAt": Number.POSITIVE_INFINITY });
    await assert.rejects(() => GraphStateTransferCodec.restore(transfer, items, store), /expired or unknown/);
  });

  void it('discards an incomplete snapshot artifact during cancellation cleanup', async () => {
    const store = new InMemoryGraphStateTransferStore('urn:transfer:cleanup');
    const transfer = await GraphStateTransferCodec.reference(store, [{ 'runIri': 'urn:cleanup:run', 'quads': toAsync([]) }], transferIdentity('urn:cleanup:run', 'urn:cleanup:run#state'));

    await GraphStateTransferCodec.discard(store, transfer.graphSnapshotRef);

    await assert.rejects(
      () => GraphStateTransferCodec.restore(transfer, [{ 'id': 'urn:cleanup:run', 'runIri': 'urn:cleanup:run' }], store),
      /Unknown graph snapshot reference/,
    );
  });
});
