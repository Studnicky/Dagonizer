/**
 * Smoke: OllamaEmbedder exposes the expected id, display name, and
 * dimensionality. No network calls; instantiation + fetch-stub only.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { OllamaEmbedder } from '../src/index.js';

void test('OllamaEmbedder identity + default dimensions (nomic-embed-text)', () => {
  const embedder = new OllamaEmbedder({ 'model': 'nomic-embed-text' });
  assert.equal(embedder.id, 'ollama');
  assert.ok(embedder.displayName.toLowerCase().includes('ollama'));
  assert.equal(embedder.dimensions, 768);
});

void test('OllamaEmbedder accepts custom model with known dimensions', () => {
  const embedder = new OllamaEmbedder({ 'model': 'mxbai-embed-large' });
  assert.equal(embedder.dimensions, 1024);
  assert.ok(embedder.displayName.includes('mxbai-embed-large'));
});

void test('OllamaEmbedder accepts explicit dimensions override for unknown model', () => {
  const embedder = new OllamaEmbedder({ 'model': 'exotic-model', 'dimensions': 512 });
  assert.equal(embedder.dimensions, 512);
});

void test('OllamaEmbedder constructed without model uses default dimensions placeholder', () => {
  const embedder = new OllamaEmbedder();
  assert.equal(embedder.dimensions, 768);
  assert.equal(embedder.id, 'ollama');
});

const originalFetch: typeof fetch | undefined = globalThis.fetch;

function installFetch(impl: (input: string | URL | Request, init?: RequestInit) => Promise<Response>): void {
  Object.assign(globalThis, { 'fetch': impl });
}

function restoreFetch(): void {
  Object.assign(globalThis, { 'fetch': originalFetch });
}

void test('OllamaEmbedder.probe returns true when /api/tags answers 200', async () => {
  installFetch(async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    assert.ok(url.endsWith('/api/tags'));
    return new Response('{"models":[]}', { 'status': 200 });
  });
  const embedder = new OllamaEmbedder({ 'model': 'nomic-embed-text', 'baseUrl': 'http://127.0.0.1:11434' });
  try {
    assert.equal(await embedder.probe(), true);
  } finally {
    restoreFetch();
  }
});

void test('OllamaEmbedder.probe returns false on transport failure', async () => {
  installFetch(async () => { throw new Error('ECONNREFUSED'); });
  const embedder = new OllamaEmbedder({ 'model': 'nomic-embed-text' });
  try {
    assert.equal(await embedder.probe(), false);
  } finally {
    restoreFetch();
  }
});

void test('OllamaEmbedder.embed returns the embedding vector from /api/embeddings', async () => {
  installFetch(async () => new Response(JSON.stringify({ 'embedding': [0.1, 0.2, 0.3] }), { 'status': 200 }));
  const embedder = new OllamaEmbedder({ 'model': 'nomic-embed-text' });
  try {
    const vec = await embedder.embed('hello');
    assert.deepEqual(vec, [0.1, 0.2, 0.3]);
  } finally {
    restoreFetch();
  }
});

void test('OllamaEmbedder without apiKey sends no Authorization header', async () => {
  let capturedHeaders: RequestInit['headers'];
  installFetch(async (_input: string | URL | Request, init?: RequestInit) => {
    capturedHeaders = init?.headers;
    return new Response(JSON.stringify({ 'embedding': [0.1, 0.2, 0.3] }), { 'status': 200 });
  });
  const embedder = new OllamaEmbedder({ 'model': 'nomic-embed-text' });
  try {
    await embedder.embed('hello');
    assert.ok(capturedHeaders !== undefined, 'fetch was called');
    assert.ok(
      typeof capturedHeaders === 'object' && !Array.isArray(capturedHeaders) && !(capturedHeaders instanceof Headers) && !Object.prototype.hasOwnProperty.call(capturedHeaders, 'Authorization'),
      'no Authorization header for local usage',
    );
  } finally {
    restoreFetch();
  }
});

void test('OllamaEmbedder with apiKey sends Authorization: Bearer header', async () => {
  let capturedHeaders: RequestInit['headers'];
  installFetch(async (_input: string | URL | Request, init?: RequestInit) => {
    capturedHeaders = init?.headers;
    return new Response(JSON.stringify({ 'embedding': [0.4, 0.5, 0.6] }), { 'status': 200 });
  });
  const embedder = new OllamaEmbedder({ 'apiKey': 'test-cloud-key', 'baseUrl': 'https://api.ollama.ai', 'model': 'nomic-embed-text' });
  try {
    await embedder.embed('hello');
    assert.ok(capturedHeaders !== undefined, 'fetch was called');
    assert.ok(
      typeof capturedHeaders === 'object' && !Array.isArray(capturedHeaders) && !(capturedHeaders instanceof Headers) && capturedHeaders['Authorization'] === 'Bearer test-cloud-key',
      'Authorization header sent for cloud usage',
    );
  } finally {
    restoreFetch();
  }
});

// ── listModels ────────────────────────────────────────────────────────────────

void test('OllamaEmbedder.listModels classifies embedding and chat models correctly', async () => {
  const canned = {
    'models': [
      { 'name': 'nomic-embed-text:latest' },
      { 'name': 'bge-m3:latest' },
      { 'name': 'all-minilm:latest' },
      { 'name': 'gte-large:latest' },
      { 'name': 'llama3.2:3b' },
      { 'name': 'mistral:latest' },
    ],
  };
  installFetch(async () => new Response(JSON.stringify(canned), { 'status': 200 }));
  const embedder = new OllamaEmbedder({ 'model': 'nomic-embed-text' });
  try {
    const models = await embedder.listModels();
    assert.equal(models.length, 6);

    const embeddingModels = models.filter((m) => m.variant === 'embedding');
    const chatModels      = models.filter((m) => m.variant === 'chat');

    assert.equal(embeddingModels.length, 4, 'embed/bge/minilm/gte- → embedding');
    assert.equal(chatModels.length,      2, 'llama/mistral → chat');

    // Verify specific classifications
    assert.ok(embeddingModels.some((m) => m.name === 'nomic-embed-text:latest'));
    assert.ok(embeddingModels.some((m) => m.name === 'bge-m3:latest'));
    assert.ok(embeddingModels.some((m) => m.name === 'all-minilm:latest'));
    assert.ok(embeddingModels.some((m) => m.name === 'gte-large:latest'));
    assert.ok(chatModels.some((m) => m.name === 'llama3.2:3b'));

    // All local daemon models are non-cloud
    assert.ok(models.every((m) => m.cloud === false), 'daemon models are not cloud');
  } finally {
    restoreFetch();
  }
});

void test('OllamaEmbedder.listModels sets cloud=true for :cloud / -cloud suffix', async () => {
  const canned = {
    'models': [
      { 'name': 'nomic-embed-text:cloud' },
      { 'name': 'llama3.2-cloud' },
    ],
  };
  installFetch(async () => new Response(JSON.stringify(canned), { 'status': 200 }));
  const embedder = new OllamaEmbedder({ 'model': 'nomic-embed-text' });
  try {
    const models = await embedder.listModels();
    assert.ok(models.every((m) => m.cloud === true), 'cloud-suffix models are cloud');
  } finally {
    restoreFetch();
  }
});

void test('OllamaEmbedder.listModels returns [] on transport failure', async () => {
  installFetch(async () => { throw new Error('ECONNREFUSED'); });
  const embedder = new OllamaEmbedder({ 'model': 'nomic-embed-text' });
  try {
    const models = await embedder.listModels();
    assert.deepEqual(models, []);
  } finally {
    restoreFetch();
  }
});

void test('OllamaEmbedder.listModels returns [] when response fails schema validation', async () => {
  installFetch(async () => new Response(JSON.stringify({ 'wrong': 'shape' }), { 'status': 200 }));
  const embedder = new OllamaEmbedder({ 'model': 'nomic-embed-text' });
  try {
    const models = await embedder.listModels();
    assert.deepEqual(models, []);
  } finally {
    restoreFetch();
  }
});

void test('OllamaEmbedder.selectEmbeddingModel picks an embedding model and skips chat models', async () => {
  const canned = {
    'models': [
      { 'name': 'llama3.2:3b' },
      { 'name': 'nomic-embed-text:latest' },
    ],
  };
  installFetch(async () => new Response(JSON.stringify(canned), { 'status': 200 }));
  const embedder = new OllamaEmbedder();
  try {
    const selected = await embedder.selectEmbeddingModel();
    assert.equal(selected, 'nomic-embed-text:latest', 'embedding model selected over chat');
  } finally {
    restoreFetch();
  }
});

void test('OllamaEmbedder.selectEmbeddingModel returns null when no embedding models available', async () => {
  const canned = { 'models': [{ 'name': 'llama3.2:3b' }] };
  installFetch(async () => new Response(JSON.stringify(canned), { 'status': 200 }));
  const embedder = new OllamaEmbedder();
  try {
    const selected = await embedder.selectEmbeddingModel();
    assert.equal(selected, null, 'null when no embedding models');
  } finally {
    restoreFetch();
  }
});

void test('OllamaEmbedder.selectEmbeddingModel honors preferred model', async () => {
  const canned = {
    'models': [
      { 'name': 'nomic-embed-text:latest' },
      { 'name': 'mxbai-embed-large:latest' },
    ],
  };
  installFetch(async () => new Response(JSON.stringify(canned), { 'status': 200 }));
  const embedder = new OllamaEmbedder();
  try {
    const selected = await embedder.selectEmbeddingModel({ 'preferred': 'mxbai-embed-large:latest' });
    assert.equal(selected, 'mxbai-embed-large:latest', 'preferred model honored');
  } finally {
    restoreFetch();
  }
});
