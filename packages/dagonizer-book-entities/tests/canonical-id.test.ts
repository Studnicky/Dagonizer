import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { CanonicalId } from '../src/index.js';
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
    { 'book': { 'isbn': '9781234567897', 'title': 'Test', 'authors': ['A'], 'price': { 'amount': 0, 'currency': 'USD' } }, 'score': 0.5, 'source': 'a' },
    { 'book': { 'isbn': '9781234567897', 'title': 'Test', 'authors': ['B'], 'price': { 'amount': 0, 'currency': 'USD' } }, 'score': 0.8, 'source': 'b' },
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0]?.score, 0.8);
});
