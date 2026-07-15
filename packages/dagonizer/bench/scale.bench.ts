import { mkdirSync, writeFileSync } from 'node:fs';

import { BenchmarkHarness } from './BenchmarkHarness.js';
import { DagGraphTerms } from '../src/graph/DagGraphTerms.js';
import { GraphStateTransferCodec } from '../src/graph/GraphStateTransferCodec.js';
import { InMemoryGraphDataset } from '../src/graph/InMemoryGraphDataset.js';
import { NodeStateBase } from '../src/NodeStateBase.js';

const SAMPLES = 10;
const SIZES = [250, 1_000, 4_000];

const stateSamples = SIZES.map((size) => ({
  'size': size,
  'samples': Array.from({ length: SAMPLES }, () => {
    const state = new NodeStateBase();
    return BenchmarkHarness.measure(() => {
      for (let index = 0; index < size; index += 1) {
        state.recordAttempt('scale');
      }
      if (state.retriesFor('scale') !== size) throw new Error(`Scale benchmark recorded ${state.retriesFor('scale')} attempts; expected ${size}`);
    });
  }),
}));

const graphSamples = SIZES.map((size) => ({
  'size': size,
  'samples': Array.from({ length: SAMPLES }, () => BenchmarkHarness.measure(() => {
    const graph = DagGraphTerms.namedNode(`urn:bench:scale:${size}#state`);
    const dataset = new InMemoryGraphDataset();
    const quads = Array.from({ length: size }, (_, index) => ({
      'subject': DagGraphTerms.namedNode(`urn:bench:scale:${size}:subject:${index}`),
      'predicate': DagGraphTerms.namedNode('urn:bench:scale:value'),
      'object': DagGraphTerms.literal(String(index)),
      graph,
    }));
    dataset.add(quads);
    const decoded = GraphStateTransferCodec.decode(GraphStateTransferCodec.encode(quads));
    if (decoded.length !== size) throw new Error(`Scale benchmark decoded ${decoded.length} quads; expected ${size}`);
  })),
}));

const summarize = (samples: readonly ReturnType<typeof BenchmarkHarness.measure>[]) => ({
  'latencyMs': BenchmarkHarness.percentiles(samples.map((sample) => sample.elapsedMs)),
  'heapUsedPeakBytes': Math.max(...samples.map((sample) => sample.heapUsedPeakBytes)),
  'heapUsedDeltaBytes': Math.max(...samples.map((sample) => sample.heapUsedDeltaBytes)),
  'rssPeakBytes': Math.max(...samples.map((sample) => sample.rssPeakBytes)),
  'rssDeltaBytes': Math.max(...samples.map((sample) => sample.rssAfterBytes - sample.rssBeforeBytes)),
});

const state = stateSamples.map(({ size, samples }) => ({ 'size': size, ...summarize(samples) }));
const graph = graphSamples.map(({ size, samples }) => ({ 'size': size, ...summarize(samples) }));
const stateScaling = state[2].latencyMs.p50 / state[1].latencyMs.p50;
const graphScaling = graph[2].latencyMs.p50 / graph[1].latencyMs.p50;
if (stateScaling > 8) throw new Error(`State scaling regression: 4,000/1,000 p50 ratio ${stateScaling.toFixed(2)} exceeds 8`);
if (graphScaling > 8) throw new Error(`Graph scaling regression: 4,000/1,000 p50 ratio ${graphScaling.toFixed(2)} exceeds 8`);

const result = { 'benchmark': 'scale', 'samplesPerSize': SAMPLES, 'sizes': SIZES, state, graph, 'stateScalingP50': stateScaling, 'graphScalingP50': graphScaling };
mkdirSync('.orchestration/bench', { recursive: true });
writeFileSync('.orchestration/bench/scale.json', `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result));
