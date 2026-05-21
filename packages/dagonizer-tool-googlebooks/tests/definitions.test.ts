import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { GoogleBooksTool } from '../src/index.js';
void test('GoogleBooksTool definition is well-formed', () => {
  assert.equal(typeof GoogleBooksTool.definition.name, 'string');
  assert.ok(GoogleBooksTool.definition.name.length > 0);
  assert.equal(typeof GoogleBooksTool.execute, 'function');
});
