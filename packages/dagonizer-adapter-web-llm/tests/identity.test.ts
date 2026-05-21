import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { WebLlmAdapter, detectWebGpu } from '../src/index.js';
void test('WebLlmAdapter identity', () => {
  const a = new WebLlmAdapter();
  assert.equal(a.id, 'web-llm');
  assert.equal(a.capabilities.toolUse, 'partial');
});
void test('detectWebGpu returns false in node', () => {
  assert.equal(detectWebGpu(), false);
});
