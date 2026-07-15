import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { describe, it } from 'node:test';

import { FileGraphDataset } from '../../src/adapter/FileGraphDataset.js';
import { N3GraphDataset } from '../../src/adapter/N3GraphDataset.js';
import { DagGraphTerms } from '../../src/graph/DagGraphTerms.js';
import { GraphStateTerms } from '../../src/graph/GraphStateTerms.js';
import { GraphRetentionManager, GraphStateJsonLdCodec, GraphStateTransferCodec, InMemoryGraphDataset, InMemoryGraphStateTransferStore } from '../../src/index.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';

void describe('GraphStateTransferCodec', () => {
  const transferIdentity = (runIri: string, graphIri: string) => ({
    'dagIri': `${runIri}#dag`,
    'placementPath': [`${graphIri}/placement`],
    'placementIri': `${graphIri}/placement`,
    'stateGraphIri': graphIri,
    'jsonLd': { '@context': GraphStateTerms.JSON_LD_CONTEXT, '@graph': [] },
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

  void it('restores a Node.js boundary transfer from JSON-LD before N-Quads', async () => {
    const runIri = 'urn:state:jsonld-transfer';
    const graphIri = `${runIri}#state`;
    const source = [{
      "subject": DagGraphTerms.namedNode(runIri),
      "predicate": DagGraphTerms.namedNode('urn:state:jsonld:value'),
      "object": DagGraphTerms.literal('from-jsonld'),
      "graph": DagGraphTerms.namedNode(graphIri),
    }];
    const transfer = {
      ...GraphStateTransferCodec.inline(runIri, [graphIri], source, transferIdentity(runIri, graphIri)),
      "jsonLd": GraphStateJsonLdCodec.encode(source),
    };
    const state = new NodeStateBase(new InMemoryGraphDataset(), runIri);
    await GraphStateTransferCodec.restore(state, transfer);
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

  void it('applies an inline transfer through the shared graph dataset port', () => {
    const source = [{
      "subject": DagGraphTerms.namedNode('urn:run'),
      "predicate": DagGraphTerms.namedNode('urn:key'),
      "object": DagGraphTerms.literal('value'),
      "graph": DagGraphTerms.namedNode('urn:run#state'),
    }];
    const transfer = GraphStateTransferCodec.inline('urn:run', ['urn:run#state'], source, transferIdentity('urn:run', 'urn:run#state'));
    const dataset = new InMemoryGraphDataset();
    GraphStateTransferCodec.apply(dataset, transfer);

    if (transfer.mode === 'inline-nquads') {
      assert.equal(transfer.dagIri, 'urn:run#dag');
      assert.equal(transfer.stateGraphIri, 'urn:run#state');
      assert.equal(transfer.quadCount, 1);
      assert.ok(transfer.byteSize > 0);
      assert.match(transfer.createdAt, /^\d{4}-\d{2}-\d{2}T/);
    }
    assert.deepEqual([...dataset.match({ "graph": DagGraphTerms.namedNode('urn:run#state') })], source);
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

  void it('reopens the durable file adapter from canonical N-Quads', () => {
    const directory = mkdtempSync(`${tmpdir()}/dagonizer-graph-`);
    const path = `${directory}/state.nq`;
    try {
      const source = new FileGraphDataset(path);
      const graph = DagGraphTerms.namedNode('urn:file:graph');
      source.add([{
        "subject": DagGraphTerms.namedNode('urn:file:subject'),
        "predicate": DagGraphTerms.namedNode('urn:file:predicate'),
        "object": DagGraphTerms.literal('durable'),
        graph,
      }]);

      const reopened = new FileGraphDataset(path);
      assert.equal(reopened.count({ "graph": graph }), 1);
      assert.equal([...reopened.match({ "graph": graph })][0]?.object.value, 'durable');
      assert.equal(reopened.count({ "graph": DagGraphTerms.namedNode(GraphStateTerms.revisionGraphIri()) }), 4);
      assert.match(reopened.revision(), /^graph-rev-[0-9a-f]{64}$/);
    } finally {
      rmSync(directory, { "recursive": true, "force": true });
    }
  });

  void it('keeps durable revisions stable across blank-node reopen and write', () => {
    const directory = mkdtempSync(`${tmpdir()}/dagonizer-graph-`);
    const path = `${directory}/blank-state.nq`;
    try {
      const source = new FileGraphDataset(path);
      const graph = DagGraphTerms.namedNode('urn:file:blank:graph');
      source.add([{
        "subject": { "termType": 'BlankNode', "value": 'source' },
        "predicate": DagGraphTerms.namedNode('urn:file:blank:predicate'),
        "object": DagGraphTerms.literal('durable'),
        graph,
      }]);

      const reopened = new FileGraphDataset(path);
      reopened.assert(
        DagGraphTerms.namedNode('urn:file:blank:subject'),
        DagGraphTerms.namedNode('urn:file:blank:predicate'),
        DagGraphTerms.literal('after-reopen'),
        graph,
      );
      assert.equal(reopened.count({ "graph": graph }), 2);
    } finally {
      rmSync(directory, { "recursive": true, "force": true });
    }
  });

  void it('persists durable RDF 1.2 triple terms and recomputes their revision', () => {
    const directory = mkdtempSync(`${tmpdir()}/dagonizer-graph-`);
    const path = `${directory}/triple-term-state.nq`;
    try {
      const source = new FileGraphDataset(path);
      const graph = DagGraphTerms.namedNode('urn:file:triple-term:graph');
      const triple = DagGraphTerms.tripleTerm(
        DagGraphTerms.namedNode('urn:file:triple-term:subject'),
        DagGraphTerms.namedNode('urn:file:triple-term:predicate'),
        { "termType": 'BlankNode', "value": 'inner' },
      );
      source.assert(
        DagGraphTerms.namedNode('urn:file:triple-term:annotation'),
        DagGraphTerms.namedNode('urn:file:triple-term:reifies'),
        triple,
        graph,
      );

      const reopened = new FileGraphDataset(path);
      assert.equal(reopened.count({ "graph": graph }), 1);
      assert.match(reopened.revision(), /^graph-rev-[0-9a-f]{64}$/u);
    } finally {
      rmSync(directory, { "recursive": true, "force": true });
    }
  });

  void it('journals direct durable writes without rewriting the snapshot', () => {
    const directory = mkdtempSync(`${tmpdir()}/dagonizer-graph-`);
    const path = `${directory}/journaled-state.nq`;
    try {
      const dataset = new FileGraphDataset(path);
      const graph = DagGraphTerms.namedNode('urn:file:journal:graph');
      dataset.assert(
        DagGraphTerms.namedNode('urn:file:journal:subject:0'),
        DagGraphTerms.namedNode('urn:file:journal:predicate'),
        DagGraphTerms.literal('0'),
        graph,
      );
      dataset.flush();
      const snapshot = readFileSync(path, 'utf8');
      for (let index = 1; index < 4; index += 1) {
        dataset.assert(
          DagGraphTerms.namedNode(`urn:file:journal:subject:${index}`),
          DagGraphTerms.namedNode('urn:file:journal:predicate'),
          DagGraphTerms.literal(String(index)),
          graph,
        );
      }
      assert.equal(readFileSync(path, 'utf8'), snapshot);
      assert.equal(existsSync(`${path}.journal`), true);
      dataset.flush();
      assert.equal(existsSync(path), true);
      assert.equal(existsSync(`${path}.journal`), false);
    } finally {
      rmSync(directory, { "recursive": true, "force": true });
    }
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

  void it('rolls back durable graph transactions before the commit boundary', () => {
    const directory = mkdtempSync(`${tmpdir()}/dagonizer-graph-`);
    const path = `${directory}/transaction.nq`;
    try {
      const dataset = new FileGraphDataset(path);
      const graph = DagGraphTerms.namedNode('urn:file:transaction:graph');
      assert.throws(() => dataset.transact((transaction) => {
        transaction.assert(
          DagGraphTerms.namedNode('urn:file:transaction:subject'),
          DagGraphTerms.namedNode('urn:file:transaction:predicate'),
          DagGraphTerms.literal('partial'),
          graph,
        );
        throw new Error('durable transaction failed');
      }), /durable transaction failed/u);
      assert.equal(dataset.count({ "graph": graph }), 0);
      assert.equal(new FileGraphDataset(path).count({ "graph": graph }), 0);
    } finally {
      rmSync(directory, { "recursive": true, "force": true });
    }
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
    const transfer = await GraphStateTransferCodec.reference(store, 'urn:ref:run', ['urn:ref:run#state'], source, transferIdentity('urn:ref:run', 'urn:ref:run#state'));
    const destination = new InMemoryGraphDataset();

    await GraphStateTransferCodec.applyExternal(destination, transfer, store);

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
    const snapshot = await GraphStateTransferCodec.reference(store, 'urn:delta:run', [graph.value], base, transferIdentity('urn:delta:run', graph.value));
    const transfer = GraphStateTransferCodec.delta('urn:delta:run', snapshot.graphSnapshotRef, [addition], base, transferIdentity('urn:delta:run', graph.value));
    const destination = new InMemoryGraphDataset();

    await GraphStateTransferCodec.applyExternal(destination, transfer, store);

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
    const snapshot = await GraphStateTransferCodec.reference(store, 'urn:delta-ref:run', [graph.value], base, transferIdentity('urn:delta-ref:run', graph.value));
    const transfer = GraphStateTransferCodec.deltaReference('urn:delta-ref:run', snapshot.graphSnapshotRef, [addition], base, transferIdentity('urn:delta-ref:run', graph.value));
    const destination = new InMemoryGraphDataset();

    await GraphStateTransferCodec.applyExternal(destination, transfer, store);

    assert.equal(destination.count({ "graph": graph }), 1);
    assert.equal(destination.count({ "object": addition.object, "graph": graph }), 1);
  });

  void it('requires an active scoped lease for shared graph reads', async () => {
    const source = new InMemoryGraphDataset();
    const graph = DagGraphTerms.namedNode('urn:shared:graph');
    source.add([{
      "subject": DagGraphTerms.namedNode('urn:shared:subject'),
      "predicate": DagGraphTerms.namedNode('urn:shared:predicate'),
      "object": DagGraphTerms.literal('shared'),
      graph,
    }]);
    const store = new InMemoryGraphStateTransferStore('urn:transfer:shared', async function* (graphIris) {
      for (const graphIri of graphIris) yield* source.exportGraph(DagGraphTerms.namedNode(graphIri));
    });
    const transfer = await GraphStateTransferCodec.shared(store, 'urn:shared:run', [graph.value], 10_000, transferIdentity('urn:shared:run', graph.value));
    const destination = new InMemoryGraphDataset();

    await GraphStateTransferCodec.applyExternal(destination, transfer, store);
    assert.equal(destination.count({ "graph": graph }), 1);
    await store.releaseLease({ "endpoint": transfer.endpoint, "token": transfer.lease, "graphIris": transfer.graphIris, "expiresAt": Number.POSITIVE_INFINITY });
    await assert.rejects(() => GraphStateTransferCodec.applyExternal(new InMemoryGraphDataset(), transfer, store), /expired or unknown/);
  });

  void it('discards an incomplete snapshot artifact during cancellation cleanup', async () => {
    const store = new InMemoryGraphStateTransferStore('urn:transfer:cleanup');
    const transfer = await GraphStateTransferCodec.reference(store, 'urn:cleanup:run', ['urn:cleanup:run#state'], [], transferIdentity('urn:cleanup:run', 'urn:cleanup:run#state'));

    await GraphStateTransferCodec.discard(store, transfer.graphSnapshotRef);

    await assert.rejects(() => GraphStateTransferCodec.applyExternal(new InMemoryGraphDataset(), transfer, store), /Unknown graph snapshot reference/);
  });
});
