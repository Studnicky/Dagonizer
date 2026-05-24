/**
 * Smoke: GeminiApiEmbedder identity + probe behaviour.
 * No real network calls; instantiation + fetch-stub only.
 */

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import { GeminiApiEmbedder } from '../src/index.js';

void test('GeminiApiEmbedder identity + default dimensions (text-embedding-004)', () => {
  const embedder = new GeminiApiEmbedder('test-key');
  assert.equal(embedder.id, 'gemini-api');
  assert.ok(embedder.displayName.toLowerCase().includes('gemini'));
  assert.equal(embedder.dimensions, 768);
});

void test('GeminiApiEmbedder accepts custom model and dimensions override', () => {
  const embedder = new GeminiApiEmbedder('k', { 'model': 'text-embedding-005', 'dimensions': 1024 });
  assert.ok(embedder.displayName.includes('text-embedding-005'));
  assert.equal(embedder.dimensions, 1024);
});

void test('GeminiApiEmbedder.probe returns true when apiKey is supplied', async () => {
  const embedder = new GeminiApiEmbedder('real-key');
  assert.equal(await embedder.probe(), true);
});

void test('GeminiApiEmbedder.probe returns false when apiKey is empty', async () => {
  const embedder = new GeminiApiEmbedder('');
  assert.equal(await embedder.probe(), false);
});

interface MutableGlobal {
  fetch?: unknown;
}

const originalFetch = (globalThis as MutableGlobal).fetch;

function installFetch(impl: typeof fetch): void {
  (globalThis as MutableGlobal).fetch = impl;
}

function restoreFetch(): void {
  (globalThis as MutableGlobal).fetch = originalFetch;
}

void test('GeminiApiEmbedder.embed extracts embedding.values from response body', async () => {
  installFetch((async () => new Response(JSON.stringify({
    'embedding': { 'values': [0.5, 0.25, 0.125] },
  }), { 'status': 200 })) as typeof fetch);
  const embedder = new GeminiApiEmbedder('k');
  try {
    const vec = await embedder.embed('hello');
    assert.deepEqual(vec, [0.5, 0.25, 0.125]);
  } finally {
    restoreFetch();
  }
});
