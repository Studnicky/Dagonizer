/**
 * Smoke: GroqApiAdapter exposes the expected id, display name, and capability shape.
 * No network calls; instantiation only.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { GroqApiAdapter } from '../src/index.js';

void test('GroqApiAdapter identity + capabilities', () => {
  const adapter = new GroqApiAdapter('test-key');
  assert.equal(adapter.id, 'groq');
  assert.ok(adapter.displayName.includes('Groq'));
  assert.equal(adapter.capabilities.toolUse, 'full');
  assert.equal(adapter.capabilities.structuredOutput, true);
});

void test('GroqApiAdapter.probe returns true when apiKey is supplied (inherits from OpenAiCompatibleAdapter)', async () => {
  const adapter = new GroqApiAdapter('real-key');
  assert.equal(await adapter.probe(), true);
});

void test('GroqApiAdapter.probe returns false when apiKey is empty', async () => {
  const adapter = new GroqApiAdapter('');
  assert.equal(await adapter.probe(), false);
});
