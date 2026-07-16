import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { N3GraphDataset } from '../../src/adapter/N3GraphDataset.js';
import type { GraphDatasetInterface } from '../../src/contracts/GraphDatasetInterface.js';
import type { GraphDatasetProviderInterface, GraphScopeType } from '../../src/contracts/GraphDatasetProviderInterface.js';
import { Dagonizer } from '../../src/Dagonizer.js';
import { DagGraphTerms } from '../../src/graph/DagGraphTerms.js';
import { InMemoryGraphDatasetProvider } from '../../src/graph/InMemoryGraphDatasetProvider.js';
import { N3GraphDatasetProvider } from '../../src/graph/N3GraphDatasetProvider.js';
import { PersistentGraphDataset } from '../../src/graph/PersistentGraphDataset.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';
import { MemoryGraphJournal } from '../_support/MemoryGraphJournal.js';
import { TestDag } from '../_support/TestDag.js';

const scope = {
  'runIri': 'urn:dagonizer:run:provider',
  'dagIri': 'urn:dagonizer:dag:provider',
  'placementIri': 'urn:dagonizer:dag:provider/node/step',
};

class ReopeningProvider implements GraphDatasetProviderInterface {
  readonly #datasets = new Map<string, GraphDatasetInterface>();

  root(runIri: string): GraphDatasetInterface {
    const dataset = new N3GraphDataset();
    this.#datasets.set(runIri, dataset);
    return dataset;
  }

  child(_parent: GraphScopeType, _child: GraphScopeType): GraphDatasetInterface {
    return new N3GraphDataset();
  }

  reopen(runIri: string): Promise<GraphDatasetInterface | undefined> {
    return Promise.resolve(this.#datasets.get(runIri));
  }
}

void describe('GraphDatasetProviderInterface implementations', () => {
  void it('mints isolated in-memory root and child datasets', async () => {
    const provider = new InMemoryGraphDatasetProvider();
    const root = provider.root(scope.runIri);
    const child = provider.child(scope, { ...scope, 'placementIri': `${scope.placementIri}/child` });

    assert.notEqual(root, child);
    assert.equal(root.count({}), 0);
    assert.equal(child.count({}), 0);
    assert.equal(await provider.reopen(scope.runIri), undefined);
  });

  void it('mints isolated N3 datasets and binds them to cloned state', async () => {
    const provider = new N3GraphDatasetProvider();
    const state = new NodeStateBase(provider.root(scope.runIri), scope.runIri, provider);
    state.setMetadata('source', 'parent');
    state.graphDataset.assert(
      DagGraphTerms.namedNode('urn:dagonizer:parent'),
      DagGraphTerms.namedNode('urn:dagonizer:predicate'),
      DagGraphTerms.literal('value'),
    );
    const clone = state.clone({ ...scope, 'placementIri': `${scope.placementIri}/child` });

    assert.notEqual(clone.graphDataset, state.graphDataset);
    assert.equal(clone.graphDataset.count({ 'subject': DagGraphTerms.namedNode('urn:dagonizer:parent') }), 0);
    assert.equal(await provider.reopen(scope.runIri), undefined);
  });

  void it('resumes a state reconstructed from a reopened provider dataset', async () => {
    const provider = new ReopeningProvider();
    const runIri = 'urn:dagonizer:run:reopen';
    const dagIri = 'urn:dagonizer:dag:reopen';
    const terminalIri = TestDag.placementIri(dagIri, 'finish');
    const dag = TestDag.of(dagIri, terminalIri, [{
      '@id': terminalIri,
      '@type': 'TerminalNode',
      "name": 'finish',
      "outcome": 'completed',
    }]);
    const dataset = provider.root(runIri);
    const stored = new NodeStateBase(dataset, runIri, provider);
    stored.setMetadata('source', 'durable-graph');

    const dispatcher = new Dagonizer<NodeStateBase>({ 'graphStore': provider });
    dispatcher.registerDAG(dag);

    const result = await dispatcher.resumeWithStateFactory(
      dagIri,
      runIri,
      (reopenedDataset, reopenedRunIri) => new NodeStateBase(reopenedDataset, reopenedRunIri, provider),
      terminalIri,
    );

    assert.equal(result.terminalOutcome, 'completed');
    assert.equal(result.state.getMetadata('source'), 'durable-graph');
    assert.equal(result.state.runIri, runIri);
  });

  void it('writes RDF 1.2 deltas without blocking the live dataset', async () => {
    const journal = new MemoryGraphJournal();
    const runIri = 'urn:dagonizer:run:persistent';
    const dataset = new PersistentGraphDataset(runIri, journal);
    const quoted = DagGraphTerms.quadTerm({
      'subject': DagGraphTerms.namedNode('urn:dagonizer:quoted-subject'),
      'predicate': DagGraphTerms.namedNode('urn:dagonizer:quoted-predicate'),
      'object': DagGraphTerms.literal('quoted-object'),
      'graph': DagGraphTerms.defaultGraph(),
    });
    dataset.assert(
      DagGraphTerms.namedNode('urn:dagonizer:subject'),
      DagGraphTerms.namedNode('urn:dagonizer:predicate'),
      quoted,
    );
    assert.equal(dataset.count({}), 1);
    assert.equal(journal.logs.get(runIri)?.length ?? 0, 0);
    await dataset.flush();
    assert.equal(journal.logs.get(runIri)?.length, 1);

    const reopened = await PersistentGraphDataset.reopen(runIri, journal);
    assert.equal(reopened.count({}), 1);
    assert.equal(reopened.match({ 'object': quoted }).next().done, false);
  });
});
