/**
 * Smoke: CerebrasApiAdapter exposes the expected id, display name, and capability shape.
 * No network calls; instantiation only.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { CerebrasApiAdapter } from '../src/index.js';

void test('CerebrasApiAdapter identity + capabilities', () => {
  const adapter = new CerebrasApiAdapter('test-key');
  assert.equal(adapter.id, 'cerebras');
  assert.ok(adapter.displayName.includes('Cerebras'));
  assert.equal(adapter.capabilities.toolUse, 'partial');
  assert.equal(adapter.capabilities.structuredOutput, true);
});

void test('CerebrasApiAdapter.probe returns true when apiKey is supplied (inherits from OpenAiCompatibleAdapter)', async () => {
  const adapter = new CerebrasApiAdapter('real-key');
  assert.equal(await adapter.probe(), true);
});

void test('CerebrasApiAdapter.probe returns false when apiKey is empty', async () => {
  const adapter = new CerebrasApiAdapter('');
  assert.equal(await adapter.probe(), false);
});
