import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DagGraphTerms } from '../../src/graph/DagGraphTerms.js';
import { GraphRetentionManager } from '../../src/graph/GraphRetentionManager.js';
import { InMemoryGraphDataset } from '../../src/graph/InMemoryGraphDataset.js';

void describe('GraphRetentionManager', () => {
  void it('keeps dry-run and applied cleanup reports equivalent', () => {
    const dataset = new InMemoryGraphDataset();
    const graphs = ['urn:retention:one', 'urn:retention:two', 'urn:retention:memory'];
    dataset.add(graphs.map((graph) => ({
      "subject": DagGraphTerms.namedNode(`urn:resource:${graph}`),
      "predicate": DagGraphTerms.namedNode('urn:retention:value'),
      "object": DagGraphTerms.literal('value'),
      "graph": DagGraphTerms.namedNode(graph),
    })));
    const plan = {
      "graphIris": graphs,
      "protectedGraphIris": [],
      "durableGraphIris": ['urn:retention:memory'],
    };
    const manager = new GraphRetentionManager(dataset);
    const dryRun = manager.evaluate(plan);
    const applied = manager.apply(plan);

    assert.deepEqual(applied.prunableGraphIris, dryRun.prunableGraphIris);
    assert.equal(applied.removedQuadCount, dryRun.removedQuadCount);
    assert.equal(dataset.count({ "graph": DagGraphTerms.namedNode('urn:retention:memory') }), 1);
    assert.equal(dataset.count({ "graph": DagGraphTerms.namedNode('urn:retention:one') }), 0);
  });

  void it('removes explicit transient run graphs without touching durable memory', () => {
    const dataset = new InMemoryGraphDataset();
    for (let index = 0; index < 20; index += 1) {
      dataset.add([{
        "subject": DagGraphTerms.namedNode(`urn:run:${index}`),
        "predicate": DagGraphTerms.namedNode('urn:state:value'),
        "object": DagGraphTerms.literal(String(index)),
        "graph": DagGraphTerms.namedNode(`urn:run:${index}#state`),
      }]);
    }
    const manager = new GraphRetentionManager(dataset);
    manager.apply({
      "graphIris": Array.from({ "length": 20 }, (_, index) => `urn:run:${index}#state`),
      "protectedGraphIris": [],
      "durableGraphIris": [],
    });

    assert.equal([...dataset.triples()].length, 0);
  });
});
