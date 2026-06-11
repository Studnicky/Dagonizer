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

import { CandidateScorer } from '../../nodes/rankCandidates.ts';
import { BookBuilder } from '../../entities/Book.ts';
import type { Candidate } from '../../entities/Book.ts';

/** Candidate factory for hybrid-rank unit tests. */
class HybridRankFixture {
  static candidate(over: Partial<Candidate>): Candidate {
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
