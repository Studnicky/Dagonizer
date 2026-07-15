import { mkdirSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

import { DagGraphTerms } from '../src/graph/DagGraphTerms.js';
import { GraphRetentionManager } from '../src/graph/GraphRetentionManager.js';
import { InMemoryGraphDataset } from '../src/graph/InMemoryGraphDataset.js';

const dataset = new InMemoryGraphDataset();
const graphIris = Array.from({ length: 1_000 }, (_, index) => `urn:bench:run:${index}#state`);
for (const graphIri of graphIris) dataset.add([{
  "subject": DagGraphTerms.namedNode(graphIri),
  "predicate": DagGraphTerms.namedNode('urn:bench:value'),
  "object": DagGraphTerms.literal('transient'),
  "graph": DagGraphTerms.namedNode(graphIri),
}]);
const started = performance.now();
const report = new GraphRetentionManager(dataset).apply({ "graphIris": graphIris, "protectedGraphIris": [], "dryRun": false });
const result = { 'benchmark': 'retention-graph', 'removedQuadCount': report.removedQuadCount, 'elapsedMs': performance.now() - started };
mkdirSync('.orchestration/bench', { recursive: true });
writeFileSync('.orchestration/bench/retention-graph.json', `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result));
