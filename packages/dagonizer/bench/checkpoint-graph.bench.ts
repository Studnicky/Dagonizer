import { mkdirSync, writeFileSync } from 'node:fs';
import { BenchmarkHarness } from './BenchmarkHarness.js';
import { DagGraphTerms } from '../src/graph/DagGraphTerms.js';
import { GraphStateTransferCodec } from '../src/graph/GraphStateTransferCodec.js';

const quads = Array.from({ length: 1_000 }, (_, index) => ({
  "subject": DagGraphTerms.namedNode(`urn:bench:checkpoint:${index}`),
  "predicate": DagGraphTerms.namedNode('urn:bench:value'),
  "object": DagGraphTerms.literal(String(index)),
  "graph": DagGraphTerms.namedNode('urn:bench:checkpoint#state'),
}));
let nquads = '';
let decoded: ReturnType<typeof GraphStateTransferCodec.decode> = [];
const measurement = BenchmarkHarness.measure(() => {
  nquads = GraphStateTransferCodec.encode(quads);
  decoded = GraphStateTransferCodec.decode(nquads);
});
const result = { 'benchmark': 'checkpoint-graph', 'quadCount': decoded.length, 'bytes': nquads.length, ...measurement };
mkdirSync('.orchestration/bench', { recursive: true });
writeFileSync('.orchestration/bench/checkpoint-graph.json', `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result));
