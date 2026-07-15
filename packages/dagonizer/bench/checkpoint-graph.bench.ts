import { mkdirSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

import { DagGraphTerms } from '../src/graph/DagGraphTerms.js';
import { GraphStateTransferCodec } from '../src/graph/GraphStateTransferCodec.js';

const quads = Array.from({ length: 1_000 }, (_, index) => ({
  "subject": DagGraphTerms.namedNode(`urn:bench:checkpoint:${index}`),
  "predicate": DagGraphTerms.namedNode('urn:bench:value'),
  "object": DagGraphTerms.literal(String(index)),
  "graph": DagGraphTerms.namedNode('urn:bench:checkpoint#state'),
}));
const started = performance.now();
const nquads = GraphStateTransferCodec.encode(quads);
const decoded = GraphStateTransferCodec.decode(nquads);
const result = { 'benchmark': 'checkpoint-graph', 'quadCount': decoded.length, 'bytes': nquads.length, 'elapsedMs': performance.now() - started };
mkdirSync('.orchestration/bench', { recursive: true });
writeFileSync('.orchestration/bench/checkpoint-graph.json', `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result));
