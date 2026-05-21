import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { OpenLibrarySearchTool, SubjectSearchTool, CanonicalId } from '../src/index.js';
void test('OpenLibrarySearchTool definition is well-formed', () => {
  assert.equal(typeof OpenLibrarySearchTool.definition.name, 'string');
  assert.ok(OpenLibrarySearchTool.definition.name.length > 0);
  assert.equal(typeof OpenLibrarySearchTool.execute, 'function');
});
void test('SubjectSearchTool definition is well-formed', () => {
  assert.equal(typeof SubjectSearchTool.definition.name, 'string');
  assert.ok(SubjectSearchTool.definition.name.length > 0);
});
void test('CanonicalId.fromIsbns prefers ISBN-13', () => {
  assert.equal(CanonicalId.fromIsbns(['1234567890', '9781234567897']), '9781234567897');
});
void test('CanonicalId.fromWork normalises slug', () => {
  const id = CanonicalId.fromWork('The Three-Body Problem', 'Liu Cixin');
  assert.match(id, /urn:work:the-three-body-problem::liu-cixin/);
});
