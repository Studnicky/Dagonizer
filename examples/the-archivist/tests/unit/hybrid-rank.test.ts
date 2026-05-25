/**
 * Hybrid rank composite — unit tests.
 *
 * Exercises the pure `compositeScore` function in `rankCandidates`:
 *   • source priority lifts the same-title candidate above lower-priority sources
 *   • recency bonus fires when first-publish year is within window
 *   • prior-memory bonus adds +0.05
 *   • cosine term contributes when vectors are provided
 *   • absent vectors → Jaccard takes the cosine weight (no signal starvation)
 */

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import { compositeScore } from '../../nodes/rankCandidates.ts';
import type { Candidate } from '../../entities/Book.ts';

function candidate(over: Partial<Candidate>): Candidate {
  return {
    book: {
      isbn: '0',
      title: 'A Book',
      authors: [],
      price: { amount: 0, currency: 'USD' },
    },
    score: 0,
    source: 'openlibrary',
    ...over,
  };
}

const termTokens = new Set(['existential', 'fiction', 'philosophy']);
const currentYear = 2026;

void test('compositeScore: source priority — openlibrary > google > subject > wikipedia', () => {
  const titleVec = [1, 0, 0];
  const queryVec = [1, 0, 0];
  const ol = compositeScore(candidate({ source: 'openlibrary' }),       queryVec, titleVec, termTokens, currentYear);
  const gb = compositeScore(candidate({ source: 'google_books' }),      queryVec, titleVec, termTokens, currentYear);
  const ss = compositeScore(candidate({ source: 'subject_search' }),    queryVec, titleVec, termTokens, currentYear);
  const wp = compositeScore(candidate({ source: 'wikipedia_summary' }), queryVec, titleVec, termTokens, currentYear);
  assert.ok(ol > gb, 'openlibrary outranks google books');
  assert.ok(gb > ss, 'google books outranks subject search');
  assert.ok(ss > wp, 'subject search outranks wikipedia');
});

void test('compositeScore: recency bonus fires only within window', () => {
  const queryVec = [1, 0, 0];
  const titleVec = [1, 0, 0];
  const fresh = compositeScore(candidate({ book: { isbn: 'a', title: 'A', authors: [], price: { amount: 0, currency: 'USD' }, firstPublishYear: 2020 } }), queryVec, titleVec, termTokens, currentYear);
  const old   = compositeScore(candidate({ book: { isbn: 'a', title: 'A', authors: [], price: { amount: 0, currency: 'USD' }, firstPublishYear: 1850 } }), queryVec, titleVec, termTokens, currentYear);
  assert.ok(fresh > old, 'recent publications earn the recency bonus');
  // Bonus weight is 0.10 — delta should be at least that.
  assert.ok((fresh - old) >= 0.099, `delta ${String(fresh - old)} should be ~0.10`);
});

void test('compositeScore: fromPriorMemory adds +0.05', () => {
  const queryVec = [1, 0, 0];
  const titleVec = [1, 0, 0];
  const plain  = compositeScore(candidate({}),                                                 queryVec, titleVec, termTokens, currentYear);
  const prior  = compositeScore(candidate({ notes: { fromPriorMemory: true } }),               queryVec, titleVec, termTokens, currentYear);
  assert.ok(Math.abs((prior - plain) - 0.05) < 1e-9, `memory bonus must be exactly 0.05 (got ${String(prior - plain)})`);
});

void test('compositeScore: cosine term contributes when vectors provided', () => {
  const titleVec = [1, 0, 0];
  const queryVecAligned = [1, 0, 0];     // cos = 1
  const queryVecOrtho   = [0, 1, 0];     // cos = 0
  const aligned = compositeScore(candidate({}), queryVecAligned, titleVec, termTokens, currentYear);
  const ortho   = compositeScore(candidate({}), queryVecOrtho,   titleVec, termTokens, currentYear);
  assert.ok(aligned > ortho, 'aligned vectors must outrank orthogonal');
  // Cosine weight is 0.50 — delta should be at least that.
  assert.ok((aligned - ortho) >= 0.49, `cosine delta ${String(aligned - ortho)} should be ~0.50`);
});

void test('compositeScore: absent vectors redistribute weight to Jaccard (no starvation)', () => {
  // Title overlaps query tokens via Jaccard.
  const c = candidate({ book: { isbn: 'x', title: 'Existential Fiction', authors: [], price: { amount: 0, currency: 'USD' } } });
  const withVecs    = compositeScore(c, [1, 0, 0], [1, 0, 0], termTokens, currentYear);
  const withoutVecs = compositeScore(c, null,     null,       termTokens, currentYear);
  // Without vectors, Jaccard should produce a non-trivial score because
  // weight redistributes onto the token-overlap term.
  assert.ok(withoutVecs > 0.1, `Jaccard-only score (${String(withoutVecs)}) must be substantial`);
  // With vectors aligned, score should still be higher (cosine + jaccard both fire).
  assert.ok(withVecs > withoutVecs, 'aligned vectors should beat Jaccard-only');
});

void test('compositeScore: unknown source defaults to 0.5 priority', () => {
  const queryVec = [1, 0, 0];
  const titleVec = [1, 0, 0];
  const known = compositeScore(candidate({ source: 'openlibrary' }), queryVec, titleVec, termTokens, currentYear);
  const unk   = compositeScore(candidate({ source: 'unknown-source' }), queryVec, titleVec, termTokens, currentYear);
  assert.ok(known > unk, 'known source priority outranks unknown');
});
