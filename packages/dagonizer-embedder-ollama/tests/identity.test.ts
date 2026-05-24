/**
 * Smoke: OllamaEmbedder exposes the expected id, display name, and
 * dimensionality. No network calls; instantiation + fetch-stub only.
 */

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import { OllamaEmbedder } from '../src/index.js';

void test('OllamaEmbedder identity + default dimensions (nomic-embed-text)', () => {
  const embedder = new OllamaEmbedder();
  assert.equal(embedder.id, 'ollama');
  assert.ok(embedder.displayName.toLowerCase().includes('ollama'));
  assert.equal(embedder.dimensions, 768);
});

void test('OllamaEmbedder accepts custom model with known dimensions', () => {
  const embedder = new OllamaEmbedder('mxbai-embed-large');
  assert.equal(embedder.dimensions, 1024);
  assert.ok(embedder.displayName.includes('mxbai-embed-large'));
});

void test('OllamaEmbedder accepts explicit dimensions override for unknown model', () => {
  const embedder = new OllamaEmbedder('exotic-model', { 'dimensions': 512 });
  assert.equal(embedder.dimensions, 512);
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

void test('OllamaEmbedder.probe returns true when /api/tags answers 200', async () => {
  installFetch((async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    assert.ok(url.endsWith('/api/tags'));
    return new Response('{"models":[]}', { 'status': 200 });
  }) as typeof fetch);
  const embedder = new OllamaEmbedder('nomic-embed-text', { 'baseUrl': 'http://127.0.0.1:11434' });
  try {
    assert.equal(await embedder.probe(), true);
  } finally {
    restoreFetch();
  }
});

void test('OllamaEmbedder.probe returns false on transport failure', async () => {
  installFetch((async () => { throw new Error('ECONNREFUSED'); }) as typeof fetch);
  const embedder = new OllamaEmbedder();
  try {
    assert.equal(await embedder.probe(), false);
  } finally {
    restoreFetch();
  }
});

void test('OllamaEmbedder.embed returns the embedding vector from /api/embeddings', async () => {
  installFetch((async () => new Response(JSON.stringify({ 'embedding': [0.1, 0.2, 0.3] }), { 'status': 200 })) as typeof fetch);
  const embedder = new OllamaEmbedder();
  try {
    const vec = await embedder.embed('hello');
    assert.deepEqual(vec, [0.1, 0.2, 0.3]);
  } finally {
    restoreFetch();
  }
});
