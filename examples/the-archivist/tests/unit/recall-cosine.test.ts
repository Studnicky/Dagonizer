/**
 * recall-candidates cosine path: unit tests with a deterministic stub embedder.
 *
 * Seeds a MemoryStore with prior runs that have stored `dag:queryEmbedding`
 * literals. Exercises the cosine branch of recallCandidates:
 *   • similar query (cosine >= 0.70)   → priorCandidates populated, notes.cosineSimilarity set
 *   • orthogonal query (cosine < 0.70) → priorCandidates stays empty
 *   • embedder throws → falls back to Jaccard path (existing behaviour)
 */

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import { ArchivistState } from '../../ArchivistState.ts';
import { recallCandidates } from '../../nodes/recallCandidates.ts';
import { GRAPH_MEMORY, MemoryStore } from '../../memory/MemoryStore.ts';

import type { Embedder } from '@noocodex/dagonizer/contracts';

class StubEmbedder implements Embedder {
  readonly id = 'stub';
  readonly displayName = 'stub-embedder';
  readonly dimensions = 4;
  readonly #vector: readonly number[];
  #throwOnce: boolean;
  constructor(vector: readonly number[], options: { throwOnce?: boolean } = {}) {
    this.#vector = vector;
    this.#throwOnce = options.throwOnce ?? false;
  }
  async embed(_text: string): Promise<readonly number[]> {
    if (this.#throwOnce) {
      this.#throwOnce = false;
      throw new Error('synthetic embed failure');
    }
    return this.#vector;
  }
  async embedBatch(texts: readonly string[]): Promise<readonly (readonly number[])[]> {
    return Promise.all(texts.map((t) => this.embed(t)));
  }
  async probe(): Promise<boolean> { return true; }
  async connect(): Promise<void> { /* no-op */ }
  async disconnect(): Promise<void> { /* no-op */ }
}

const logs: string[] = [];
function makeContext(memory: MemoryStore, embedder: Embedder | null) {
  return {
    signal: new AbortController().signal,
    services: {
      memory,
      embedder,
      logger: {
        info(msg: string) { logs.push(msg); },
        warn(msg: string) { logs.push(`WARN: ${msg}`); },
      },
    },
  } as unknown as Parameters<typeof recallCandidates.execute>[1];
}

function seedPriorRun(
  memory: MemoryStore,
  runId: string,
  visitorQuery: string,
  queryEmbedding: readonly number[] | null,
  books: Array<{ isbn: string; title: string }>,
) {
  const runTerm = MemoryStore.runIri(runId);
  const dagVisitorQuery   = MemoryStore.dagIri('visitorQuery');
  const dagShortlisted    = MemoryStore.dagIri('shortlisted');
  const dagTitle          = MemoryStore.dagIri('title');
  const dagSource         = MemoryStore.dagIri('source');
  const dagQueryEmbedding = MemoryStore.dagIri('queryEmbedding');

  memory.assert(runTerm, dagVisitorQuery, MemoryStore.lit.str(visitorQuery), GRAPH_MEMORY);
  if (queryEmbedding !== null) {
    memory.assert(runTerm, dagQueryEmbedding, MemoryStore.lit.str(JSON.stringify(queryEmbedding)), GRAPH_MEMORY);
  }
  for (const { isbn, title } of books) {
    const bookTerm = MemoryStore.bookIri(isbn);
    memory.assert(runTerm, dagShortlisted, bookTerm, GRAPH_MEMORY);
    memory.assert(bookTerm, dagTitle,  MemoryStore.lit.str(title), GRAPH_MEMORY);
    memory.assert(bookTerm, dagSource, MemoryStore.lit.str('openlibrary'), GRAPH_MEMORY);
  }
}

void test('recallCandidates cosine: similar query (cos >= 0.70) loads prior books with cosineSimilarity note', async () => {
  logs.length = 0;
  const memory = new MemoryStore();
  // Prior run query embedding pointed along axis 0.
  seedPriorRun(memory, 'prior-cos-1', 'existentialism', [1, 0, 0, 0], [
    { isbn: '1110000001', title: 'Being and Nothingness' },
  ]);
  // Embedder returns a query vector close to axis 0 → cosine ~ 1.0
  const embedder = new StubEmbedder([0.95, 0.05, 0, 0]);
  const state = new ArchivistState();
  state.runId = 'cur-cos-1';
  state.query = 'philosophy of being';
  state.terms = ['philosophy', 'being'];

  await recallCandidates.execute(state, makeContext(memory, embedder));

  assert.equal(state.priorCandidates.length, 1, 'should load 1 prior book via cosine');
  const cs = state.priorCandidates[0]?.notes?.['cosineSimilarity'];
  assert.equal(typeof cs, 'number', 'cosineSimilarity must be attached to notes');
  assert.ok(typeof cs === 'number' && cs >= 0.70, `cosine ${String(cs)} must be >= threshold`);
});

void test('recallCandidates cosine: orthogonal query (cos < 0.70) yields no prior candidates', async () => {
  logs.length = 0;
  const memory = new MemoryStore();
  seedPriorRun(memory, 'prior-cos-2', 'romance', [0, 1, 0, 0], [
    { isbn: '1110000002', title: 'Pride and Prejudice' },
  ]);
  // Query along axis 0; orthogonal to axis 1 → cosine ~ 0
  const embedder = new StubEmbedder([1, 0, 0, 0]);
  const state = new ArchivistState();
  state.runId = 'cur-cos-2';
  state.query = 'science fiction';
  state.terms = ['science', 'fiction'];

  await recallCandidates.execute(state, makeContext(memory, embedder));

  assert.equal(state.priorCandidates.length, 0, 'orthogonal query must not match');
});

void test('recallCandidates cosine: embedder throws → falls back to Jaccard path', async () => {
  logs.length = 0;
  const memory = new MemoryStore();
  // Prior run with a query that overlaps the current one (Jaccard).
  seedPriorRun(memory, 'prior-fb-1', 'existentialism science fiction philosophy', null, [
    { isbn: '1110000003', title: 'Nausea' },
  ]);
  const embedder = new StubEmbedder([1, 0, 0, 0], { throwOnce: true });
  const state = new ArchivistState();
  state.runId = 'cur-fb-1';
  state.query = 'existentialism philosophy fiction';
  state.terms = ['existentialism', 'philosophy', 'fiction'];

  await recallCandidates.execute(state, makeContext(memory, embedder));

  // Jaccard should populate from the prior run.
  assert.equal(state.priorCandidates.length, 1, 'Jaccard fallback should populate');
  assert.equal(state.priorCandidates[0]?.book.isbn, '1110000003');
});

void test('recallCandidates cosine: embedder=null uses Jaccard path with logged reason', async () => {
  logs.length = 0;
  const memory = new MemoryStore();
  seedPriorRun(memory, 'prior-null-1', 'sci-fi space adventure', null, [
    { isbn: '1110000004', title: 'Dune' },
  ]);
  const state = new ArchivistState();
  state.runId = 'cur-null-1';
  state.query = 'space adventure';
  state.terms = ['space', 'adventure'];

  await recallCandidates.execute(state, makeContext(memory, null));

  assert.equal(state.priorCandidates.length, 1);
  assert.ok(
    logs.some((l) => l.includes('Jaccard >= 0.35')),
    'expected Jaccard-path log marker',
  );
});
