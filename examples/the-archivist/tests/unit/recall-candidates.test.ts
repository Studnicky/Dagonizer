/**
 * recall-candidates: unit tests.
 *
 * Seeds a MemoryStore with a prior run that shortlisted 3 books, then
 * exercises the recallCandidates node with:
 *   • a high-overlap query (Jaccard >= 0.35)  → state.priorCandidates populated
 *   • an unrelated query (Jaccard < 0.35)     → state.priorCandidates stays empty
 *
 * Uses a minimal fixture for `context.services` (only memory + logger needed).
 */

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import { ArchivistState } from '../../ArchivistState.ts';
import { recallCandidates } from '../../nodes/recallCandidates.ts';
import { GRAPH_MEMORY, MemoryStore } from '../../memory/MemoryStore.ts';

// ── Minimal fixture context ─────────────────────────────────────────────────

const logs: string[] = [];

/** Test helpers for recall-candidates unit tests. */
class RecallCandidatesFixture {
  static makeContext(memory: MemoryStore) {
    return {
      signal: new AbortController().signal,
      services: {
        memory,
        logger: {
          info(msg: string) { logs.push(msg); },
          warn(msg: string) { logs.push(`WARN: ${msg}`); },
        },
      },
    } as unknown as Parameters<typeof recallCandidates.runItem>[1];
  }

  static seedPriorRun(memory: MemoryStore, runId: string, visitorQuery: string, books: Array<{ isbn: string; title: string }>) {
    const runTerm = MemoryStore.runIri(runId);
    const dagVisitorQuery = MemoryStore.dagIri('visitorQuery');
    const dagShortlisted  = MemoryStore.dagIri('shortlisted');
    const dagTitle        = MemoryStore.dagIri('title');
    const dagSource       = MemoryStore.dagIri('source');

    memory.assert(runTerm, dagVisitorQuery, MemoryStore.lit.str(visitorQuery), GRAPH_MEMORY);

    for (const { isbn, title } of books) {
      const bookTerm = MemoryStore.bookIri(isbn);
      memory.assert(runTerm, dagShortlisted, bookTerm,                            GRAPH_MEMORY);
      memory.assert(bookTerm, dagTitle,      MemoryStore.lit.str(title),           GRAPH_MEMORY);
      memory.assert(bookTerm, dagSource,     MemoryStore.lit.str('openlibrary'),   GRAPH_MEMORY);
    }
  }
}

// ── Tests ────────────────────────────────────────────────────────────────────

void test('recallCandidates: high-overlap query loads prior shortlisted books', async () => {
  logs.length = 0;
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

  await recallCandidates.runItem(state, RecallCandidatesFixture.makeContext(memory));

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
  logs.length = 0;
  const memory = new MemoryStore();

  // Prior run: query about existentialism.
  RecallCandidatesFixture.seedPriorRun(memory, 'prior-run-2', 'existentialism science fiction philosophy', [
    { isbn: '0000000004', title: 'Being and Nothingness' },
  ]);

  const state = new ArchivistState();
  state.runId  = 'current-run-2';
  state.query  = 'romance historical fiction';
  state.terms  = ['romance', 'historical', 'fiction'];

  await recallCandidates.runItem(state, RecallCandidatesFixture.makeContext(memory));

  // Jaccard("romance historical fiction" vs "existentialism science fiction philosophy"):
  // intersection = {"fiction"} = 1; union = 5; Jaccard = 0.2 < 0.35 → no match.
  assert.equal(state.priorCandidates.length, 0, 'no overlap below 0.35 threshold');
});

void test('recallCandidates: skips the current run', async () => {
  logs.length = 0;
  const memory = new MemoryStore();

  // Seed the current run itself; must be skipped.
  RecallCandidatesFixture.seedPriorRun(memory, 'current-run-3', 'existentialism science fiction', [
    { isbn: '0000000005', title: 'Sartre' },
  ]);

  const state = new ArchivistState();
  state.runId  = 'current-run-3';
  state.query  = 'existentialism science fiction';
  state.terms  = ['existentialism', 'science', 'fiction'];

  await recallCandidates.runItem(state, RecallCandidatesFixture.makeContext(memory));

  assert.equal(state.priorCandidates.length, 0, 'current run must not self-match');
});

void test('recallCandidates: deduplicates books seen in multiple runs', async () => {
  logs.length = 0;
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

  await recallCandidates.runItem(state, RecallCandidatesFixture.makeContext(memory));

  const isbns = state.priorCandidates.map((c) => c.book.identity.isbn);
  const uniqueIsbns = new Set(isbns);
  assert.equal(uniqueIsbns.size, isbns.length, 'no duplicate ISBNs after dedupe');
});

void test('recallCandidates: salvage path, never throws on corrupted memory entry', async () => {
  logs.length = 0;
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
  await assert.doesNotReject(() => recallCandidates.runItem(state, RecallCandidatesFixture.makeContext(memory)));
  // Book still materialises with fallback title (isbn).
  assert.equal(state.priorCandidates.length, 1);
  assert.equal(state.priorCandidates[0]?.book.identity.isbn, '0000000099');
  assert.equal(state.priorCandidates[0]?.book.identity.title, '0000000099'); // fallback = isbn
});
