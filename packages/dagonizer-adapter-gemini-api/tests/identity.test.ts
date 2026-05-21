import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { GeminiApiAdapter } from '../src/index.js';
void test('GeminiApiAdapter identity + capabilities', () => {
  const a = new GeminiApiAdapter({ 'apiKey': 'test' });
  assert.equal(a.id, 'gemini-api');
  assert.equal(a.capabilities.toolUse, 'full');
});
