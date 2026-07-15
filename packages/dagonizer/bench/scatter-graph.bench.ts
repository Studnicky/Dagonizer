import { mkdirSync, writeFileSync } from 'node:fs';
import { BenchmarkHarness } from './BenchmarkHarness.js';
import { NodeStateBase } from '../src/NodeStateBase.js';

const parent = new NodeStateBase();
const measurement = BenchmarkHarness.measure(() => {
  for (let index = 0; index < 1_000; index += 1) {
    const clone = parent.clone();
    clone.setMetadata('itemIndex', index);
  }
});
const result = { 'benchmark': 'scatter-graph', 'cloneCount': 1_000, ...measurement };
mkdirSync('.orchestration/bench', { recursive: true });
writeFileSync('.orchestration/bench/scatter-graph.json', `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result));
