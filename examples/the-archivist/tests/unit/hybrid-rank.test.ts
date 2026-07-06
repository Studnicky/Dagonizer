/**
 * Hybrid rank composite: unit tests.
 *
 * Exercises the pure `CandidateScorer.compositeScore` function in `rankCandidates`:
 *   • source priority lifts the same-title candidate above lower-priority sources
 *   • recency bonus fires when first-publish year is within window
 *   • prior-memory bonus adds +0.05
 *   • cosine term contributes when vectors are provided
 *   • absent vectors → Jaccard takes the cosine weight (no signal starvation)
 */

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import { Batch } from '@studnicky/dagonizer';
import { NodeContext } from '@studnicky/dagonizer/entities';
import type { EmbedderInterface } from '@studnicky/dagonizer/contracts';

import { ArchivistState } from '../../ArchivistState.ts';
import { MemoryStore } from '../../memory/MemoryStore.ts';
import { CandidateScorer, RankCandidatesNode } from '../../nodes/rankCandidates.ts';
import { BookBuilder } from '../../entities/Book.ts';
import type { CandidateType } from '../../entities/Book.ts';
import type { ArchivistServices } from '../../services.ts';

/** Candidate factory for hybrid-rank unit tests. */
class HybridRankFixture {
  static candidate(over: Partial<CandidateType>): CandidateType {
    return {
      book: BookBuilder.from({
        isbn: '0',
        title: 'A Book',
        authors: [],
        price: { amount: 0, currency: 'USD' },
      }),
      score: 0,
      source: 'openlibrary',
      ...over,
    };
  }

  static state(...candidates: readonly CandidateType[]): ArchivistState {
    const state = new ArchivistState();
    state.query = 'existential fiction';
    state.terms = ['existential', 'fiction'];
    state.candidates = candidates;
    return state;
  }

  static node(embedder: EmbedderInterface): RankCandidatesNode {
    const services: ArchivistServices = {
      webSearch:        new NullTool(),
      googleBooks:      new NullTool(),
      wikipediaSummary: new NullTool(),
      subjectSearch:    new NullTool(),
      llm:              new NullLlm(),
      memory:           new MemoryStore(),
      embedder,
      nodeTimeouts:     {},
    };
    return new RankCandidatesNode(services);
  }

  static context() {
    return NodeContext.create('test-dag', 'rank-candidates', new AbortController().signal);
  }

  static async execute(node: RankCandidatesNode, state: ArchivistState, context = HybridRankFixture.context()): Promise<void> {
    const routed = await node.execute(Batch.of(state), context);
    assert.equal(routed.get('ranked')?.size, 1, 'state routes to ranked');
  }
}

const STUB_DEFINITION = {
  'name':         'stub',
  'description':  '',
  'inputSchema':  { 'type': 'object' as const },
  'outputSchema': { 'type': 'object' as const },
  'strict':       false,
} satisfies ArchivistServices['webSearch']['definition'];

class NullTool {
  readonly definition = STUB_DEFINITION;
  async execute(): Promise<never> {
    return Promise.reject(new Error('NullTool.execute: not called in this test'));
  }
}

class NullLlm {
  async classifyIntent(): Promise<never>      { return Promise.reject(new Error('not called')); }
  async extractTerms(): Promise<never>        { return Promise.reject(new Error('not called')); }
  async decideTools(): Promise<never>         { return Promise.reject(new Error('not called')); }
  async rankCandidates(): Promise<never>      { return Promise.reject(new Error('not called')); }
  async compose(): Promise<never>             { return Promise.reject(new Error('not called')); }
  async composeAuthor(): Promise<never>       { return Promise.reject(new Error('not called')); }
  async composeReviews(): Promise<never>      { return Promise.reject(new Error('not called')); }
  async describeBook(): Promise<never>        { return Promise.reject(new Error('not called')); }
  async composeSimilar(): Promise<never>      { return Promise.reject(new Error('not called')); }
  async validate(): Promise<never>            { return Promise.reject(new Error('not called')); }
  async composeMemoryRecall(): Promise<never> { return Promise.reject(new Error('not called')); }
  async composeEmptyResponse(): Promise<never>{ return Promise.reject(new Error('not called')); }
  async suggestStarterQuery(): Promise<never> { return Promise.reject(new Error('not called')); }
  async suggestGreeting(): Promise<never>     { return Promise.reject(new Error('not called')); }
  async suggestVisitorReplyTo(): Promise<never>{ return Promise.reject(new Error('not called')); }
  async explainTool(): Promise<never>         { return Promise.reject(new Error('not called')); }
}

class CountingEmbedder implements EmbedderInterface {
  readonly id = 'counting';
  readonly displayName = 'counting-embedder';
  readonly dimensions = 3;
  readonly calls = new Map<string, number>();

  async embed(text: string): Promise<readonly number[]> {
    this.calls.set(text, (this.calls.get(text) ?? 0) + 1);
    return [1, 0, 0];
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

class BlockingSemanticEmbedder extends CountingEmbedder {
  readonly #blockedText: string;
  #release: (() => void) | null = null;
  readonly ready: Promise<void>;
  readonly #readyNow: () => void;

  constructor(blockedText: string) {
    super();
    this.#blockedText = blockedText;
    let readyNow: () => void = () => {};
    this.ready = new Promise<void>((resolve) => {
      readyNow = resolve;
    });
    this.#readyNow = readyNow;
  }

  override async embed(text: string): Promise<readonly number[]> {
    this.calls.set(text, (this.calls.get(text) ?? 0) + 1);
    if (text !== this.#blockedText) return [1, 0, 0];
    this.#readyNow();
    await new Promise<void>((resolve) => {
      this.#release = resolve;
    });
    return [1, 0, 0];
  }

  release(): void {
    this.#release?.();
  }
}

const termTokens = new Set(['existential', 'fiction', 'philosophy']);
const currentYear = 2026;

void test('CandidateScorer.compositeScore: source priority, openlibrary > google > subject > wikipedia', () => {
  const titleVec = [1, 0, 0];
  const queryVec = [1, 0, 0];
  const ol = CandidateScorer.compositeScore(HybridRankFixture.candidate({ source: 'openlibrary' }),       queryVec, titleVec, termTokens, currentYear);
  const gb = CandidateScorer.compositeScore(HybridRankFixture.candidate({ source: 'google_books' }),      queryVec, titleVec, termTokens, currentYear);
  const ss = CandidateScorer.compositeScore(HybridRankFixture.candidate({ source: 'subject_search' }),    queryVec, titleVec, termTokens, currentYear);
  const wp = CandidateScorer.compositeScore(HybridRankFixture.candidate({ source: 'wikipedia_summary' }), queryVec, titleVec, termTokens, currentYear);
  assert.ok(ol > gb, 'openlibrary outranks google books');
  assert.ok(gb > ss, 'google books outranks subject search');
  assert.ok(ss > wp, 'subject search outranks wikipedia');
});

void test('CandidateScorer.compositeScore: recency bonus fires only within window', () => {
  const queryVec = [1, 0, 0];
  const titleVec = [1, 0, 0];
  const fresh = CandidateScorer.compositeScore(HybridRankFixture.candidate({ book: BookBuilder.from({ isbn: 'a', title: 'A', authors: [], price: { amount: 0, currency: 'USD' }, firstPublishYear: 2020 }) }), queryVec, titleVec, termTokens, currentYear);
  const old   = CandidateScorer.compositeScore(HybridRankFixture.candidate({ book: BookBuilder.from({ isbn: 'a', title: 'A', authors: [], price: { amount: 0, currency: 'USD' }, firstPublishYear: 1850 }) }), queryVec, titleVec, termTokens, currentYear);
  assert.ok(fresh > old, 'recent publications earn the recency bonus');
  // Bonus weight is 0.10; delta should be at least that.
  assert.ok((fresh - old) >= 0.099, `delta ${String(fresh - old)} should be ~0.10`);
});

void test('CandidateScorer.compositeScore: fromPriorMemory adds +0.05', () => {
  const queryVec = [1, 0, 0];
  const titleVec = [1, 0, 0];
  const plain  = CandidateScorer.compositeScore(HybridRankFixture.candidate({}),                                                 queryVec, titleVec, termTokens, currentYear);
  const prior  = CandidateScorer.compositeScore(HybridRankFixture.candidate({ notes: { fromPriorMemory: true } }),               queryVec, titleVec, termTokens, currentYear);
  assert.ok(Math.abs((prior - plain) - 0.05) < 1e-9, `memory bonus must be exactly 0.05 (got ${String(prior - plain)})`);
});

void test('CandidateScorer.compositeScore: cosine term contributes when vectors provided', () => {
  const titleVec = [1, 0, 0];
  const queryVecAligned = [1, 0, 0];     // cos = 1
  const queryVecOrtho   = [0, 1, 0];     // cos = 0
  const aligned = CandidateScorer.compositeScore(HybridRankFixture.candidate({}), queryVecAligned, titleVec, termTokens, currentYear);
  const ortho   = CandidateScorer.compositeScore(HybridRankFixture.candidate({}), queryVecOrtho,   titleVec, termTokens, currentYear);
  assert.ok(aligned > ortho, 'aligned vectors must outrank orthogonal');
  // Cosine weight is 0.50; delta should be at least that.
  assert.ok((aligned - ortho) >= 0.49, `cosine delta ${String(aligned - ortho)} should be ~0.50`);
});

void test('CandidateScorer.compositeScore: absent vectors redistribute weight to Jaccard (no starvation)', () => {
  // Title overlaps query tokens via Jaccard.
  const c = HybridRankFixture.candidate({ book: BookBuilder.from({ isbn: 'x', title: 'Existential Fiction', authors: [], price: { amount: 0, currency: 'USD' } }) });
  const withVecs    = CandidateScorer.compositeScore(c, [1, 0, 0], [1, 0, 0], termTokens, currentYear);
  const withoutVecs = CandidateScorer.compositeScore(c, null,     null,       termTokens, currentYear);
  // Without vectors, Jaccard should produce a non-trivial score because
  // weight redistributes onto the token-overlap term.
  assert.ok(withoutVecs > 0.1, `Jaccard-only score (${String(withoutVecs)}) must be substantial`);
  // With vectors aligned, score should still be higher (cosine + jaccard both fire).
  assert.ok(withVecs > withoutVecs, 'aligned vectors should beat Jaccard-only');
});

void test('CandidateScorer.compositeScore: unknown source defaults to 0.5 priority', () => {
  const queryVec = [1, 0, 0];
  const titleVec = [1, 0, 0];
  const known = CandidateScorer.compositeScore(HybridRankFixture.candidate({ source: 'openlibrary' }), queryVec, titleVec, termTokens, currentYear);
  const unk   = CandidateScorer.compositeScore(HybridRankFixture.candidate({ source: 'unknown-source' }), queryVec, titleVec, termTokens, currentYear);
  assert.ok(known > unk, 'known source priority outranks unknown');
});

void test('RankCandidatesNode caches semantic embeddings without writing semantic vectors into candidate notes', async () => {
  const embedder = new CountingEmbedder();
  const node = HybridRankFixture.node(embedder);
  const candidate = HybridRankFixture.candidate({
    book: BookBuilder.from({ isbn: 'cache', title: 'Existential Fiction', authors: ['A'], price: { amount: 0, currency: 'USD' } }),
  });
  const semanticText = CandidateScorer.semanticText(candidate);

  const first = HybridRankFixture.state(candidate);
  await HybridRankFixture.execute(node, first);
  const firstRanked = first.candidates[0];
  assert.equal(firstRanked?.notes?.['semanticEmbedding'], undefined);
  assert.equal(typeof firstRanked?.notes?.['compositeScore'], 'number');

  const second = HybridRankFixture.state(candidate);
  await HybridRankFixture.execute(node, second);

  assert.equal(embedder.calls.get(semanticText), 1, 'semantic candidate embedding is cached across node runs');
  assert.equal(embedder.calls.get('existential fiction'), 2, 'query embedding remains per-run input work');
});

void test('RankCandidatesNode coalesces duplicate in-flight semantic embeddings per signal', async () => {
  const candidate = HybridRankFixture.candidate({
    book: BookBuilder.from({ isbn: 'coalesce', title: 'Liminal Library', authors: ['B'], price: { amount: 0, currency: 'USD' } }),
  });
  const semanticText = CandidateScorer.semanticText(candidate);
  const embedder = new BlockingSemanticEmbedder(semanticText);
  const node = HybridRankFixture.node(embedder);
  const state = HybridRankFixture.state(candidate, candidate);
  const execution = HybridRankFixture.execute(node, state);

  await embedder.ready;
  assert.equal(embedder.calls.get(semanticText), 1, 'only one semantic embedding call is in flight');
  embedder.release();
  await execution;
  assert.equal(embedder.calls.get(semanticText), 1, 'duplicate semantic embedding consumers share the in-flight call');
});
