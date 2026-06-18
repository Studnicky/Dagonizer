import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { BookBuilder, CanonicalId } from '../src/index.js';

void test('CanonicalId.fromIsbns picks ISBN-13 over ISBN-10', () => {
  assert.equal(CanonicalId.fromIsbns(['1234567890', '9781234567897']), '9781234567897');
});
void test('CanonicalId.fromWork is stable', () => {
  const a = CanonicalId.fromWork('Neuromancer', 'William Gibson');
  const b = CanonicalId.fromWork('Neuromancer', 'William Gibson');
  assert.equal(a, b);
});
void test('CanonicalId.dedupe collapses by canonical id', () => {
  const out = CanonicalId.dedupe([
    { 'book': BookBuilder.from({ 'isbn': '9781234567897', 'title': 'Test', 'authors': ['A'] }), 'score': 0.5, 'source': 'a' },
    { 'book': BookBuilder.from({ 'isbn': '9781234567897', 'title': 'Test', 'authors': ['B'] }), 'score': 0.8, 'source': 'b' },
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0]?.score, 0.8);
});
void test('BookBuilder.from applies defaults for missing fields', () => {
  const book = BookBuilder.from({ 'isbn': '9780000000001', 'title': 'Example', 'authors': ['Author A'] });
  assert.deepStrictEqual(book.identity.authors, ['Author A']);
  assert.deepStrictEqual(book.publication.languages, []);
  assert.deepStrictEqual(book.publication.subjects, []);
  assert.deepStrictEqual(book.publication.publishers, []);
  assert.equal(book.publication.firstPublishYear, null);
  assert.equal(book.publication.summary, null);
  assert.equal(book.availability.price.amount, 0);
  assert.equal(book.availability.price.currency, 'USD');
  assert.equal(book.availability.inStock, null);
});
void test('BookBuilder.from preserves all supplied fields', () => {
  const book = BookBuilder.from({
    'isbn':             '9780000000001',
    'title':            'Full Book',
    'authors':          ['Author A', 'Author B'],
    'firstPublishYear': 1985,
    'languages':        ['eng'],
    'publishers':       ['Publisher X'],
    'subjects':         ['sci-fi'],
    'summary':          'A summary.',
    'price':            { 'amount': 9.99, 'currency': 'EUR' },
    'inStock':          true,
  });
  assert.equal(book.identity.isbn, '9780000000001');
  assert.equal(book.identity.title, 'Full Book');
  assert.deepStrictEqual(book.identity.authors, ['Author A', 'Author B']);
  assert.equal(book.publication.firstPublishYear, 1985);
  assert.deepStrictEqual(book.publication.languages, ['eng']);
  assert.deepStrictEqual(book.publication.publishers, ['Publisher X']);
  assert.deepStrictEqual(book.publication.subjects, ['sci-fi']);
  assert.equal(book.publication.summary, 'A summary.');
  assert.equal(book.availability.price.amount, 9.99);
  assert.equal(book.availability.price.currency, 'EUR');
  assert.equal(book.availability.inStock, true);
});
void test('CanonicalId.merge unions publication arrays and keeps richest fields', () => {
  const a = { 'book': BookBuilder.from({ 'isbn': 'X', 'title': 'A', 'subjects': ['s1'], 'summary': 'short' }), 'score': 0.5, 'source': 'a' };
  const b = { 'book': BookBuilder.from({ 'isbn': 'X', 'title': 'A longer title', 'subjects': ['s2'], 'summary': 'much longer summary here' }), 'score': 0.8, 'source': 'b' };
  const merged = CanonicalId.merge(a, b);
  assert.deepStrictEqual(merged.book.publication.subjects, ['s1', 's2']);
  assert.equal(merged.book.identity.title, 'A longer title');
  assert.equal(merged.book.publication.summary, 'much longer summary here');
  assert.equal(merged.score, 0.8);
});
