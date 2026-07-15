import { mkdirSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

import { NodeStateBase } from '../src/NodeStateBase.js';

const started = performance.now();
const parent = new NodeStateBase();
for (let index = 0; index < 1_000; index += 1) {
  const clone = parent.clone();
  clone.setMetadata('itemIndex', index);
}
const result = { 'benchmark': 'scatter-graph', 'cloneCount': 1_000, 'elapsedMs': performance.now() - started };
mkdirSync('.orchestration/bench', { recursive: true });
writeFileSync('.orchestration/bench/scatter-graph.json', `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result));
