import { mkdirSync, writeFileSync } from 'node:fs';
import { BenchmarkHarness } from './BenchmarkHarness.js';
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
let report: ReturnType<GraphRetentionManager['apply']> | undefined;
const measurement = BenchmarkHarness.measure(() => {
  report = new GraphRetentionManager(dataset).apply({ "graphIris": graphIris, "protectedGraphIris": [], "dryRun": false });
});
if (report === undefined) throw new Error('Retention benchmark did not produce a report');
const result = { 'benchmark': 'retention-graph', 'removedQuadCount': report.removedQuadCount, ...measurement };
mkdirSync('.orchestration/bench', { recursive: true });
writeFileSync('.orchestration/bench/retention-graph.json', `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result));
