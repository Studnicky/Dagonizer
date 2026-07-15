import { mkdirSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

import { N3GraphDataset } from '../src/adapter/N3GraphDataset.js';
import { DagGraphTerms } from '../src/graph/DagGraphTerms.js';

const dataset = new N3GraphDataset();
const graph = DagGraphTerms.namedNode('urn:bench:graph');
const started = performance.now();
for (let index = 0; index < 1_000; index += 1) {
  dataset.add([{
    "subject": DagGraphTerms.namedNode(`urn:bench:subject:${index}`),
    "predicate": DagGraphTerms.namedNode('urn:bench:value'),
    "object": DagGraphTerms.literal(String(index)),
    graph,
  }]);
}
const result = { 'benchmark': 'graph-state', 'quadCount': dataset.count({ graph }), 'elapsedMs': performance.now() - started };
mkdirSync('.orchestration/bench', { recursive: true });
writeFileSync('.orchestration/bench/graph-state.json', `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result));
