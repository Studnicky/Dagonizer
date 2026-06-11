/**
 * Smoke: OpenRouterApiAdapter exposes the expected id, display name, and capability shape.
 * No network calls; instantiation only.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { OpenRouterApiAdapter } from '../src/index.js';

void test('OpenRouterApiAdapter identity + capabilities', () => {
  const adapter = new OpenRouterApiAdapter('test-key');
  assert.equal(adapter.id, 'openrouter');
  assert.ok(adapter.displayName.includes('OpenRouter'));
  assert.equal(adapter.capabilities.toolUse, 'partial');
  assert.equal(adapter.capabilities.structuredOutput, true);
});

void test('OpenRouterApiAdapter.probe returns true when apiKey is supplied (inherits from OpenAiCompatibleAdapter)', async () => {
  const adapter = new OpenRouterApiAdapter('real-key');
  assert.equal(await adapter.probe(), true);
});

void test('OpenRouterApiAdapter.probe returns false when apiKey is empty', async () => {
  const adapter = new OpenRouterApiAdapter('');
  assert.equal(await adapter.probe(), false);
});
