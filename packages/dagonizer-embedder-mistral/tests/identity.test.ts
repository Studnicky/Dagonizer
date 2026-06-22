/**
 * Smoke: MistralEmbedder identity + probe behaviour.
 * No real network calls; instantiation + fetch-stub only.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

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

class FetchStub {
  private constructor() {}
  private static readonly original: typeof fetch | undefined = globalThis.fetch;

  static install(impl: (input: string | URL | Request, init?: RequestInit) => Promise<Response>): void {
    Object.assign(globalThis, { 'fetch': impl });
  }

  static restore(): void {
    Object.assign(globalThis, { 'fetch': FetchStub.original });
  }
}

void test('MistralEmbedder.embed extracts data[0].embedding from response body', async () => {
  FetchStub.install(async () => new Response(JSON.stringify({
    'data': [{ 'embedding': [0.9, 0.8, 0.7] }],
  }), { 'status': 200 }));
  const embedder = new MistralEmbedder('k');
  try {
    const vec = await embedder.embed('hello');
    assert.deepEqual(vec, [0.9, 0.8, 0.7]);
  } finally {
    FetchStub.restore();
  }
});

// ── listModels ────────────────────────────────────────────────────────────────

void test('MistralEmbedder.listModels classifies embedding and chat models correctly', async () => {
  const canned = {
    'data': [
      { 'id': 'mistral-embed' },
      { 'id': 'codestral-embed' },
      { 'id': 'mistral-small-latest' },
      { 'id': 'mixtral-8x7b-instruct-v0.1' },
    ],
  };
  FetchStub.install(async () => new Response(JSON.stringify(canned), { 'status': 200 }));
  const embedder = new MistralEmbedder('test-key');
  try {
    const models = await embedder.listModels();
    assert.equal(models.length, 4);

    const embeddingModels = models.filter((m) => m.variant === 'embedding');
    const chatModels      = models.filter((m) => m.variant === 'chat');

    assert.equal(embeddingModels.length, 2, 'embed-containing ids → embedding');
    assert.equal(chatModels.length,      2, 'non-embed ids → chat');

    assert.ok(embeddingModels.some((m) => m.name === 'mistral-embed'));
    assert.ok(embeddingModels.some((m) => m.name === 'codestral-embed'));
    assert.ok(chatModels.some((m) => m.name === 'mistral-small-latest'));

    // All Mistral platform models are cloud
    assert.ok(models.every((m) => m.cloud === true), 'Mistral platform models are cloud');
  } finally {
    FetchStub.restore();
  }
});

void test('MistralEmbedder.listModels returns [] when apiKey is empty', async () => {
  FetchStub.install(async () => new Response('{}', { 'status': 200 }));
  const embedder = new MistralEmbedder('');
  try {
    const models = await embedder.listModels();
    assert.deepEqual(models, [], 'no key → no fetch → empty list');
  } finally {
    FetchStub.restore();
  }
});

void test('MistralEmbedder.listModels returns [] on transport failure', async () => {
  FetchStub.install(async () => { throw new Error('fetch failed'); });
  const embedder = new MistralEmbedder('test-key');
  try {
    const models = await embedder.listModels();
    assert.deepEqual(models, []);
  } finally {
    FetchStub.restore();
  }
});

void test('MistralEmbedder.listModels returns [] when response fails schema validation', async () => {
  FetchStub.install(async () => new Response(JSON.stringify({ 'wrong': 'shape' }), { 'status': 200 }));
  const embedder = new MistralEmbedder('test-key');
  try {
    const models = await embedder.listModels();
    assert.deepEqual(models, []);
  } finally {
    FetchStub.restore();
  }
});

void test('MistralEmbedder.listModels sends Authorization: Bearer header', async () => {
  let capturedHeaders: RequestInit['headers'];
  FetchStub.install(async (_input: string | URL | Request, init?: RequestInit) => {
    capturedHeaders = init?.headers;
    return new Response(JSON.stringify({ 'data': [] }), { 'status': 200 });
  });
  const embedder = new MistralEmbedder('my-api-key');
  try {
    await embedder.listModels();
    assert.ok(capturedHeaders !== undefined, 'fetch was called');
    assert.ok(
      typeof capturedHeaders === 'object' && !Array.isArray(capturedHeaders) && !(capturedHeaders instanceof Headers) && capturedHeaders['Authorization'] === 'Bearer my-api-key',
      'Authorization header sent',
    );
  } finally {
    FetchStub.restore();
  }
});

void test('MistralEmbedder.selectEmbeddingModel picks an embedding model and skips chat models', async () => {
  const canned = {
    'data': [
      { 'id': 'mistral-small-latest' },
      { 'id': 'mistral-embed' },
    ],
  };
  FetchStub.install(async () => new Response(JSON.stringify(canned), { 'status': 200 }));
  const embedder = new MistralEmbedder('test-key', {});
  try {
    const selected = await embedder.selectEmbeddingModel();
    assert.equal(selected, 'mistral-embed', 'embedding model selected over chat');
  } finally {
    FetchStub.restore();
  }
});

void test('MistralEmbedder.selectEmbeddingModel returns null when no embedding models found', async () => {
  const canned = { 'data': [{ 'id': 'mistral-small-latest' }] };
  FetchStub.install(async () => new Response(JSON.stringify(canned), { 'status': 200 }));
  const embedder = new MistralEmbedder('test-key', {});
  try {
    const selected = await embedder.selectEmbeddingModel();
    assert.equal(selected, null, 'null when no embedding models');
  } finally {
    FetchStub.restore();
  }
});

void test('MistralEmbedder.selectEmbeddingModel honors preferred model', async () => {
  const canned = {
    'data': [
      { 'id': 'mistral-embed' },
      { 'id': 'codestral-embed' },
    ],
  };
  FetchStub.install(async () => new Response(JSON.stringify(canned), { 'status': 200 }));
  const embedder = new MistralEmbedder('test-key', {});
  try {
    const selected = await embedder.selectEmbeddingModel({ 'preferred': 'codestral-embed' });
    assert.equal(selected, 'codestral-embed', 'preferred model honored');
  } finally {
    FetchStub.restore();
  }
});
