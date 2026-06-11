import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { WikipediaSummaryTool } from '../src/index.js';
void test('WikipediaSummaryTool definition is well-formed', () => {
  const tool = new WikipediaSummaryTool();
  assert.equal(typeof tool.definition.name, 'string');
  assert.ok(tool.definition.name.length > 0);
  assert.equal(typeof tool.execute, 'function');
});
