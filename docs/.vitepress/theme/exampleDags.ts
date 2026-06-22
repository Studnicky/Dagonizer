/**
 * exampleDags: archivist DAG topologies for the docs `<DagGraph>` showcase.
 *
 * The archivist DAGs are factory-built (`ArchivistBundleFactory.create(nodes)`
 * etc.) rather than exported as consts, so this helper builds them once with
 * stub services and re-exports the resulting `DAGType` topologies. Only the
 * graph SHAPE is rendered — the stub services are never executed.
 */

import type { DAGType } from '@studnicky/dagonizer';

import { GoogleBooksTool } from '@studnicky/dagonizer-tool-googlebooks';
import { OpenLibrarySearchTool, SubjectSearchTool } from '@studnicky/dagonizer-tool-openlibrary';
import { WikipediaSummaryTool } from '@studnicky/dagonizer-tool-wikipedia';

import { ArchivistBundleFactory } from '../../../examples/the-archivist/dag.ts';
import { BookSearchScatterBundleFactory } from '../../../examples/the-archivist/embedded-dags/BookSearchScatterDAG.ts';
import { ComposeRetryLoopBundleFactory } from '../../../examples/the-archivist/embedded-dags/ComposeRetryLoopDAG.ts';
import { MemoryStore } from '../../../examples/the-archivist/memory/MemoryStore.ts';
import { ArchivistNodes } from '../../../examples/the-archivist/nodes/ArchivistNodes.ts';
import type { ArchivistServices, LlmClientInterface } from '../../../examples/the-archivist/services.ts';

// Stub LLM: satisfies the type for DAG construction only; never executed here.
class StubLlm implements LlmClientInterface {
  classifyIntent():        Promise<never> { return Promise.reject(new Error('stub')); }
  extractTerms():          Promise<never> { return Promise.reject(new Error('stub')); }
  decideTools():           Promise<never> { return Promise.reject(new Error('stub')); }
  rankCandidates():        Promise<never> { return Promise.reject(new Error('stub')); }
  compose():               Promise<never> { return Promise.reject(new Error('stub')); }
  composeAuthor():         Promise<never> { return Promise.reject(new Error('stub')); }
  composeReviews():        Promise<never> { return Promise.reject(new Error('stub')); }
  describeBook():          Promise<never> { return Promise.reject(new Error('stub')); }
  composeSimilar():        Promise<never> { return Promise.reject(new Error('stub')); }
  validate():              Promise<never> { return Promise.reject(new Error('stub')); }
  composeMemoryRecall():   Promise<never> { return Promise.reject(new Error('stub')); }
  composeEmptyResponse():  Promise<never> { return Promise.reject(new Error('stub')); }
  suggestStarterQuery():   Promise<never> { return Promise.reject(new Error('stub')); }
  suggestGreeting():       Promise<never> { return Promise.reject(new Error('stub')); }
  suggestVisitorReplyTo(): Promise<never> { return Promise.reject(new Error('stub')); }
  explainTool():           Promise<never> { return Promise.reject(new Error('stub')); }
}

const archivistServices: ArchivistServices = {
  webSearch:        new OpenLibrarySearchTool(),
  googleBooks:      new GoogleBooksTool(),
  subjectSearch:    new SubjectSearchTool(),
  wikipediaSummary: new WikipediaSummaryTool(),
  memory:           new MemoryStore(),
  llm:              new StubLlm(),
  embedder:         null,
  nodeTimeouts:     {},
};

const archivistNodes = ArchivistNodes.build(archivistServices);

const archivistDag    = ArchivistBundleFactory.create(archivistNodes).dags[0];
const bookSearchDag   = BookSearchScatterBundleFactory.create(archivistNodes).dags[0];
const composeLoopDag  = ComposeRetryLoopBundleFactory.create(archivistNodes).dags[0];

if (archivistDag === undefined || bookSearchDag === undefined || composeLoopDag === undefined) {
  throw new Error('exampleDags: an archivist bundle produced no DAG');
}

export const archivistDAG: DAGType         = archivistDag;
export const BookSearchScatterDAG: DAGType = bookSearchDag;
export const ComposeRetryLoopDAG: DAGType  = composeLoopDag;
