/**
 * merge-fallback: unit tests for mergeCandidates prior-memory fallback.
 *
 * Covers:
 *   • live empty + prior > 0  → shortlist comes from prior, all carry fromPriorMemory, routes 'ranked'
 *   • live > 0 + prior > 0 (1 overlap) → merged with live preferred, deduplicated
 *   • both empty → routes 'empty'
 *
 * Uses a minimal fixture for context.services (only logger + CanonicalId.dedupe path needed).
 */

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import { ArchivistState } from '../../ArchivistState.ts';
import { mergeCandidates } from '../../nodes/mergeCandidates.ts';
import type { Candidate } from '../../entities/Book.ts';
import { BookBuilder } from '../../entities/Book.ts';

// ── Minimal context fixture ───────────────────────────────────────────────────

const logs: string[] = [];

/** Context and candidate factories for merge-fallback unit tests. */
class MergeFallbackFixture {
  static makeContext() {
    return {
      signal: new AbortController().signal,
      services: {
        logger: {
          info(msg: string) { logs.push(msg); },
          warn(msg: string) { logs.push(`WARN: ${msg}`); },
        },
      },
    } as unknown as Parameters<typeof mergeCandidates.execute>[1];
  }

  static liveCandidate(isbn: string, score: number): Candidate {
    return {
      'book':   BookBuilder.from({ isbn, 'title': `Title ${isbn}`, 'authors': ['Author'] }),
      score,
      'source': 'openlibrary',
    };
  }

  static priorCandidate(isbn: string): Candidate {
    return {
      'book':   BookBuilder.from({ isbn, 'title': `Prior ${isbn}`, 'authors': ['Prior Author'] }),
      'score':  0.5,
      'source': 'openlibrary',
      'notes':  { 'fromPriorMemory': true },
    };
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

void test('mergeCandidates: live=0 + prior=3 → shortlist=3, all fromPriorMemory, routes ranked', async () => {
  logs.length = 0;
  const state = new ArchivistState();
  state.query          = 'some query';
  state.userLanguage   = 'en';
  state.candidates     = [];
  state.priorCandidates = [
    MergeFallbackFixture.priorCandidate('A001'),
    MergeFallbackFixture.priorCandidate('A002'),
    MergeFallbackFixture.priorCandidate('A003'),
  ];

  const result = await mergeCandidates.execute(state, MergeFallbackFixture.makeContext());

  assert.equal(result.output, 'ranked', 'routes ranked when prior candidates present');
  assert.equal(state.shortlist.length, 3, 'shortlist length = 3');
  assert.equal(
    state.shortlist.every((c) => c.notes?.['fromPriorMemory'] === true),
    true,
    'all shortlisted candidates carry fromPriorMemory',
  );
});

void test('mergeCandidates: live=2 + prior=3 (1 overlap isbn B001) → dedupe → 4 after merge', async () => {
  logs.length = 0;
  const state = new ArchivistState();
  state.query          = 'some query';
  state.userLanguage   = 'en';
  state.candidates     = [
    MergeFallbackFixture.liveCandidate('B001', 0.9),  // overlaps with prior
    MergeFallbackFixture.liveCandidate('B002', 0.8),
  ];
  state.priorCandidates = [
    MergeFallbackFixture.priorCandidate('B001'),  // duplicate; live score 0.9 wins
    MergeFallbackFixture.priorCandidate('B003'),
    MergeFallbackFixture.priorCandidate('B004'),
  ];

  const result = await mergeCandidates.execute(state, MergeFallbackFixture.makeContext());

  assert.equal(result.output, 'ranked', 'routes ranked');
  // B001 live + B002 live + B003 prior + B004 prior = 4 unique
  assert.equal(state.shortlist.length, 4, '4 unique items after dedupe (capped at 5)');
  // B001 must be the live version (higher score 0.9 beats prior 0.5).
  const b001 = state.shortlist.find((c) => c.book.identity.isbn === 'B001');
  assert.notEqual(b001, undefined);
  // Live candidate has no notes.fromPriorMemory; prior does.
  // mergeCandidates keeps live for duplicates by filtering priorCandidates with liveIsbns.
  assert.notEqual(b001?.notes?.['fromPriorMemory'], true, 'live version of B001 wins (no fromPriorMemory)');
});

void test('mergeCandidates: both empty → routes empty', async () => {
  logs.length = 0;
  const state = new ArchivistState();
  state.query          = 'some query';
  state.userLanguage   = 'en';
  state.candidates     = [];
  state.priorCandidates = [];

  const result = await mergeCandidates.execute(state, MergeFallbackFixture.makeContext());

  assert.equal(result.output, 'empty', 'routes empty when both pools empty');
  assert.equal(state.shortlist.length, 0);
});

void test('mergeCandidates: live=3 + prior=0 → original path, no regression', async () => {
  logs.length = 0;
  const state = new ArchivistState();
  state.query          = 'some query';
  state.userLanguage   = 'en';
  state.candidates     = [
    MergeFallbackFixture.liveCandidate('C001', 0.9),
    MergeFallbackFixture.liveCandidate('C002', 0.7),
    MergeFallbackFixture.liveCandidate('C003', 0.5),
  ];
  state.priorCandidates = [];

  const result = await mergeCandidates.execute(state, MergeFallbackFixture.makeContext());

  assert.equal(result.output, 'ranked');
  assert.equal(state.shortlist.length, 3);
});

void test('mergeCandidates: prior-only fallback sets failureCause when still empty after language filter', async () => {
  // Edge case: prior candidates have a language that doesn't match → filtered → empty.
  // This ensures the failureCause is set properly even in the prior-only path.
  logs.length = 0;
  const state = new ArchivistState();
  state.query          = 'some query';
  state.userLanguage   = 'ja'; // Japanese
  state.candidates     = [];
  // Prior candidate with German language; should be filtered out by language gate.
  state.priorCandidates = [{
    book: BookBuilder.from({
      isbn:      'D001',
      title:     'Deutsch Buch',
      authors:   ['Autor'],
      price:     { amount: 0, currency: 'USD' },
      languages: ['ger'],  // ISO 639-2 German; won't pass Japanese filter
    }),
    score:  0.5,
    source: 'openlibrary',
    notes:  { fromPriorMemory: true },
  }];

  const result = await mergeCandidates.execute(state, MergeFallbackFixture.makeContext());

  assert.equal(result.output, 'empty', 'routes empty when language-filtered prior candidates are empty');
  assert.notEqual(state.failureCause, '', 'failureCause set on empty after filter');
});
