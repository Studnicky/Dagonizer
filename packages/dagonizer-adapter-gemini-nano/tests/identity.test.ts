import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { GeminiNanoAdapter, detectGeminiNano } from '../src/index.js';
void test('GeminiNanoAdapter identity', () => {
  const a = new GeminiNanoAdapter();
  assert.equal(a.id, 'gemini-nano');
  assert.equal(a.capabilities.toolUse, 'none');
});
void test('detectGeminiNano returns unavailable in node', async () => {
  const status = await detectGeminiNano();
  assert.equal(status, 'unavailable');
});
