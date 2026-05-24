/**
 * Smoke: MistralEmbedder identity + probe behaviour.
 * No real network calls; instantiation + fetch-stub only.
 */

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import { MistralEmbedder } from '../src/index.js';

void test('MistralEmbedder identity + default dimensions (mistral-embed)', () => {
  const embedder = new MistralEmbedder('test-key');
  assert.equal(embedder.id, 'mistral');
  assert.ok(embedder.displayName.toLowerCase().includes('mistral'));
  assert.equal(embedder.dimensions, 1024);
});

void test('MistralEmbedder accepts custom model + dimensions override', () => {
  const embedder = new MistralEmbedder('k', { 'model': 'codestral-embed', 'dimensions': 1536 });
  assert.ok(embedder.displayName.includes('codestral-embed'));
  assert.equal(embedder.dimensions, 1536);
});

void test('MistralEmbedder.probe returns true when apiKey is supplied', async () => {
  const embedder = new MistralEmbedder('real-key');
  assert.equal(await embedder.probe(), true);
});

void test('MistralEmbedder.probe returns false when apiKey is empty', async () => {
  const embedder = new MistralEmbedder('');
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

void test('MistralEmbedder.embed extracts data[0].embedding from response body', async () => {
  installFetch((async () => new Response(JSON.stringify({
    'data': [{ 'embedding': [0.9, 0.8, 0.7] }],
  }), { 'status': 200 })) as typeof fetch);
  const embedder = new MistralEmbedder('k');
  try {
    const vec = await embedder.embed('hello');
    assert.deepEqual(vec, [0.9, 0.8, 0.7]);
  } finally {
    restoreFetch();
  }
});
