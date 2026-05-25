/**
 * decideTools deterministic shortcuts — unit tests.
 *
 * Exercises the four pattern shortcuts in `matchShortcut`:
 *   • author-lookup       — "by X Y" or lookup-author intent + proper noun
 *   • quoted-single-title — '"X Y"' style
 *   • topic-or-subject    — "books about X" etc.
 *   • catalog-browsing    — "do you have", "show me", etc.
 *   • no-match            — generic query falls through to LLM path
 */

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import { matchShortcut } from '../../nodes/decideTools.ts';

void test('matchShortcut: "books by Stephen King" → author-lookup full fan-out', () => {
  const m = matchShortcut('books by Stephen King', 'search');
  assert.notEqual(m, null);
  assert.equal(m?.pattern, 'author-lookup');
  const names = (m?.calls ?? []).map((c) => c.name);
  assert.deepEqual(names, ['web_search_books', 'google_books_search', 'subject_search', 'wikipedia_summary']);
});

void test('matchShortcut: "lookup-author" intent + multi-word proper noun → author-lookup', () => {
  const m = matchShortcut('Margaret Atwood', 'lookup-author');
  assert.notEqual(m, null);
  assert.equal(m?.pattern, 'author-lookup');
});

void test('matchShortcut: quoted single title routes wikipedia first', () => {
  const m = matchShortcut('"House of Leaves"', 'describe-book');
  assert.notEqual(m, null);
  assert.equal(m?.pattern, 'quoted-single-title');
  const names = (m?.calls ?? []).map((c) => c.name);
  assert.equal(names[0], 'wikipedia_summary');
  assert.equal(names[1], 'web_search_books');
});

void test('matchShortcut: describe-book intent + single proper-noun title → single-title-describe', () => {
  const m = matchShortcut('Piranesi', 'describe-book');
  // Single capitalised word — does NOT match PROPER_NOUN_RE (which needs >= 2 words).
  // So no shortcut fires. This is intentional — single-word titles are ambiguous.
  assert.equal(m, null);
});

void test('matchShortcut: describe-book + multi-word title → single-title-describe', () => {
  const m = matchShortcut('Hyperion Cantos', 'describe-book');
  assert.notEqual(m, null);
  assert.equal(m?.pattern, 'single-title-describe');
});

void test('matchShortcut: "books about labyrinths" → topic-or-subject', () => {
  const m = matchShortcut('books about labyrinths', 'search');
  assert.notEqual(m, null);
  assert.equal(m?.pattern, 'topic-or-subject');
  const names = (m?.calls ?? []).map((c) => c.name);
  assert.deepEqual(names, ['subject_search', 'web_search_books']);
});

void test('matchShortcut: "literature on grief" → topic-or-subject', () => {
  const m = matchShortcut('literature on grief', 'search');
  assert.notEqual(m, null);
  assert.equal(m?.pattern, 'topic-or-subject');
});

void test('matchShortcut: "do you have anything by Le Guin" → author-lookup fires first', () => {
  // "by Le Guin" hits AUTHOR_HINT_RE before BROWSING_RE.
  const m = matchShortcut('do you have anything by Le Guin', 'search');
  assert.notEqual(m, null);
  assert.equal(m?.pattern, 'author-lookup');
});

void test('matchShortcut: "show me your science fiction" → catalog-browsing', () => {
  const m = matchShortcut('show me your science fiction', 'search');
  assert.notEqual(m, null);
  assert.equal(m?.pattern, 'catalog-browsing');
});

void test('matchShortcut: generic ambiguous query → null (LLM path)', () => {
  const m = matchShortcut('something weird and atmospheric', 'search');
  assert.equal(m, null);
});

void test('matchShortcut: empty query → null', () => {
  const m = matchShortcut('   ', 'search');
  assert.equal(m, null);
});
