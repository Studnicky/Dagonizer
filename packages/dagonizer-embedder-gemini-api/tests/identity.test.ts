/**
 * Smoke: GeminiApiEmbedder identity + probe behaviour.
 * No real network calls; instantiation + fetch-stub only.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { GeminiApiEmbedder, GeminiModelsResponseSchema, GeminiModelsResponseValidator } from '../src/index.js';

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

const originalFetch: typeof fetch | undefined = globalThis.fetch;

function installFetch(impl: (input: string | URL | Request, init?: RequestInit) => Promise<Response>): void {
  Object.assign(globalThis, { 'fetch': impl });
}

function restoreFetch(): void {
  Object.assign(globalThis, { 'fetch': originalFetch });
}

void test('GeminiApiEmbedder.embed extracts embedding.values from response body', async () => {
  installFetch(async () => new Response(JSON.stringify({
    'embedding': { 'values': [0.5, 0.25, 0.125] },
  }), { 'status': 200 }));
  const embedder = new GeminiApiEmbedder('k');
  try {
    const vec = await embedder.embed('hello');
    assert.deepEqual(vec, [0.5, 0.25, 0.125]);
  } finally {
    restoreFetch();
  }
});

// ── GeminiModelsResponseSchema ───────────────────────────────────────────────

void test('GeminiModelsResponseSchema has the correct $id', () => {
  assert.equal(
    GeminiModelsResponseSchema['$id'],
    'https://noocodex.dev/schemas/dagonizer/gemini/GeminiApiEmbedderModelsResponse',
  );
});

void test('GeminiModelsResponseValidator accepts a canned models response body', () => {
  const body = {
    'models': [
      {
        'name': 'models/text-embedding-004',
        'supportedGenerationMethods': ['embedContent'],
      },
      {
        'name': 'models/gemini-1.5-pro',
        'supportedGenerationMethods': ['generateContent'],
      },
    ],
  };
  assert.ok(GeminiModelsResponseValidator.is(body), 'validator should accept valid models response');
});

void test('GeminiModelsResponseValidator rejects body missing models array', () => {
  assert.equal(GeminiModelsResponseValidator.is({ 'other': true }), false);
});

void test('GeminiModelsResponseValidator rejects model entry missing name', () => {
  const body = { 'models': [{ 'supportedGenerationMethods': ['embedContent'] }] };
  assert.equal(GeminiModelsResponseValidator.is(body), false);
});

// ── GeminiApiEmbedder.listModels ─────────────────────────────────────────────

void test('GeminiApiEmbedder.listModels returns [] when fetch rejects', async () => {
  installFetch(() => Promise.reject(new Error('network failure')));
  const embedder = new GeminiApiEmbedder('k');
  try {
    const models = await embedder.listModels();
    assert.deepEqual(models, []);
  } finally {
    restoreFetch();
  }
});

void test('GeminiApiEmbedder.listModels returns [] on non-ok response', async () => {
  installFetch(async () => new Response('Unauthorized', { 'status': 403 }));
  const embedder = new GeminiApiEmbedder('k');
  try {
    const models = await embedder.listModels();
    assert.deepEqual(models, []);
  } finally {
    restoreFetch();
  }
});

void test('GeminiApiEmbedder.listModels returns [] when response body fails schema validation', async () => {
  installFetch(async () => new Response(JSON.stringify({ 'notModels': [] }), { 'status': 200 }));
  const embedder = new GeminiApiEmbedder('k');
  try {
    const models = await embedder.listModels();
    assert.deepEqual(models, []);
  } finally {
    restoreFetch();
  }
});

void test('GeminiApiEmbedder.listModels returns embedding models with variant embedding', async () => {
  const body = {
    'models': [
      {
        'name': 'models/text-embedding-004',
        'supportedGenerationMethods': ['embedContent'],
      },
    ],
  };
  installFetch(async () => new Response(JSON.stringify(body), { 'status': 200 }));
  const embedder = new GeminiApiEmbedder('k');
  try {
    const models = await embedder.listModels();
    assert.equal(models.length, 1);
    assert.equal(models[0]?.variant, 'embedding');
    assert.equal(models[0]?.cloud, true);
  } finally {
    restoreFetch();
  }
});

void test('GeminiApiEmbedder.listModels strips models/ prefix from name', async () => {
  const body = {
    'models': [
      {
        'name': 'models/text-embedding-004',
        'supportedGenerationMethods': ['embedContent'],
      },
    ],
  };
  installFetch(async () => new Response(JSON.stringify(body), { 'status': 200 }));
  const embedder = new GeminiApiEmbedder('k');
  try {
    const models = await embedder.listModels();
    assert.equal(models[0]?.name, 'text-embedding-004');
  } finally {
    restoreFetch();
  }
});

void test('GeminiApiEmbedder.listModels assigns variant chat for generateContent models', async () => {
  const body = {
    'models': [
      {
        'name': 'models/gemini-1.5-pro',
        'supportedGenerationMethods': ['generateContent'],
      },
    ],
  };
  installFetch(async () => new Response(JSON.stringify(body), { 'status': 200 }));
  const embedder = new GeminiApiEmbedder('k');
  try {
    const models = await embedder.listModels();
    assert.equal(models[0]?.variant, 'chat');
  } finally {
    restoreFetch();
  }
});

void test('GeminiApiEmbedder.listModels assigns variant unknown when no generation methods', async () => {
  const body = {
    'models': [
      {
        'name': 'models/some-other-model',
        'supportedGenerationMethods': [],
      },
    ],
  };
  installFetch(async () => new Response(JSON.stringify(body), { 'status': 200 }));
  const embedder = new GeminiApiEmbedder('k');
  try {
    const models = await embedder.listModels();
    assert.equal(models[0]?.variant, 'unknown');
  } finally {
    restoreFetch();
  }
});

void test('GeminiApiEmbedder.listModels handles mixed model types in one response', async () => {
  const body = {
    'models': [
      { 'name': 'models/text-embedding-004', 'supportedGenerationMethods': ['embedContent'] },
      { 'name': 'models/gemini-1.5-pro', 'supportedGenerationMethods': ['generateContent'] },
      { 'name': 'models/mystery', 'supportedGenerationMethods': [] },
    ],
  };
  installFetch(async () => new Response(JSON.stringify(body), { 'status': 200 }));
  const embedder = new GeminiApiEmbedder('k');
  try {
    const models = await embedder.listModels();
    assert.equal(models.length, 3);
    assert.equal(models[0]?.name, 'text-embedding-004');
    assert.equal(models[0]?.variant, 'embedding');
    assert.equal(models[1]?.name, 'gemini-1.5-pro');
    assert.equal(models[1]?.variant, 'chat');
    assert.equal(models[2]?.name, 'mystery');
    assert.equal(models[2]?.variant, 'unknown');
  } finally {
    restoreFetch();
  }
});

void test('GeminiApiEmbedder.listModels passes name through unchanged when no models/ prefix', async () => {
  const body = {
    'models': [
      { 'name': 'text-embedding-004', 'supportedGenerationMethods': ['embedContent'] },
    ],
  };
  installFetch(async () => new Response(JSON.stringify(body), { 'status': 200 }));
  const embedder = new GeminiApiEmbedder('k');
  try {
    const models = await embedder.listModels();
    assert.equal(models[0]?.name, 'text-embedding-004');
  } finally {
    restoreFetch();
  }
});
