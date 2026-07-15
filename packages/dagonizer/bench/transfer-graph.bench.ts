import { mkdirSync, writeFileSync } from 'node:fs';
import { BenchmarkHarness } from './BenchmarkHarness.js';
import { DagGraphTerms } from '../src/graph/DagGraphTerms.js';
import { GraphStateTransferCodec } from '../src/graph/GraphStateTransferCodec.js';

const quads = Array.from({ length: 1_000 }, (_, index) => ({
  "subject": DagGraphTerms.namedNode(`urn:bench:transfer:${index}`),
  "predicate": DagGraphTerms.namedNode('urn:bench:value'),
  "object": DagGraphTerms.literal(String(index)),
  "graph": DagGraphTerms.namedNode('urn:bench:transfer#state'),
}));
const identity = { 'dagIri': 'urn:bench:dag', 'placementPath': ['urn:bench:placement'], 'placementIri': 'urn:bench:placement', 'stateGraphIri': 'urn:bench:transfer#state' };
let inlineBytes = 0;
let deltaBytes = 0;
const measurement = BenchmarkHarness.measure(() => {
  const transfer = GraphStateTransferCodec.inline('urn:bench:transfer', ['urn:bench:transfer#state'], quads, identity);
  const delta = GraphStateTransferCodec.delta('urn:bench:transfer', 'snapshot:base', quads.slice(0, 10), quads.slice(10, 20), identity);
  inlineBytes = transfer.byteSize;
  deltaBytes = delta.byteSize;
});
const result = { 'benchmark': 'transfer-graph', inlineBytes, deltaBytes, ...measurement };
mkdirSync('.orchestration/bench', { recursive: true });
writeFileSync('.orchestration/bench/transfer-graph.json', `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result));
