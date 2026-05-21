/**
 * Smoke: MistralApiAdapter exposes the expected id, display name, and capability shape.
 * No network calls; instantiation only.
 */

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import { MistralApiAdapter } from '../src/index.js';

void test('MistralApiAdapter identity + capabilities', () => {
  const adapter = new MistralApiAdapter({ 'apiKey': 'test-key' });
  assert.equal(adapter.id, 'mistral');
  assert.ok(adapter.displayName.includes('Mistral'));
  assert.equal(adapter.capabilities.toolUse, 'full');
  assert.equal(adapter.capabilities.structuredOutput, true);
});
