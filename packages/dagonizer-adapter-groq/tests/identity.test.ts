/**
 * Smoke: GroqApiAdapter exposes the expected id, display name, and capability shape.
 * No network calls; instantiation only.
 */

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import { GroqApiAdapter } from '../src/index.js';

void test('GroqApiAdapter identity + capabilities', () => {
  const adapter = new GroqApiAdapter({ 'apiKey': 'test-key' });
  assert.equal(adapter.id, 'groq');
  assert.ok(adapter.displayName.includes('Groq'));
  assert.equal(adapter.capabilities.toolUse, 'full');
  assert.equal(adapter.capabilities.structuredOutput, true);
});
