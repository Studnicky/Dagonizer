import { mkdirSync, writeFileSync } from 'node:fs';
import { BenchmarkHarness } from './BenchmarkHarness.js';
import { NodeStateBase } from '../src/NodeStateBase.js';

const iterations = 1_000;
const state = new NodeStateBase();
const measurement = BenchmarkHarness.measure(() => {
  for (let index = 0; index < iterations; index += 1) {
    state.setMetadata(`key-${index % 20}`, index);
    state.recordAttempt('step');
    state.snapshotJsonLd();
  }
});
const result = { 'benchmark': 'state-baseline', iterations, ...measurement };
mkdirSync('.orchestration/bench', { recursive: true });
writeFileSync('.orchestration/bench/state-baseline.json', `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result));
