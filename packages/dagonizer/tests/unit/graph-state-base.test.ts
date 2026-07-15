import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { N3GraphDataset } from '../../src/adapter/N3GraphDataset.js';
import { DagGraphTerms } from '../../src/graph/DagGraphTerms.js';
import { GraphStateQueryService } from '../../src/graph/GraphStateQueryService.js';
import { GraphStateTerms } from '../../src/graph/GraphStateTerms.js';
import { InMemoryGraphDataset } from '../../src/graph/InMemoryGraphDataset.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';

class GraphState extends NodeStateBase {
  value = 0;


}

class DefinedGraphState extends NodeStateBase {
  progress = { 'watermark': 2, 'active': true };


  protected override graphStateFields() {
    return [{
      'key': 'progress',
      'predicate': 'urn:state:progress',
      'kind': 'object' as const,
      'cardinality': 'one' as const,
      'read': 'direct' as const,
      'write': 'replace' as const,
      'nested': {
        'watermark': { 'predicate': 'urn:state:watermark', 'datatype': GraphStateTerms.XSD.integer },
        'active': { 'predicate': 'urn:state:active', 'datatype': GraphStateTerms.XSD.boolean },
      },
    }];
  }
}

void describe('NodeStateBase graph persistence', () => {
  void it('projects schema-defined fields as direct typed graph facts', async () => {
    const dataset = new InMemoryGraphDataset();
    const state = new DefinedGraphState(dataset, 'urn:dagonizer:run:defined');
    await state.snapshotJsonLd();
    const graph = DagGraphTerms.namedNode(GraphStateTerms.runGraphIri(state.runIri));
    const run = DagGraphTerms.namedNode(state.runIri);
    const progress = [...dataset.match({ 'subject': run, 'predicate': DagGraphTerms.namedNode('urn:state:progress'), graph })][0]?.object;

    assert.equal(progress?.termType, 'NamedNode');
    if (progress?.termType === 'NamedNode') {
      assert.equal(dataset.count({ 'subject': progress, 'predicate': DagGraphTerms.namedNode('urn:state:watermark'), 'object': DagGraphTerms.literal('2', GraphStateTerms.XSD.integer), graph }), 1);
      assert.equal(dataset.count({ 'subject': progress, 'predicate': DagGraphTerms.namedNode('urn:state:active'), 'object': DagGraphTerms.literal('true', GraphStateTerms.XSD.boolean), graph }), 1);
      assert.equal(new GraphStateQueryService(dataset, state.runIri).bindingsFor('urn:state:watermark').length, 1);
    }
    assert.equal(dataset.count({ 'subject': run, 'predicate': DagGraphTerms.namedNode(GraphStateTerms.stateFieldIri('domain.progress')), graph }), 0);
  });

  void it('stores node communication facts through the shared RDF dataset', async () => {
    const state = new GraphState();
    state.setMetadata('prompt', 'hello');
    state.recordAttempt('step');
    state.collectWarning({
      'code': 'TEST_WARNING',
      'message': 'warning',
      'operation': 'test',
      'timestamp': new Date(0).toISOString(),
    });
    state.value = 42;

    assert.equal(state.getMetadata('prompt'), 'hello');
    assert.equal(state.retriesFor('step'), 1);
    assert.equal(state.warnings.length, 1);
    const document = await state.snapshotJsonLd();
    assert.equal(document['@graph'].length > 0, true);

    const graph = DagGraphTerms.namedNode(GraphStateTerms.runGraphIri(state.runIri));
    const valueCell = DagGraphTerms.namedNode(GraphStateTerms.stateCellIri(state.runIri, 'domain.value'));
    assert.equal(state.graphDataset.count({ "subject": valueCell, "predicate": DagGraphTerms.namedNode(GraphStateTerms.DAGONIZER.StateValuePredicate), "graph": graph }), 1);
    const valueObject = [...state.graphDataset.match({ "subject": valueCell, "predicate": DagGraphTerms.namedNode(GraphStateTerms.DAGONIZER.StateValuePredicate), "graph": graph })][0]?.object;
    assert.equal(valueObject?.termType, 'Literal');
    if (valueObject?.termType === 'Literal') assert.equal(valueObject.datatype?.value, GraphStateTerms.XSD.integer);
  });

  void it('preserves lifecycle and clone/restore behavior', async () => {
    const state = new GraphState();
    state.markRunning();
    state.setMetadata('answer', 7);
    state.value = 9;
    const clone = state.clone();

    assert.equal(clone.lifecycle.variant, 'pending');
    assert.equal(clone.getMetadata('answer'), 7);
    assert.equal(clone.value, 0);
    await clone.restoreJsonLd(state.runIri, await state.snapshotJsonLd());
    assert.equal(clone.value, 9);

    const restored = new GraphState();
    await restored.restoreJsonLd(state.runIri, await state.snapshotJsonLd());
    assert.equal(restored.getMetadata('answer'), 7);
    assert.equal(restored.value, 9);
    assert.equal(restored.lifecycle.variant, 'running');
  });

  void it('delegates clone dataset isolation to the injected graph adapter', () => {
    const state = new GraphState(new N3GraphDataset());
    const clone = state.clone();

    assert.ok(clone.graphDataset instanceof N3GraphDataset);
    assert.notEqual(clone.graphDataset, state.graphDataset);
  });

  void it('uses the shared dataset port for run identity and state facts', () => {
    const dataset = new InMemoryGraphDataset();
    const runIri = 'urn:dagonizer:run:test';
    const state = new NodeStateBase(dataset, runIri);
    state.bindRunIri(runIri);
    state.setMetadata('answer', 42);
    state.markRunning();
    state.recordAttempt('fan-out');

    const facts = [...dataset.match({ "graph": DagGraphTerms.namedNode(GraphStateTerms.runGraphIri(runIri)) })];
    assert.ok(facts.some((quad) => quad.object.value === GraphStateTerms.DAGONIZER.Run));
    assert.ok(facts.some((quad) => quad.object.value === GraphStateTerms.stateCellIri(runIri, 'metadata.answer')));
    assert.ok(facts.some((quad) => quad.predicate.value === GraphStateTerms.stateFieldIri('metadata.answer')));
    assert.ok(facts.some((quad) => quad.predicate.value.endsWith('lifecycle')));
    assert.ok(facts.some((quad) => quad.predicate.value === GraphStateTerms.DAGONIZER.LifecycleVariant && quad.object.value === GraphStateTerms.lifecycleVariantIri('running')));
    assert.equal(dataset.count({ "predicate": DagGraphTerms.namedNode(GraphStateTerms.DAGONIZER.AttemptCount), "object": DagGraphTerms.literal('1', GraphStateTerms.XSD.integer), "graph": DagGraphTerms.namedNode(GraphStateTerms.runGraphIri(runIri)) }), 1);
  });

  void it('reads nested domain values from RDF projection rather than JSON shadow data', async () => {
    const state = new GraphState();
    state.value = 7;
    state.setMetadata('progress', { 'watermark': 2, 'active': true });
    await state.snapshotJsonLd();

    const graph = DagGraphTerms.namedNode(GraphStateTerms.runGraphIri(state.runIri));
    assert.deepEqual(state.getMetadata('progress'), { 'watermark': 2, 'active': true });
    const progress = DagGraphTerms.namedNode(GraphStateTerms.stateCellIri(state.runIri, 'metadata.progress'));
    assert.equal(state.graphDataset.count({
      "subject": progress,
      "predicate": DagGraphTerms.namedNode(GraphStateTerms.nestedFieldIri('watermark')),
      "graph": graph,
    }), 1);
    assert.equal(state.value, 7);
  });

  void it('rejects identity changes after graph facts are written', () => {
    const dataset = new InMemoryGraphDataset();
    const state = new NodeStateBase(dataset, 'urn:dagonizer:run:unbound');
    state.setMetadata('progress', { 'watermark': 1 });
    assert.throws(() => state.bindRunIri('urn:dagonizer:run:bound'), /identity is immutable/);
    assert.deepEqual(state.getMetadata('progress'), { 'watermark': 1 });
  });

  void it('streams and restores the named graph through the snapshot seam', async () => {
    const source = new NodeStateBase(new InMemoryGraphDataset(), 'urn:dagonizer:run:source');
    source.setMetadata('value', 'persisted');
    source.markRunning();
    const snapshot = source.snapshotGraph();
    const target = new NodeStateBase(new InMemoryGraphDataset(), 'urn:dagonizer:run:target');
    await target.restoreGraph('urn:dagonizer:run:source', snapshot);

    assert.equal(target.runIri, 'urn:dagonizer:run:source');
    assert.equal(target.getMetadata('value'), 'persisted');
    assert.equal(target.lifecycle.variant, 'running');
  });

  void it('emits and consumes the same named graph through the JSON-LD node boundary', async () => {
    const source = new NodeStateBase(new InMemoryGraphDataset(), 'urn:dagonizer:run:jsonld');
    source.setMetadata('answer', 42);
    const document = await source.snapshotJsonLd(source.runIri);
    const restored = new NodeStateBase(new InMemoryGraphDataset(), source.runIri);
    await restored.restoreJsonLd(source.runIri, document);

    const sourceQuads = [];
    const restoredQuads = [];
    for await (const quad of source.snapshotGraph(source.runIri)) sourceQuads.push(quad);
    for await (const quad of restored.snapshotGraph(source.runIri)) restoredQuads.push(quad);
    assert.deepEqual(
      restoredQuads.map((quad) => JSON.stringify(quad)).sort(),
      sourceQuads.map((quad) => JSON.stringify(quad)).sort(),
    );
  });

  void it('closes the active run graph additively for retention', () => {
    const runIri = 'urn:dagonizer:run:closed';
    const dataset = new InMemoryGraphDataset();
    const state = new NodeStateBase(dataset, runIri);
    state.closeGraph('2026-07-14T00:00:00.000Z');

    const graph = DagGraphTerms.namedNode(GraphStateTerms.runGraphIri(runIri));
    assert.equal(dataset.count({ "graph": graph, "predicate": DagGraphTerms.namedNode(GraphStateTerms.DAGONIZER.GraphStatus) }), 1);
    assert.equal(dataset.count({ "graph": graph, "predicate": DagGraphTerms.namedNode(GraphStateTerms.DAGONIZER.ClosedAt) }), 1);
  });

  void it('computes additive and subtractive graph deltas against the prior revision', async () => {
    const state = new NodeStateBase(new InMemoryGraphDataset(), 'urn:dagonizer:run:delta');
    state.setMetadata('value', 'one');
    const first = await state.snapshotGraphDelta();
    assert.ok(first.additions.length > 0);
    assert.equal(first.deletions.length, 0);
    state.setMetadata('value', 'two');
    const second = await state.snapshotGraphDelta();
    assert.ok(second.additions.some((quad) => quad.object.termType === 'Literal' && quad.object.value === 'two'));
    assert.ok(second.deletions.some((quad) => quad.object.termType === 'Literal' && quad.object.value === 'one'));
  });
});
