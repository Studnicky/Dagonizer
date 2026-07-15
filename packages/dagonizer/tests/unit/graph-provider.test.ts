import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DagGraphTerms } from '../../src/graph/DagGraphTerms.js';
import { InMemoryGraphDatasetProvider } from '../../src/graph/InMemoryGraphDatasetProvider.js';
import { N3GraphDatasetProvider } from '../../src/graph/N3GraphDatasetProvider.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';

const scope = {
  'runIri': 'urn:dagonizer:run:provider',
  'dagIri': 'urn:dagonizer:dag:provider',
  'placementIri': 'urn:dagonizer:dag:provider/node/step',
};

void describe('GraphDatasetProviderInterface implementations', () => {
  void it('mints isolated in-memory root and child datasets', () => {
    const provider = new InMemoryGraphDatasetProvider();
    const root = provider.root(scope.runIri);
    const child = provider.child(scope, { ...scope, 'placementIri': `${scope.placementIri}/child` });

    assert.notEqual(root, child);
    assert.equal(root.count({}), 0);
    assert.equal(child.count({}), 0);
    assert.equal(provider.reopen(scope.runIri), undefined);
  });

  void it('mints isolated N3 datasets and binds them to cloned state', () => {
    const provider = new N3GraphDatasetProvider();
    const state = new NodeStateBase(provider.root(scope.runIri), scope.runIri, provider);
    state.setMetadata('source', 'parent');
    state.graphDataset.assert(
      DagGraphTerms.namedNode('urn:dagonizer:parent'),
      DagGraphTerms.namedNode('urn:dagonizer:predicate'),
      DagGraphTerms.literal('value'),
    );
    const clone = state.clone();

    assert.notEqual(clone.graphDataset, state.graphDataset);
    assert.equal(clone.graphDataset.count({ 'subject': DagGraphTerms.namedNode('urn:dagonizer:parent') }), 0);
    assert.equal(provider.reopen(scope.runIri), undefined);
  });
});
