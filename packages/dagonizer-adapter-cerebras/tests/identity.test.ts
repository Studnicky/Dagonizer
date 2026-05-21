/**
 * Smoke: CerebrasApiAdapter exposes the expected id, display name, and capability shape.
 * No network calls; instantiation only.
 */

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import { CerebrasApiAdapter } from '../src/index.js';

void test('CerebrasApiAdapter identity + capabilities', () => {
  const adapter = new CerebrasApiAdapter({ 'apiKey': 'test-key' });
  assert.equal(adapter.id, 'cerebras');
  assert.ok(adapter.displayName.includes('Cerebras'));
  assert.equal(adapter.capabilities.toolUse, 'partial');
  assert.equal(adapter.capabilities.structuredOutput, true);
});
