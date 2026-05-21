/**
 * Smoke: OpenRouterApiAdapter exposes the expected id, display name, and capability shape.
 * No network calls; instantiation only.
 */

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import { OpenRouterApiAdapter } from '../src/index.js';

void test('OpenRouterApiAdapter identity + capabilities', () => {
  const adapter = new OpenRouterApiAdapter({ 'apiKey': 'test-key' });
  assert.equal(adapter.id, 'openrouter');
  assert.ok(adapter.displayName.includes('OpenRouter'));
  assert.equal(adapter.capabilities.toolUse, 'partial');
  assert.equal(adapter.capabilities.structuredOutput, true);
});
