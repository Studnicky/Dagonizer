import { mkdirSync, writeFileSync } from 'node:fs';
import { BenchmarkHarness } from './BenchmarkHarness.js';
import { DagGraphTerms } from '../src/graph/DagGraphTerms.js';
import { GraphStateTransferCodec } from '../src/graph/GraphStateTransferCodec.js';
import { GraphStateTerms } from '../src/graph/GraphStateTerms.js';
import { InMemoryGraphDataset } from '../src/graph/InMemoryGraphDataset.js';
import { NodeStateBase } from '../src/NodeStateBase.js';

const STATE_ITERATIONS = 100;
const GRAPH_QUADS = 250;
const MAX_STATE_MS = 150;
const MAX_GRAPH_MS = 20;

const warmup = new NodeStateBase();
for (let index = 0; index < 10; index += 1) {
  warmup.setMetadata(`warmup-${index}`, index);
  warmup.recordAttempt('warmup');
  warmup.snapshotJsonLd();
}
const memoryBefore = process.memoryUsage();
const state = new NodeStateBase();
const stateElapsedMs = BenchmarkHarness.elapsed(() => {
  for (let index = 0; index < STATE_ITERATIONS; index += 1) {
    state.setMetadata(`key-${index % 20}`, index);
    state.recordAttempt('smoke');
    state.snapshotJsonLd();
  }
});

const graph = DagGraphTerms.namedNode('urn:bench:smoke#state');
const dataset = new InMemoryGraphDataset();
const quads = Array.from({ length: GRAPH_QUADS }, (_, index) => ({
  'subject': DagGraphTerms.namedNode(`urn:bench:smoke:subject:${index}`),
  'predicate': DagGraphTerms.namedNode('urn:bench:smoke:value'),
  'object': DagGraphTerms.literal(String(index)),
  graph,
}));
const graphWarmup = quads.slice(0, 10);
GraphStateTransferCodec.decode(GraphStateTransferCodec.encode(graphWarmup));
let decoded: ReturnType<typeof GraphStateTransferCodec.decode> = [];
const graphElapsedMs = BenchmarkHarness.elapsed(() => {
  dataset.add(quads);
  const encoded = GraphStateTransferCodec.encode(quads);
  decoded = GraphStateTransferCodec.decode(encoded);
});
const memoryAfter = process.memoryUsage();

const result = {
  'benchmark': 'graph-smoke',
  'stateIterations': STATE_ITERATIONS,
  'graphQuads': GRAPH_QUADS,
  stateElapsedMs,
  graphElapsedMs,
  'heapUsedBeforeBytes': memoryBefore.heapUsed,
  'heapUsedAfterBytes': memoryAfter.heapUsed,
  'heapUsedDeltaBytes': memoryAfter.heapUsed - memoryBefore.heapUsed,
  'rssBeforeBytes': memoryBefore.rss,
  'rssAfterBytes': memoryAfter.rss,
  'stateBudgetMs': MAX_STATE_MS,
  'graphBudgetMs': MAX_GRAPH_MS,
  'stateQuadCount': state.graphDataset.count({ 'graph': DagGraphTerms.namedNode(GraphStateTerms.runGraphIri(state.runIri)) }),
  'attemptResourceCount': state.graphDataset.count({
    'subject': DagGraphTerms.namedNode(state.runIri),
    'predicate': DagGraphTerms.namedNode(GraphStateTerms.DAGONIZER.Attempt),
    'graph': DagGraphTerms.namedNode(GraphStateTerms.runGraphIri(state.runIri)),
  }),
  'decodedQuadCount': decoded.length,
};

if (stateElapsedMs > MAX_STATE_MS) throw new Error(`Graph state smoke benchmark exceeded ${MAX_STATE_MS}ms: ${stateElapsedMs.toFixed(2)}ms`);
if (graphElapsedMs > MAX_GRAPH_MS) throw new Error(`Graph transfer smoke benchmark exceeded ${MAX_GRAPH_MS}ms: ${graphElapsedMs.toFixed(2)}ms`);
if (result.stateQuadCount === 0) throw new Error('Graph state smoke benchmark produced no run graph facts');
if (result.attemptResourceCount !== 1) throw new Error(`Graph state smoke benchmark created ${result.attemptResourceCount} attempt resources; expected one stable resource`);
if (decoded.length !== GRAPH_QUADS) throw new Error(`Graph transfer smoke benchmark decoded ${decoded.length} quads; expected ${GRAPH_QUADS}`);

mkdirSync('.orchestration/bench', { recursive: true });
writeFileSync('.orchestration/bench/graph-smoke.json', `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result));
