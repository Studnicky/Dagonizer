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

void test('GeminiApiEmbedder.embed extracts embedding.values from response body', async () => {
  FetchStub.install(async () => new Response(JSON.stringify({
    'embedding': { 'values': [0.5, 0.25, 0.125] },
  }), { 'status': 200 }));
  const embedder = new GeminiApiEmbedder('k');
  try {
    const vec = await embedder.embed('hello');
    assert.deepEqual(vec, [0.5, 0.25, 0.125]);
  } finally {
    FetchStub.restore();
  }
});

// ── GeminiModelsResponseSchema ───────────────────────────────────────────────

void test('GeminiModelsResponseSchema has the correct $id', () => {
  assert.equal(
    GeminiModelsResponseSchema['$id'],
    'https://noocodec.dev/schemas/dagonizer/gemini/GeminiApiEmbedderModelsResponse',
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
  FetchStub.install(() => Promise.reject(new Error('network failure')));
  const embedder = new GeminiApiEmbedder('k');
  try {
    const models = await embedder.listModels();
    assert.deepEqual(models, []);
  } finally {
    FetchStub.restore();
  }
});

void test('GeminiApiEmbedder.listModels returns [] on non-ok response', async () => {
  FetchStub.install(async () => new Response('Unauthorized', { 'status': 403 }));
  const embedder = new GeminiApiEmbedder('k');
  try {
    const models = await embedder.listModels();
    assert.deepEqual(models, []);
  } finally {
    FetchStub.restore();
  }
});

void test('GeminiApiEmbedder.listModels returns [] when response body fails schema validation', async () => {
  FetchStub.install(async () => new Response(JSON.stringify({ 'notModels': [] }), { 'status': 200 }));
  const embedder = new GeminiApiEmbedder('k');
  try {
    const models = await embedder.listModels();
    assert.deepEqual(models, []);
  } finally {
    FetchStub.restore();
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
  FetchStub.install(async () => new Response(JSON.stringify(body), { 'status': 200 }));
  const embedder = new GeminiApiEmbedder('k');
  try {
    const models = await embedder.listModels();
    assert.equal(models.length, 1);
    assert.equal(models[0]?.variant, 'embedding');
    assert.equal(models[0]?.cloud, true);
  } finally {
    FetchStub.restore();
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
  FetchStub.install(async () => new Response(JSON.stringify(body), { 'status': 200 }));
  const embedder = new GeminiApiEmbedder('k');
  try {
    const models = await embedder.listModels();
    assert.equal(models[0]?.name, 'text-embedding-004');
  } finally {
    FetchStub.restore();
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
  FetchStub.install(async () => new Response(JSON.stringify(body), { 'status': 200 }));
  const embedder = new GeminiApiEmbedder('k');
  try {
    const models = await embedder.listModels();
    assert.equal(models[0]?.variant, 'chat');
  } finally {
    FetchStub.restore();
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
  FetchStub.install(async () => new Response(JSON.stringify(body), { 'status': 200 }));
  const embedder = new GeminiApiEmbedder('k');
  try {
    const models = await embedder.listModels();
    assert.equal(models[0]?.variant, 'unknown');
  } finally {
    FetchStub.restore();
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
  FetchStub.install(async () => new Response(JSON.stringify(body), { 'status': 200 }));
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
    FetchStub.restore();
  }
});

void test('GeminiApiEmbedder.listModels passes name through unchanged when no models/ prefix', async () => {
  const body = {
    'models': [
      { 'name': 'text-embedding-004', 'supportedGenerationMethods': ['embedContent'] },
    ],
  };
  FetchStub.install(async () => new Response(JSON.stringify(body), { 'status': 200 }));
  const embedder = new GeminiApiEmbedder('k');
  try {
    const models = await embedder.listModels();
    assert.equal(models[0]?.name, 'text-embedding-004');
  } finally {
    FetchStub.restore();
  }
});
