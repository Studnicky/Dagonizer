/**
 * Well-formedness validation: check three DAGs for authoring violations.
 *
 * `WellFormedValidator.check` returns an array of human-readable strings;
 * an empty array means the DAG is well-formed. Runs on:
 *   archivistDAG        — the parent DAG
 *   BookSearchScatterDAG — the query/scatter sub-DAG
 *   ComposeRetryLoopDAG  — the compose/validate sub-DAG
 */

// #region well-formed-validate
import { WellFormedValidator } from '@studnicky/dagonizer/validation';

import { ArchivistBundleFactory }            from './dag.ts';
import { ArchivistNodes }                    from './nodes/ArchivistNodes.ts';
import { BookSearchScatterBundleFactory }    from './embedded-dags/BookSearchScatterDAG.ts';
import { ComposeRetryLoopBundleFactory }     from './embedded-dags/ComposeRetryLoopDAG.ts';
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

const stubNodes = ArchivistNodes.build(stubServices);
const archivistDAG       = ArchivistBundleFactory.create(stubNodes).dags[0];
const BookSearchScatterDAG = BookSearchScatterBundleFactory.create(stubNodes).dags[0];
const ComposeRetryLoopDAG  = ComposeRetryLoopBundleFactory.create(stubNodes).dags[0];

if (archivistDAG === undefined || BookSearchScatterDAG === undefined || ComposeRetryLoopDAG === undefined) {
  throw new Error('dag not found in bundle');
}

const dags = [
  { label: 'the-archivist',        dag: archivistDAG },
  { label: 'book-search-scatter',  dag: BookSearchScatterDAG },
  { label: 'compose-retry-loop',   dag: ComposeRetryLoopDAG },
] as const;

for (const { label, dag } of dags) {
  const violations = WellFormedValidator.check(dag);
  if (violations.length === 0) {
    console.log(`dag-validate [${label}]: well-formed`);
  } else {
    console.log(`dag-validate [${label}]: ${violations.length} violation(s)`);
    for (const v of violations) {
      console.log(`  - ${v}`);
    }
  }
}
// #endregion well-formed-validate
