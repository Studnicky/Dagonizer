/**
 * Smoke: OllamaApiAdapter exposes the expected id, display name, and capability shape.
 * No network calls; instantiation only.
 */

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import { OllamaApiAdapter } from '../src/index.js';

void test('OllamaApiAdapter identity + capabilities', () => {
  const adapter = new OllamaApiAdapter();

  assert.equal(adapter.id, 'ollama');
  assert.ok(adapter.displayName.toLowerCase().includes('ollama'));
  assert.equal(adapter.capabilities.toolUse, 'partial');
  assert.equal(adapter.capabilities.structuredOutput, true);
  assert.equal(adapter.capabilities.jsonMode, true);
});

void test('OllamaApiAdapter accepts model + baseUrl overrides without throwing', () => {
  const adapter = new OllamaApiAdapter({
    model: 'mistral:latest',
    baseUrl: 'http://10.0.0.5:11434'
  });

  assert.equal(adapter.id, 'ollama');
});

void test('OllamaApiAdapter accepts custom apiKey for proxied deployments', () => {
  const adapter = new OllamaApiAdapter({ apiKey: 'gateway-token-123' });

  assert.equal(adapter.id, 'ollama');
});
