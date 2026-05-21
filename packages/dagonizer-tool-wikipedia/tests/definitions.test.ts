import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { WikipediaSummaryTool } from '../src/index.js';
void test('WikipediaSummaryTool definition is well-formed', () => {
  assert.equal(typeof WikipediaSummaryTool.definition.name, 'string');
  assert.ok(WikipediaSummaryTool.definition.name.length > 0);
  assert.equal(typeof WikipediaSummaryTool.execute, 'function');
});
