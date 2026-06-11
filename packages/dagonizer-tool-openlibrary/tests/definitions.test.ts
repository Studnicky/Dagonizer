import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { CanonicalId } from '@noocodex/dagonizer-book-entities';

import { OpenLibrarySearchTool, SubjectSearchTool } from '../src/index.js';
void test('OpenLibrarySearchTool definition is well-formed', () => {
  const tool = new OpenLibrarySearchTool();
  assert.equal(typeof tool.definition.name, 'string');
  assert.ok(tool.definition.name.length > 0);
  assert.equal(typeof tool.execute, 'function');
});
void test('SubjectSearchTool definition is well-formed', () => {
  const tool = new SubjectSearchTool();
  assert.equal(typeof tool.definition.name, 'string');
  assert.ok(tool.definition.name.length > 0);
});
void test('CanonicalId.fromIsbns prefers ISBN-13', () => {
  assert.equal(CanonicalId.fromIsbns(['1234567890', '9781234567897']), '9781234567897');
});
void test('CanonicalId.fromWork normalises slug', () => {
  const id = CanonicalId.fromWork('The Three-Body Problem', 'Liu Cixin');
  assert.match(id, /urn:work:the-three-body-problem::liu-cixin/);
});
