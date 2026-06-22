/**
 * Render the Archivist DAG as Cytoscape elements (sync, no DOM).
 *
 * Calls `CytoscapeRenderer.render(archivistDAG, { embeddedDAGs })` with
 * both embedded sub-DAGs registered so the renderer expands them inline
 * as compound-graph children. Logs the total element count to stdout.
 * No Cytoscape instance is created; the element array is the output.
 *
 * @example
 * ```ts
 * // docs/guide/archivist.md
 * // <<<examples/the-archivist/viz/render-cytoscape.ts
 * ```
 */

// #region cytoscape-render
import { CytoscapeRenderer } from '@studnicky/dagonizer/viz';

import { ArchivistBundleFactory }         from '../dag.ts';
import { ArchivistNodes }                 from '../nodes/ArchivistNodes.ts';
import { BookSearchScatterBundleFactory } from '../embedded-dags/BookSearchScatterDAG.ts';
import { ComposeRetryLoopBundleFactory }  from '../embedded-dags/ComposeRetryLoopDAG.ts';
import { MemoryStore } from '../memory/MemoryStore.ts';
import type { ArchivistServices } from '../services.ts';

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

const embeddedDAGs = new Map([
  ['book-search-scatter', BookSearchScatterDAG],
  ['compose-retry-loop',  ComposeRetryLoopDAG],
]);

const elements = CytoscapeRenderer.render(archivistDAG, { embeddedDAGs });

const nodeCount = elements.filter((el) => el.group === 'nodes').length;
const edgeCount = elements.filter((el) => el.group === 'edges').length;

console.log(`elements: ${elements.length} (${nodeCount} nodes, ${edgeCount} edges)`);
// #endregion cytoscape-render
