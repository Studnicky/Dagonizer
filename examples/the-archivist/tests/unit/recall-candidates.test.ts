/**
 * recallCandidates: unit tests for the prior-memory recall node.
 *
 * Seeds a MemoryStore with prior runs that shortlisted books, then exercises
 * recallCandidates.execute(Batch.of(state), context) across both recall paths:
 *   Jaccard path (no embedder / embedder failure):
 *     • high-overlap query (Jaccard >= 0.35)  → state.priorCandidates populated
 *     • unrelated query (Jaccard < 0.35)       → state.priorCandidates stays empty
 *     • current run is skipped (no self-match)
 *     • books seen in multiple runs are deduplicated
 *     • corrupted memory entry never throws (salvage path)
 *     • embedder=null falls back to Jaccard (no cosineSimilarity note)
 *   Cosine path (embedder present, prior runs carry dag:queryEmbedding):
 *     • similar query (cosine >= 0.70)   → priorCandidates populated, cosineSimilarity note set
 *     • orthogonal query (cosine < 0.70) → priorCandidates stays empty
 *     • embedder throws → falls back to Jaccard path
 *
 * Constructs the node with a minimal injected services record (memory +
 * embedder). Nodes are pure: they emit no logs, so the tests assert on state,
 * not log lines.
 */

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import { ArchivistState } from '../../ArchivistState.ts';
import { RecallCandidatesNode } from '../../nodes/recallCandidates.ts';
import { GRAPH_MEMORY, MemoryStore } from '../../memory/MemoryStore.ts';
import type { ArchivistServices } from '../../services.ts';

import { Batch } from '@studnicky/dagonizer';
import { NodeContext } from '@studnicky/dagonizer/entities';
import type { EmbedderInterface } from '@studnicky/dagonizer/contracts';

// ── Deterministic embedder ───────────────────────────────────────────────────

class DeterministicEmbedder implements EmbedderInterface {
  readonly id = 'deterministic';
  readonly displayName = 'deterministic-embedder';
  readonly dimensions = 4;
  readonly #vector: readonly number[];
  #throwOnce: boolean;
  constructor(vector: readonly number[], options: { throwOnce?: boolean } = {}) {
    this.#vector = vector;
    this.#throwOnce = options.throwOnce ?? false;
  }
  async embed(text: string): Promise<readonly number[]> {
    void text;
    if (this.#throwOnce) {
      this.#throwOnce = false;
      throw new Error('synthetic embed failure');
    }
    return this.#vector;
  }
  async embedBatch(texts: readonly string[]): Promise<readonly (readonly number[])[]> {
    const vectors: (readonly number[])[] = [];
    for (const text of texts) {
      vectors.push(await this.embed(text));
    }
    return vectors;
  }
  async probe(): Promise<boolean> { return true; }
  async connect(): Promise<void> { /* no-op */ }
  async disconnect(): Promise<void> { /* no-op */ }
  async listModels(): Promise<readonly []> { return []; }
}

// ── Stub implementations for never-called ArchivistServices ─────────────────

/** Minimal ToolDefinitionType stub used by service properties that are never invoked. */
const STUB_DEFINITION = {
  'name':         'stub',
  'description':  '',
  'inputSchema':  { 'type': 'object' as const },
  'outputSchema': { 'type': 'object' as const },
  'strict':       false,
} satisfies ArchivistServices['webSearch']['definition'];

/** Never-called stub for tool contracts; satisfies ToolInterface. */
class NullTool {
  readonly definition = STUB_DEFINITION;
  async execute(): Promise<never> {
    return Promise.reject(new Error('NullTool.execute: not called in this test'));
  }
}

/** Never-called stub for LlmClientInterface; satisfies all methods. */
class NullLlm {
  async classifyIntent(): Promise<never>     { return Promise.reject(new Error('not called')); }
  async extractTerms(): Promise<never>       { return Promise.reject(new Error('not called')); }
  async decideTools(): Promise<never>        { return Promise.reject(new Error('not called')); }
  async rankCandidates(): Promise<never>     { return Promise.reject(new Error('not called')); }
  async compose(): Promise<never>            { return Promise.reject(new Error('not called')); }
  async composeAuthor(): Promise<never>      { return Promise.reject(new Error('not called')); }
  async composeReviews(): Promise<never>     { return Promise.reject(new Error('not called')); }
  async describeBook(): Promise<never>       { return Promise.reject(new Error('not called')); }
  async composeSimilar(): Promise<never>     { return Promise.reject(new Error('not called')); }
  async validate(): Promise<never>           { return Promise.reject(new Error('not called')); }
  async composeMemoryRecall(): Promise<never>{ return Promise.reject(new Error('not called')); }
  async composeEmptyResponse(): Promise<never>{ return Promise.reject(new Error('not called')); }
  async suggestStarterQuery(): Promise<never>{ return Promise.reject(new Error('not called')); }
  async suggestGreeting(): Promise<never>    { return Promise.reject(new Error('not called')); }
  async suggestVisitorReplyTo(): Promise<never>{ return Promise.reject(new Error('not called')); }
  async explainTool(): Promise<never>        { return Promise.reject(new Error('not called')); }
}

// ── Minimal fixture context ─────────────────────────────────────────────────

/** Context and seed helpers for recallCandidates unit tests. */
class RecallCandidatesFixture {
  static makeNode(memory: MemoryStore, embedder: EmbedderInterface | null = null) {
    const services: ArchivistServices = {
      webSearch:        new NullTool(),
      googleBooks:      new NullTool(),
      wikipediaSummary: new NullTool(),
      subjectSearch:    new NullTool(),
      llm:              new NullLlm(),
      memory,
      embedder,
      nodeTimeouts:     {},
    };
    return new RecallCandidatesNode(services);
  }

  static context() {
    return NodeContext.create('test-dag', 'recall-candidates', new AbortController().signal);
  }

  static async execute(node: RecallCandidatesNode, state: ArchivistState): Promise<void> {
    const routed = await node.execute(Batch.of(state), RecallCandidatesFixture.context());
    assert.equal(routed.get('recalled')?.size, 1, 'state routes to recalled');
  }

  static seedPriorRun(
    memory: MemoryStore,
    runId: string,
    visitorQuery: string,
    books: Array<{ isbn: string; title: string }>,
    queryEmbedding: readonly number[] | null = null,
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
      memory.assert(runTerm, dagShortlisted, bookTerm,                          GRAPH_MEMORY);
      memory.assert(bookTerm, dagTitle,      MemoryStore.lit.str(title),         GRAPH_MEMORY);
      memory.assert(bookTerm, dagSource,     MemoryStore.lit.str('openlibrary'), GRAPH_MEMORY);
    }
  }
}

// ── Jaccard path ──────────────────────────────────────────────────────────────

void test('recallCandidates: high-overlap query loads prior shortlisted books', async () => {
  const memory = new MemoryStore();

  // Prior run: query "X Y Z" shortlisted 3 books.
  RecallCandidatesFixture.seedPriorRun(memory, 'prior-run-1', 'existentialism science fiction philosophy', [
    { isbn: '0000000001', title: 'Being and Nothingness' },
    { isbn: '0000000002', title: 'The Stranger' },
    { isbn: '0000000003', title: 'Nausea' },
  ]);

  const state = new ArchivistState();
  state.runId  = 'current-run-1';
  state.query  = 'existentialism fiction philosophy';
  state.terms  = ['existentialism', 'fiction', 'philosophy'];

  const node = RecallCandidatesFixture.makeNode(memory);
  await RecallCandidatesFixture.execute(node, state);

  assert.equal(state.priorCandidates.length, 3, 'should load 3 prior books');
  assert.equal(
    state.priorCandidates.every((c) => c.notes?.['fromPriorMemory'] === true),
    true,
    'all prior candidates must carry notes.fromPriorMemory: true',
  );
  assert.equal(state.priorCandidates[0]?.score, 0.5, 'recalled candidates score 0.5');
  const titles = state.priorCandidates.map((c) => c.book.identity.title);
  assert.equal(titles.includes('Being and Nothingness'), true);
  assert.equal(titles.includes('The Stranger'), true);
  assert.equal(titles.includes('Nausea'), true);
});

void test('recallCandidates: unrelated query yields no prior candidates', async () => {
  const memory = new MemoryStore();

  // Prior run: query about existentialism.
  RecallCandidatesFixture.seedPriorRun(memory, 'prior-run-2', 'existentialism science fiction philosophy', [
    { isbn: '0000000004', title: 'Being and Nothingness' },
  ]);

  const state = new ArchivistState();
  state.runId  = 'current-run-2';
  state.query  = 'romance historical fiction';
  state.terms  = ['romance', 'historical', 'fiction'];

  const node = RecallCandidatesFixture.makeNode(memory);
  await RecallCandidatesFixture.execute(node, state);

  // Jaccard("romance historical fiction" vs "existentialism science fiction philosophy"):
  // intersection = {"fiction"} = 1; union = 5; Jaccard = 0.2 < 0.35 → no match.
  assert.equal(state.priorCandidates.length, 0, 'no overlap below 0.35 threshold');
});

void test('recallCandidates: skips the current run', async () => {
  const memory = new MemoryStore();

  // Seed the current run itself; must be skipped.
  RecallCandidatesFixture.seedPriorRun(memory, 'current-run-3', 'existentialism science fiction', [
    { isbn: '0000000005', title: 'Sartre' },
  ]);

  const state = new ArchivistState();
  state.runId  = 'current-run-3';
  state.query  = 'existentialism science fiction';
  state.terms  = ['existentialism', 'science', 'fiction'];

  const node = RecallCandidatesFixture.makeNode(memory);
  await RecallCandidatesFixture.execute(node, state);

  assert.equal(state.priorCandidates.length, 0, 'current run must not self-match');
});

void test('recallCandidates: deduplicates books seen in multiple runs', async () => {
  const memory = new MemoryStore();

  // Two prior runs, both shortlist the same ISBN.
  RecallCandidatesFixture.seedPriorRun(memory, 'prior-run-4a', 'artificial intelligence robots', [
    { isbn: '9999000001', title: 'Do Androids Dream' },
  ]);
  RecallCandidatesFixture.seedPriorRun(memory, 'prior-run-4b', 'robots artificial intelligence singularity', [
    { isbn: '9999000001', title: 'Do Androids Dream' },
    { isbn: '9999000002', title: 'I Robot' },
  ]);

  const state = new ArchivistState();
  state.runId  = 'current-run-4';
  state.query  = 'artificial intelligence robots';
  state.terms  = ['artificial', 'intelligence', 'robots'];

  const node = RecallCandidatesFixture.makeNode(memory);
  await RecallCandidatesFixture.execute(node, state);

  const isbns = state.priorCandidates.map((c) => c.book.identity.isbn);
  const uniqueIsbns = new Set(isbns);
  assert.equal(uniqueIsbns.size, isbns.length, 'no duplicate ISBNs after dedupe');
});

void test('recallCandidates: salvage path, never throws on corrupted memory entry', async () => {
  const memory = new MemoryStore();

  // Seed a run whose book IRI has no title/source; should not throw.
  const runTerm = MemoryStore.runIri('prior-run-corrupt');
  memory.assert(runTerm, MemoryStore.dagIri('visitorQuery'), MemoryStore.lit.str('existentialism fiction'), GRAPH_MEMORY);
  const bookTerm = MemoryStore.bookIri('0000000099');
  memory.assert(runTerm, MemoryStore.dagIri('shortlisted'), bookTerm, GRAPH_MEMORY);
  // No title or source; graceful degradation expected.

  const state = new ArchivistState();
  state.runId  = 'current-run-corrupt';
  state.query  = 'existentialism fiction philosophy';
  state.terms  = ['existentialism', 'fiction', 'philosophy'];

  // Should not throw.
  const node = RecallCandidatesFixture.makeNode(memory);
  await assert.doesNotReject(() => RecallCandidatesFixture.execute(node, state));
  // Book still materialises with fallback title (isbn).
  assert.equal(state.priorCandidates.length, 1);
  assert.equal(state.priorCandidates[0]?.book.identity.isbn, '0000000099');
  assert.equal(state.priorCandidates[0]?.book.identity.title, '0000000099'); // fallback = isbn
});

void test('recallCandidates: embedder=null recalls via the Jaccard path', async () => {
  const memory = new MemoryStore();
  RecallCandidatesFixture.seedPriorRun(memory, 'prior-null-1', 'sci-fi space adventure', [
    { isbn: '1110000004', title: 'Dune' },
  ]);
  const state = new ArchivistState();
  state.runId = 'cur-null-1';
  state.query = 'space adventure';
  state.terms = ['space', 'adventure'];

  const node = RecallCandidatesFixture.makeNode(memory, null);
  await RecallCandidatesFixture.execute(node, state);

  // With no embedder, recall runs the Jaccard path: the prior candidate is
  // loaded but carries no `cosineSimilarity` note (the cosine-path marker).
  assert.equal(state.priorCandidates.length, 1);
  assert.equal(state.priorCandidates[0]?.notes?.['cosineSimilarity'], undefined);
});

// ── Cosine path ──────────────────────────────────────────────────────────────

void test('recallCandidates cosine: similar query (cos >= 0.70) loads prior books with cosineSimilarity note', async () => {
  const memory = new MemoryStore();
  // Prior run query embedding pointed along axis 0.
  RecallCandidatesFixture.seedPriorRun(memory, 'prior-cos-1', 'existentialism', [
    { isbn: '1110000001', title: 'Being and Nothingness' },
  ], [1, 0, 0, 0]);
  // EmbedderInterface returns a query vector close to axis 0 → cosine ~ 1.0
  const embedder = new DeterministicEmbedder([0.95, 0.05, 0, 0]);
  const state = new ArchivistState();
  state.runId = 'cur-cos-1';
  state.query = 'philosophy of being';
  state.terms = ['philosophy', 'being'];

  const node = RecallCandidatesFixture.makeNode(memory, embedder);
  await RecallCandidatesFixture.execute(node, state);

  assert.equal(state.priorCandidates.length, 1, 'should load 1 prior book via cosine');
  const cs = state.priorCandidates[0]?.notes?.['cosineSimilarity'];
  assert.equal(typeof cs, 'number', 'cosineSimilarity must be attached to notes');
  assert.ok(typeof cs === 'number' && cs >= 0.70, `cosine ${String(cs)} must be >= threshold`);
});

void test('recallCandidates cosine: orthogonal query (cos < 0.70) yields no prior candidates', async () => {
  const memory = new MemoryStore();
  RecallCandidatesFixture.seedPriorRun(memory, 'prior-cos-2', 'romance', [
    { isbn: '1110000002', title: 'Pride and Prejudice' },
  ], [0, 1, 0, 0]);
  // Query along axis 0; orthogonal to axis 1 → cosine ~ 0
  const embedder = new DeterministicEmbedder([1, 0, 0, 0]);
  const state = new ArchivistState();
  state.runId = 'cur-cos-2';
  state.query = 'science fiction';
  state.terms = ['science', 'fiction'];

  const node = RecallCandidatesFixture.makeNode(memory, embedder);
  await RecallCandidatesFixture.execute(node, state);

  assert.equal(state.priorCandidates.length, 0, 'orthogonal query must not match');
});

void test('recallCandidates cosine: embedder throws → falls back to Jaccard path', async () => {
  const memory = new MemoryStore();
  // Prior run with a query that overlaps the current one (Jaccard).
  RecallCandidatesFixture.seedPriorRun(memory, 'prior-fb-1', 'existentialism science fiction philosophy', [
    { isbn: '1110000003', title: 'Nausea' },
  ]);
  const embedder = new DeterministicEmbedder([1, 0, 0, 0], { throwOnce: true });
  const state = new ArchivistState();
  state.runId = 'cur-fb-1';
  state.query = 'existentialism philosophy fiction';
  state.terms = ['existentialism', 'philosophy', 'fiction'];

  const node = RecallCandidatesFixture.makeNode(memory, embedder);
  await RecallCandidatesFixture.execute(node, state);

  // Jaccard should populate from the prior run.
  assert.equal(state.priorCandidates.length, 1, 'Jaccard fallback should populate');
  assert.equal(state.priorCandidates[0]?.book.identity.isbn, '1110000003');
});
