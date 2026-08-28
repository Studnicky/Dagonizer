/**
 * book-detail: unit tests for the "tell me about <book already surfaced
 * this conversation>" follow-up path.
 *
 * Covers the full contract for the fix described in the bug report:
 * a follow-up like "Tell me about the invisible man" after the Archivist
 * already surfaced "The Invisible Man" must classify as `book-detail`
 * (not `search`), resolve deterministically to the prior candidate
 * (no fresh catalog search), and compose a grounded single-book
 * description — never the "I found some matches" list.
 *
 *   1. ClassifyIntentNode: raw `book-detail` from the LLM routes to the
 *      `book-detail` output port (mirrors the dispatch-only pattern used
 *      by classify-intent-recommend-top-rated.test.ts for every other
 *      intent — the LLM call itself is not unit-testable without a real
 *      model, so the dispatch contract is what's covered).
 *   2. ResolveBookDetailNode: resolves the visitor's phrase against
 *      `state.priorCandidates` / `state.conversation`-adjacent state,
 *      narrows `state.shortlist` to that one book, and routes 'resolved'.
 *      An unmatched phrase routes 'unresolved' (fallback to search).
 *   3. ComposeResponseNode: dispatches the `book-detail` intent to
 *      `llm.describeBook` (the grounded single-book prompt), not the
 *      generic `llm.compose`.
 *   4. ShortlistDigest.fallbackFor: the deterministic exhausted-retry
 *      fallback for a resolved `book-detail` produces a single-book
 *      detail sentence (title + author + year), never the multi-match
 *      "I found some matches" list.
 */

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import { Batch } from '@studnicky/dagonizer';
import { NodeContext } from '@studnicky/dagonizer/entities';

import { ArchivistState } from '../../ArchivistState.ts';
import { ClassifyIntentNode } from '../../nodes/classifyIntent.ts';
import { ComposeResponseNode, ShortlistDigest } from '../../nodes/composeResponse.ts';
import { BookDetailResolver, ResolveBookDetailNode } from '../../nodes/resolveBookDetail.ts';
import type { ArchivistServices, ClassifiedIntent } from '../../services.ts';
import { BookBuilder } from '../../entities/Book.ts';
import type { CandidateType } from '../../entities/Book.ts';
import { MemoryStore } from '../../memory/MemoryStore.ts';

// ── Fixtures ─────────────────────────────────────────────────────────────

const STUB_DEFINITION = {
  'name': 'stub', 'description': '', 'inputSchema': { 'type': 'object' as const },
  'outputSchema': { 'type': 'object' as const }, 'strict': false,
} satisfies ArchivistServices['webSearch']['definition'];

class NullTool {
  readonly definition = STUB_DEFINITION;
  async execute(): Promise<never> { return Promise.reject(new Error('stub')); }
}

/**
 * Stub `LlmClientInterface`. `classifyIntent` returns a fixed raw intent;
 * `describeBook` and `compose` are tracked so tests can assert which one
 * the compose dispatch picked; every other method is an unused rejected stub.
 */
class TrackedLlm {
  readonly #intent: ClassifiedIntent;
  describeBookCalls = 0;
  composeCalls = 0;
  readonly #describeBookReturn: string;

  constructor(intent: ClassifiedIntent, describeBookReturn = '') {
    this.#intent = intent;
    this.#describeBookReturn = describeBookReturn;
  }

  async classifyIntent(): Promise<ClassifiedIntent> { return this.#intent; }
  async extractTerms(): Promise<never>         { return Promise.reject(new Error('stub')); }
  async decideTools(): Promise<never>          { return Promise.reject(new Error('stub')); }
  async rankCandidates(): Promise<never>       { return Promise.reject(new Error('stub')); }
  async compose(): Promise<string>             { this.composeCalls++; return 'generic compose (should not be used for book-detail)'; }
  async composeAuthor(): Promise<never>        { return Promise.reject(new Error('stub')); }
  async composeReviews(): Promise<never>       { return Promise.reject(new Error('stub')); }
  async describeBook(): Promise<string>        { this.describeBookCalls++; return this.#describeBookReturn; }
  async composeSimilar(): Promise<never>       { return Promise.reject(new Error('stub')); }
  async validate(): Promise<never>             { return Promise.reject(new Error('stub')); }
  async composeMemoryRecall(): Promise<never>  { return Promise.reject(new Error('stub')); }
  async composeEmptyResponse(): Promise<never> { return Promise.reject(new Error('stub')); }
  async suggestStarterQuery(): Promise<never>  { return Promise.reject(new Error('stub')); }
  async suggestGreeting(): Promise<never>      { return Promise.reject(new Error('stub')); }
  async suggestVisitorReplyTo(): Promise<never> { return Promise.reject(new Error('stub')); }
  async explainTool(): Promise<never>          { return Promise.reject(new Error('stub')); }
}

/** Builds a minimal stub `ArchivistServices` around a given `LlmClientInterface`. */
class BookDetailFixture {
  static services(llm: TrackedLlm): ArchivistServices {
    return {
      'webSearch':        new NullTool(),
      'googleBooks':      new NullTool(),
      'subjectSearch':    new NullTool(),
      'wikipediaSummary': new NullTool(),
      'llm':              llm,
      'memory':           new MemoryStore(),
      'embedder':         null,
      'nodeTimeouts':     {},
    };
  }

  static context(nodeName: string) {
    return NodeContext.create('test-dag', nodeName, new AbortController().signal);
  }

  static invisibleMan(): CandidateType {
    return {
      'book': BookBuilder.from({
        'isbn':             '9780486270567',
        'title':            'The Invisible Man',
        'authors':          ['H.G. Wells'],
        'firstPublishYear': 1897,
        'summary':          'A scientist discovers how to become invisible and descends into paranoia and violence.',
        'price':            { 'amount': 0, 'currency': 'USD' },
      }),
      'score':  0.9,
      'source': 'openlibrary',
    };
  }

  static otherBook(): CandidateType {
    return {
      'book': BookBuilder.from({
        'isbn':    '0000000001',
        'title':   'Some Unrelated Novel',
        'authors': ['Nobody Notable'],
        'price':   { 'amount': 0, 'currency': 'USD' },
      }),
      'score':  0.5,
      'source': 'openlibrary',
    };
  }
}

// ── 1. ClassifyIntentNode dispatch ──────────────────────────────────────────

void test('ClassifyIntentNode: raw book-detail routes to the book-detail output port', async () => {
  const node = new ClassifyIntentNode(BookDetailFixture.services(new TrackedLlm('book-detail')));
  const state = new ArchivistState();
  state.query = 'Tell me about the invisible man';
  state.conversation = [
    { 'role': 'visitor',   'text': 'Recommend a classic sci-fi horror novel', 'ts': 1 },
    { 'role': 'archivist', 'text': 'I recommend The Invisible Man by H.G. Wells.', 'ts': 2 },
  ];
  state.priorCandidates = [BookDetailFixture.invisibleMan()];

  const routed = await node.execute(Batch.of(state), BookDetailFixture.context('classify-intent'));
  let matched: string | null = null;
  for (const [output, batch] of routed) {
    if (batch.size > 0) matched = output;
  }
  assert.equal(matched, 'book-detail', 'a "tell me about <prior book>" follow-up routes to book-detail, not on-topic search');
});

// ── 2. ResolveBookDetailNode resolution ─────────────────────────────────────

void test('ResolveBookDetailNode: resolves "tell me about the invisible man" to the prior candidate', async () => {
  const node = new ResolveBookDetailNode();
  const state = new ArchivistState();
  state.query = 'Tell me about the invisible man';
  state.priorCandidates = [BookDetailFixture.otherBook(), BookDetailFixture.invisibleMan()];

  const routed = await node.execute(Batch.of(state), BookDetailFixture.context('resolve-book-detail'));
  const outputs = [...routed].filter(([, batch]) => batch.size > 0).map(([output]) => output);
  assert.deepEqual(outputs, ['resolved'], 'a matching prior candidate resolves deterministically');
  assert.equal(state.shortlist.length, 1, 'shortlist narrows to exactly the resolved book');
  assert.equal(state.shortlist[0]?.book.identity.title, 'The Invisible Man');
  assert.equal(state.shortlist[0]?.book.identity.authors[0], 'H.G. Wells');
});

void test('ResolveBookDetailNode: an unmatched phrase falls back to unresolved (no regression to search)', async () => {
  const node = new ResolveBookDetailNode();
  const state = new ArchivistState();
  state.query = 'tell me about some completely different book nobody mentioned';
  state.priorCandidates = [BookDetailFixture.invisibleMan()];

  const routed = await node.execute(Batch.of(state), BookDetailFixture.context('resolve-book-detail'));
  const outputs = [...routed].filter(([, batch]) => batch.size > 0).map(([output]) => output);
  assert.deepEqual(outputs, ['unresolved'], 'no confident match falls back to the on-topic search branch');
});

void test('BookDetailResolver.candidatePool: de-duplicates by ISBN across sources', () => {
  const state = new ArchivistState();
  state.shortlist = [BookDetailFixture.invisibleMan()];
  state.priorCandidates = [BookDetailFixture.invisibleMan(), BookDetailFixture.otherBook()];
  const pool = BookDetailResolver.candidatePool(state);
  assert.equal(pool.length, 2, 'the duplicate ISBN across shortlist/priorCandidates is folded into one entry');
});

// ── 3. ComposeResponseNode dispatch ─────────────────────────────────────────

void test('ComposeResponseNode: book-detail intent dispatches to describeBook, not the generic compose', async () => {
  const detailText = '"The Invisible Man" by H.G. Wells (1897). A scientist discovers how to become invisible and descends into paranoia and violence.';
  const llm = new TrackedLlm('book-detail', detailText);
  const node = new ComposeResponseNode(BookDetailFixture.services(llm));
  const state = new ArchivistState();
  state.query = 'Tell me about the invisible man';
  state.intent = 'book-detail';
  state.shortlist = [BookDetailFixture.invisibleMan()];

  const routed = await node.execute(Batch.of(state), BookDetailFixture.context('compose-response'));
  const outputs = [...routed].filter(([, batch]) => batch.size > 0).map(([output]) => output);

  assert.deepEqual(outputs, ['drafted']);
  assert.equal(llm.describeBookCalls, 1, 'book-detail must call the grounded single-book describeBook prompt');
  assert.equal(llm.composeCalls, 0, 'book-detail must NOT fall through to the generic multi-candidate compose');
  assert.equal(state.draft, detailText);
  assert.ok(state.draft.includes('The Invisible Man'), 'draft names the resolved book');
  assert.ok(state.draft.includes('H.G. Wells'), 'draft cites the author');
  assert.ok(!state.draft.toLowerCase().includes('i found some matches'), 'draft reads as a description, not a match list');
});

// ── 4. Deterministic exhausted-retry fallback ───────────────────────────────

void test('ShortlistDigest.fallbackFor: resolved book-detail (single candidate) yields a detail sentence, not a match list', () => {
  const draft = ShortlistDigest.fallbackFor('book-detail', [BookDetailFixture.invisibleMan()]);
  assert.ok(draft.includes('The Invisible Man'), 'names the book');
  assert.ok(draft.includes('H.G. Wells'), 'cites the author');
  assert.ok(draft.includes('1897'), 'cites the publication year');
  assert.ok(!draft.toLowerCase().includes('i found some matches'), 'never degrades into the multi-match list phrasing');
  assert.ok(!draft.toLowerCase().includes('ask me about any of these'), 'never degrades into the multi-match list phrasing');
});

void test('ShortlistDigest.fallbackFor: every other intent keeps the multi-match summarize list', () => {
  const draft = ShortlistDigest.fallbackFor('search', [BookDetailFixture.invisibleMan(), BookDetailFixture.otherBook()]);
  assert.ok(draft.toLowerCase().includes('i found'), 'non book-detail intents keep the match-list summary');
});
