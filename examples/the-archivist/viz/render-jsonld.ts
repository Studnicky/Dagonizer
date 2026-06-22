/**
 * Render the Archivist DAG as a JSON-LD document.
 *
 * Calls `JsonLdRenderer.render(archivistDAG)` and logs the serialized
 * document to stdout. The document uses the stable `DAGONIZER_VOCAB`
 * URI as its `dag:` prefix, making it consumable by any RDF-aware tool
 * in the noocodex stack (cartographus, sigil, ontology projectors).
 *
 * @example
 * ```ts
 * // docs/guide/archivist.md
 * // <<<examples/the-archivist/viz/render-jsonld.ts
 * ```
 */

// #region jsonld-render
import { JsonLdRenderer, DAGONIZER_VOCAB } from '@studnicky/dagonizer/viz';

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

const doc = JsonLdRenderer.render(archivistDAG);

// DAGONIZER_VOCAB is the stable @context prefix for all dag: terms.
console.log(`// vocab: ${DAGONIZER_VOCAB}`);
console.log(JSON.stringify(doc, null, 2));
// #endregion jsonld-render
