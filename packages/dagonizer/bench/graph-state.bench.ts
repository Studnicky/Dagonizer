import { mkdirSync, writeFileSync } from 'node:fs';
import { BenchmarkHarness } from './BenchmarkHarness.js';
import { N3GraphDataset } from '../src/adapter/N3GraphDataset.js';
import { DagGraphTerms } from '../src/graph/DagGraphTerms.js';

const dataset = new N3GraphDataset();
const graph = DagGraphTerms.namedNode('urn:bench:graph');
const measurement = BenchmarkHarness.measure(() => {
  for (let index = 0; index < 1_000; index += 1) {
    dataset.add([{
      "subject": DagGraphTerms.namedNode(`urn:bench:subject:${index}`),
      "predicate": DagGraphTerms.namedNode('urn:bench:value'),
      "object": DagGraphTerms.literal(String(index)),
      graph,
    }]);
  }
});
const result = { 'benchmark': 'graph-state', 'quadCount': dataset.count({ graph }), ...measurement };
mkdirSync('.orchestration/bench', { recursive: true });
writeFileSync('.orchestration/bench/graph-state.json', `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result));
