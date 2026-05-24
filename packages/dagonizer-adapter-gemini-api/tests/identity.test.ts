import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { GeminiApiAdapter } from '../src/index.js';

void test('GeminiApiAdapter identity + capabilities', () => {
  const a = new GeminiApiAdapter('test');
  assert.equal(a.id, 'gemini-api');
  assert.equal(a.capabilities.toolUse, 'full');
});

void test('GeminiApiAdapter.probe returns true when an apiKey is supplied', async () => {
  const a = new GeminiApiAdapter('real-key');
  assert.equal(await a.probe(), true);
});

void test('GeminiApiAdapter.probe returns false when apiKey is empty', async () => {
  const a = new GeminiApiAdapter('');
  assert.equal(await a.probe(), false);
});

void test('GeminiApiAdapter.probe does not throw on either credential state', async () => {
  await assert.doesNotReject(() => new GeminiApiAdapter('').probe());
  await assert.doesNotReject(() => new GeminiApiAdapter('x').probe());
});
