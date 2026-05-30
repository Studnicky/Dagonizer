/**
 * decideTools deterministic shortcuts — unit tests.
 *
 * Exercises the five pattern shortcuts in `matchShortcut`:
 *   • isbn-lookup         — ISBN-10 / ISBN-13 (with or without hyphens)
 *   • author-lookup       — "by X Y" or lookup-author intent + proper noun
 *   • quoted-single-title — '"X Y"' style
 *   • topic-or-subject    — "books about X" etc.
 *   • catalog-browsing    — "do you have", "show me", etc.
 *   • no-match            — generic query falls through to LLM path
 */

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import { matchShortcut } from '../../nodes/decideTools.ts';

void test('matchShortcut: "books by Stephen King" → author-lookup full scout plan', () => {
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

void test('matchShortcut: "books by Ursula K. Le Guin" → author-lookup carries author arg', () => {
  // Le Guin is Title-Case so AUTHOR_HINT_RE captures it.
  const m = matchShortcut('books by Ursula Le Guin', 'search');
  assert.notEqual(m, null);
  assert.equal(m?.pattern, 'author-lookup');
  const olCall = (m?.calls ?? []).find((c) => c.name === 'web_search_books');
  assert.ok(olCall !== undefined, 'web_search_books call present');
  assert.equal(olCall.arguments['author'], 'Ursula Le Guin');
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

void test('matchShortcut: "books about consciousness" → topic-or-subject carries subject arg', () => {
  const m = matchShortcut('books about consciousness', 'search');
  assert.notEqual(m, null);
  assert.equal(m?.pattern, 'topic-or-subject');
  const olCall = (m?.calls ?? []).find((c) => c.name === 'web_search_books');
  assert.ok(olCall !== undefined, 'web_search_books call present');
  assert.equal(olCall.arguments['subject'], 'consciousness');
  const subjectCall = (m?.calls ?? []).find((c) => c.name === 'subject_search');
  assert.ok(subjectCall !== undefined, 'subject_search call present');
  assert.equal(subjectCall.arguments['subject'], 'consciousness');
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

// ── ISBN shortcut tests ──────────────────────────────────────────────────────

void test('matchShortcut: ISBN-13 → isbn-lookup shortcut with isbn arg', () => {
  const m = matchShortcut('9780765377067', 'search');
  assert.notEqual(m, null);
  assert.equal(m?.pattern, 'isbn-lookup');
  assert.equal(m?.calls.length, 1);
  const call = m?.calls[0];
  assert.equal(call?.name, 'web_search_books');
  assert.equal(call?.arguments['isbn'], '9780765377067');
  assert.equal(call?.arguments['limit'], 1);
});

void test('matchShortcut: ISBN-10 without hyphens → isbn-lookup', () => {
  // The regex matches consecutive-digit ISBN-10 (9 digits + check digit or X).
  // Hyphenated ISBN-10 (0-7653-7706-7) does not match — hyphens break digit groups;
  // those fall through to the LLM path which handles them via query keywords.
  const m = matchShortcut('0765377067', 'search');
  assert.notEqual(m, null);
  assert.equal(m?.pattern, 'isbn-lookup');
  const call = m?.calls[0];
  assert.equal(call?.name, 'web_search_books');
  assert.ok(typeof call?.arguments['isbn'] === 'string', 'isbn arg is a string');
});
