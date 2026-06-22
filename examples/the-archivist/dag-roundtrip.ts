/**
 * DAG round-trip: serialize → load → validate.
 *
 * Serializes `archivistDAG` to JSON, reloads it through `DAGDocument.load`,
 * asserts structural identity (name, entrypoint, node count), then
 * validates the reloaded document with `Validator.dag.validate`.
 */

// #region dag-roundtrip
import { DAGDocument } from '@studnicky/dagonizer/dag';
import { Validator } from '@studnicky/dagonizer/validation';

import { ArchivistBundleFactory } from './dag.ts';
import { ArchivistNodes } from './nodes/ArchivistNodes.ts';
import { MemoryStore } from './memory/MemoryStore.ts';
import type { ArchivistServices } from './services.ts';

// Minimal stub services — no methods are called during DAG construction.
const STUB_DEFINITION = {
  'name': 'stub', 'description': '', 'inputSchema': { 'type': 'object' as const },
  'outputSchema': { 'type': 'object' as const }, 'strict': false,
} satisfies ArchivistServices['webSearch']['definition'];

class NullTool {
  readonly definition = STUB_DEFINITION;
  async execute(): Promise<never> { return Promise.reject(new Error('stub')); }
}

class NullLlm {
  async classifyIntent(): Promise<never>       { return Promise.reject(new Error('stub')); }
  async extractTerms(): Promise<never>         { return Promise.reject(new Error('stub')); }
  async decideTools(): Promise<never>          { return Promise.reject(new Error('stub')); }
  async rankCandidates(): Promise<never>       { return Promise.reject(new Error('stub')); }
  async compose(): Promise<never>              { return Promise.reject(new Error('stub')); }
  async composeAuthor(): Promise<never>        { return Promise.reject(new Error('stub')); }
  async composeReviews(): Promise<never>       { return Promise.reject(new Error('stub')); }
  async describeBook(): Promise<never>         { return Promise.reject(new Error('stub')); }
  async composeSimilar(): Promise<never>       { return Promise.reject(new Error('stub')); }
  async validate(): Promise<never>             { return Promise.reject(new Error('stub')); }
  async composeMemoryRecall(): Promise<never>  { return Promise.reject(new Error('stub')); }
  async composeEmptyResponse(): Promise<never> { return Promise.reject(new Error('stub')); }
  async suggestStarterQuery(): Promise<never>  { return Promise.reject(new Error('stub')); }
  async suggestGreeting(): Promise<never>      { return Promise.reject(new Error('stub')); }
  async suggestVisitorReplyTo(): Promise<never> { return Promise.reject(new Error('stub')); }
  async explainTool(): Promise<never>          { return Promise.reject(new Error('stub')); }
}

const stubServices: ArchivistServices = {
  'webSearch':        new NullTool(),
  'googleBooks':      new NullTool(),
  'subjectSearch':    new NullTool(),
  'wikipediaSummary': new NullTool(),
  'llm':              new NullLlm(),
  'memory':           new MemoryStore(),
  'embedder':         null,
  'nodeTimeouts':     {},
};

const bundle = ArchivistBundleFactory.create(ArchivistNodes.build(stubServices));
const archivistDAG = bundle.dags[0];
if (archivistDAG === undefined) throw new Error('archivistDAG not found in bundle');

const json     = DAGDocument.serialize(archivistDAG);
const reloaded = DAGDocument.load(json);

console.assert(reloaded.name        === archivistDAG.name,       'name mismatch');
console.assert(reloaded.entrypoint  === archivistDAG.entrypoint, 'entrypoint mismatch');
console.assert(reloaded.nodes.length === archivistDAG.nodes.length, 'node count mismatch');

const validated = Validator.dag.validate(reloaded);

console.log('dag-roundtrip: ok');
console.log(`  name:       ${validated.name}`);
console.log(`  entrypoint: ${validated.entrypoint}`);
console.log(`  nodes:      ${validated.nodes.length}`);
// #endregion dag-roundtrip
