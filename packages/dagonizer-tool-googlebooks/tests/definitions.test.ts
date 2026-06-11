import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { GoogleBooksTool } from '../src/index.js';
void test('GoogleBooksTool definition is well-formed', () => {
  const tool = new GoogleBooksTool();
  assert.equal(typeof tool.definition.name, 'string');
  assert.ok(tool.definition.name.length > 0);
  assert.equal(typeof tool.execute, 'function');
});
