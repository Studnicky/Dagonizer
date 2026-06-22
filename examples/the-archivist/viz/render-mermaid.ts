/**
 * Render the Archivist DAG as Mermaid flowchart source.
 *
 * Calls `MermaidRenderer.render(archivistDAG)` and logs the complete
 * `flowchart LR` block to stdout. Paste the output into a Mermaid fence
 * or feed it to any Mermaid renderer.
 *
 * @example
 * ```ts
 * // docs/guide/archivist.md
 * // <<<examples/the-archivist/viz/render-mermaid.ts
 * ```
 */

// #region mermaid-render
import { MermaidRenderer } from '@studnicky/dagonizer/viz';
import { Dagonizer }       from '@studnicky/dagonizer';

import { ArchivistBundleFactory } from '../dag.ts';
import { ArchivistNodes } from '../nodes/ArchivistNodes.ts';
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

const archivistDAG = ArchivistBundleFactory.create(ArchivistNodes.build(stubServices)).dags[0];
if (archivistDAG === undefined) throw new Error('archivistDAG not found in bundle');

const flowchartSource = MermaidRenderer.render(archivistDAG);

console.log(flowchartSource);
// #endregion mermaid-render

// #region list-dags-render
// Read-accessor pattern: pull every registered DAG and render each one.
// `dispatcher.listDAGs()` returns all DAGs registered with registerDAG().
const dispatcher = new Dagonizer();
dispatcher.registerDAG(archivistDAG);

const sources = dispatcher.listDAGs().map((dag) => ({
  name:    dag.name,
  mermaid: MermaidRenderer.render(dag),
}));
console.log(`rendered ${sources.length} DAG(s): ${sources.map((s) => s.name).join(', ')}`);
// #endregion list-dags-render
