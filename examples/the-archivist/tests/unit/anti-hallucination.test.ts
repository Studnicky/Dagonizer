/**
 * Anti-hallucination check: unit tests.
 *
 * Exercises the deterministic pre-validator in `validateResponse`:
 *   • entity detection picks up capitalised multi-word spans and *italic* titles
 *   • clean draft → PASS
 *   • draft naming a non-shortlist title → FAIL with hallucination cause
 *   • draft with shortlist non-empty but mentioning no shortlist title → FAIL bias-check
 *   • author names (2 words) are NOT flagged (heuristic: only 3+ word entities)
 */

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import { ResponseAnalysis } from '../../nodes/composeResponse.ts';
import { BookBuilder } from '../../entities/Book.ts';
import type { CandidateType } from '../../entities/Book.ts';

/** Candidate factory for anti-hallucination unit tests. */
class AntiHallucinationFixture {
  static candidate(title: string, isbn = '0000000000'): CandidateType {
    return {
      book: BookBuilder.from({ isbn, title, authors: [], price: { amount: 0, currency: 'USD' } }),
      score: 0.5,
      source: 'openlibrary',
    };
  }
}

void test('detectEntities: picks up capitalised multi-word spans and italic titles', () => {
  const draft = 'I recommend House of Leaves and *Piranesi*, both touching on liminal architecture. Mark Z Danielewski is a favourite.';
  const entities = ResponseAnalysis.detectEntities(draft);
  assert.ok(entities.includes('House of Leaves'), 'capitalised multi-word with lowercase joiner');
  assert.ok(entities.includes('Piranesi'), 'italic title span');
  assert.ok(entities.includes('Mark Z Danielewski'), 'capitalised author name');
});

void test('antiHallucinationCheck: clean draft passes', () => {
  const draft = 'I recommend House of Leaves; it touches on liminal architecture.';
  const result = ResponseAnalysis.antiHallucinationCheck(draft, [AntiHallucinationFixture.candidate('House of Leaves')], []);
  assert.equal(result.status, 'pass');
  assert.ok(result.count >= 1, 'should have checked at least 1 entity');
});

void test('antiHallucinationCheck: draft naming a non-shortlist 3+ word title FAILS', () => {
  const draft = 'You might enjoy The Time Traveller and the Chronicles Of Riddick, both very engaging.';
  const result = ResponseAnalysis.antiHallucinationCheck(draft, [AntiHallucinationFixture.candidate('House of Leaves')], []);
  assert.equal(result.status, 'fail');
  assert.ok(result.cause.includes('Hallucinated title'), 'should cite the hallucinated title');
});

void test('antiHallucinationCheck: 2-word entities (likely authors) are NOT flagged', () => {
  // "Mark Danielewski" is 2 words; the heuristic skips entities <= 2 words.
  // Draft mentions a real shortlist title to pass the bias-check.
  const draft = 'Mark Danielewski wrote House of Leaves. Stephen King is another good author.';
  const result = ResponseAnalysis.antiHallucinationCheck(draft, [AntiHallucinationFixture.candidate('House of Leaves')], []);
  assert.equal(result.status, 'pass', '2-word capitalised entities (authors) are not flagged');
});

void test('antiHallucinationCheck: bias-check, shortlist non-empty but draft cites none → FAIL', () => {
  const draft = 'Hmm, let me think about that one. I have a few ideas but nothing concrete yet.';
  const result = ResponseAnalysis.antiHallucinationCheck(draft, [AntiHallucinationFixture.candidate('Specific Book Title Here')], []);
  assert.equal(result.status, 'fail');
  assert.ok(result.cause.includes('no book from the shortlist'), 'bias-check failure must mention shortlist');
});

void test('antiHallucinationCheck: priorCandidates count as known titles', () => {
  const draft = 'I recall earlier you asked about The Iron Heel; that one was strong.';
  const result = ResponseAnalysis.antiHallucinationCheck(
    draft,
    [AntiHallucinationFixture.candidate('Some Other Live Result')],     // shortlist
    [AntiHallucinationFixture.candidate('The Iron Heel', '0000000099')], // priorCandidates
  );
  // The Iron Heel is in priorCandidates → no hallucination. But the draft
  // doesn't cite the live shortlist → bias-check fails.
  assert.equal(result.status, 'fail', 'bias-check must still fire on missing shortlist citation');
});

void test('antiHallucinationCheck: empty shortlist + empty priors does not bias-check', () => {
  const draft = 'I don\'t have anything on the shelves for that query right now.';
  const result = ResponseAnalysis.antiHallucinationCheck(draft, [], []);
  assert.equal(result.status, 'pass');
});
