import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { DagGraphTerms } from '../../src/graph/DagGraphTerms.js';
import { GraphStateTerms } from '../../src/graph/GraphStateTerms.js';
import { InMemoryGraphDataset } from '../../src/graph/InMemoryGraphDataset.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';

void describe('graph-state performance smoke invariants', () => {
  void it('streams the first graph quad without requiring snapshot materialization', async () => {
    const state = new NodeStateBase(new InMemoryGraphDataset(), 'urn:perf:run');
    for (let index = 0; index < 100; index += 1) state.setMetadata(`key-${index}`, index);
    const iterator = state.snapshotGraph()[Symbol.asyncIterator]();
    const first = await iterator.next();

    assert.equal(first.done, false);
    assert.equal(first.value?.graph.value, GraphStateTerms.runGraphIri(state.runIri));
  });

  void it('clears explicit run scope without retaining quads in the dataset', () => {
    const dataset = new InMemoryGraphDataset();
    const state = new NodeStateBase(dataset, 'urn:perf:cleanup');
    state.setMetadata('transient', true);
    dataset.clearGraph(DagGraphTerms.namedNode(GraphStateTerms.runGraphIri(state.runIri)));

    assert.equal(dataset.count({ "graph": DagGraphTerms.namedNode(GraphStateTerms.runGraphIri(state.runIri)) }), 0);
  });

  void it('keeps the browser-compatible N3 adapter free of Node-only imports', () => {
    const source = readFileSync(new URL('../../../src/adapter/N3GraphDataset.ts', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /from ['"]node:/);
  });
});
