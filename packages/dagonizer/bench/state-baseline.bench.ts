import { mkdirSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

import { NodeStateBase } from '../src/NodeStateBase.js';

const iterations = 1_000;
const state = new NodeStateBase();
const started = performance.now();
for (let index = 0; index < iterations; index += 1) {
  state.setMetadata(`key-${index % 20}`, index);
  state.recordAttempt('step');
  state.snapshot();
}
const result = { 'benchmark': 'state-baseline', iterations, 'elapsedMs': performance.now() - started };
mkdirSync('.orchestration/bench', { recursive: true });
writeFileSync('.orchestration/bench/state-baseline.json', `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result));
