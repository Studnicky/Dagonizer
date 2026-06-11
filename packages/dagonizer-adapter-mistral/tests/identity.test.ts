/**
 * Smoke: MistralApiAdapter exposes the expected id, display name, and capability shape.
 * No network calls; instantiation only.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { MistralApiAdapter } from '../src/index.js';

void test('MistralApiAdapter identity + capabilities', () => {
  const adapter = new MistralApiAdapter('test-key');
  assert.equal(adapter.id, 'mistral');
  assert.ok(adapter.displayName.includes('Mistral'));
  assert.equal(adapter.capabilities.toolUse, 'full');
  assert.equal(adapter.capabilities.structuredOutput, true);
});

void test('MistralApiAdapter.probe returns true when apiKey is supplied (inherits from OpenAiCompatibleAdapter)', async () => {
  const adapter = new MistralApiAdapter('real-key');
  assert.equal(await adapter.probe(), true);
});

void test('MistralApiAdapter.probe returns false when apiKey is empty', async () => {
  const adapter = new MistralApiAdapter('');
  assert.equal(await adapter.probe(), false);
});
