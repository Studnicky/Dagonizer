import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { GeminiApiAdapter, GeminiModelsResponseSchema, GeminiModelsResponseValidator } from '../src/index.js';

// ---------------------------------------------------------------------------
// Identity + capabilities
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// GeminiModelsResponseSchema validation
// ---------------------------------------------------------------------------

void test('GeminiModelsResponseSchema validates a canned Gemini models response body', () => {
  const canned = {
    'models': [
      {
        'name': 'models/gemini-2.0-flash',
        'supportedGenerationMethods': ['generateContent'],
      },
    ],
  };
  assert.ok(GeminiModelsResponseValidator.is(canned), 'validator should accept a valid body');
});

void test('GeminiModelsResponseSchema rejects a body missing models', () => {
  assert.equal(GeminiModelsResponseValidator.is({}), false);
  assert.equal(GeminiModelsResponseValidator.is({ 'models': 'not-an-array' }), false);
});

void test('GeminiModelsResponseSchema rejects a model entry missing name', () => {
  const bad = { 'models': [{ 'supportedGenerationMethods': ['generateContent'] }] };
  assert.equal(GeminiModelsResponseValidator.is(bad), false);
});

void test('GeminiModelsResponseSchema carries the expected $id', () => {
  assert.equal(
    GeminiModelsResponseSchema['$id'],
    'https://noocodex.dev/schemas/dagonizer/gemini/GeminiModelsResponse',
  );
});

// ---------------------------------------------------------------------------
// listModels — fetch stubbing helpers
// ---------------------------------------------------------------------------

class FetchStub {
  private constructor() {}

  static install(impl: (input: string | URL | Request, init?: RequestInit) => Promise<Response>): () => void {
    const original: typeof fetch | undefined = globalThis.fetch;
    Object.assign(globalThis, { 'fetch': impl });
    return () => {
      Object.assign(globalThis, { 'fetch': original });
    };
  }
}

// ---------------------------------------------------------------------------
// listModels — rejection path
// ---------------------------------------------------------------------------

void test('listModels returns [] when fetch rejects', async () => {
  const restore = FetchStub.install(() => Promise.reject(new Error('network down')));
  try {
    const adapter = new GeminiApiAdapter('key');
    const result = await adapter.listModels();
    assert.deepEqual(result, []);
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// listModels — canned response mapping
// ---------------------------------------------------------------------------

void test('listModels maps generateContent models to variant chat with name prefix stripped', async () => {
  const cannedBody = {
    'models': [
      {
        'name': 'models/gemini-2.0-flash',
        'supportedGenerationMethods': ['generateContent'],
      },
    ],
  };
  const restore = FetchStub.install(() =>
    Promise.resolve(new Response(JSON.stringify(cannedBody), { 'status': 200 })),
  );
  try {
    const adapter = new GeminiApiAdapter('key');
    const models = await adapter.listModels();
    assert.equal(models.length, 1);
    const first = models[0];
    assert.ok(first !== undefined);
    assert.equal(first.name, 'gemini-2.0-flash');
    assert.equal(first.variant, 'chat');
    assert.equal(first.cloud, true);
  } finally {
    restore();
  }
});

void test('listModels maps embedContent models to variant embedding', async () => {
  const cannedBody = {
    'models': [
      {
        'name': 'models/text-embedding-004',
        'supportedGenerationMethods': ['embedContent'],
      },
    ],
  };
  const restore = FetchStub.install(() =>
    Promise.resolve(new Response(JSON.stringify(cannedBody), { 'status': 200 })),
  );
  try {
    const adapter = new GeminiApiAdapter('key');
    const models = await adapter.listModels();
    assert.equal(models.length, 1);
    const first = models[0];
    assert.ok(first !== undefined);
    assert.equal(first.name, 'text-embedding-004');
    assert.equal(first.variant, 'embedding');
    assert.equal(first.cloud, true);
  } finally {
    restore();
  }
});

void test('listModels maps models with no recognised methods to variant unknown', async () => {
  const cannedBody = {
    'models': [
      {
        'name': 'models/some-experimental-model',
        'supportedGenerationMethods': ['someOtherMethod'],
      },
    ],
  };
  const restore = FetchStub.install(() =>
    Promise.resolve(new Response(JSON.stringify(cannedBody), { 'status': 200 })),
  );
  try {
    const adapter = new GeminiApiAdapter('key');
    const models = await adapter.listModels();
    assert.equal(models.length, 1);
    const first = models[0];
    assert.ok(first !== undefined);
    assert.equal(first.variant, 'unknown');
  } finally {
    restore();
  }
});

void test('listModels strips models/ prefix only when present', async () => {
  const cannedBody = {
    'models': [
      { 'name': 'already-bare', 'supportedGenerationMethods': ['generateContent'] },
      { 'name': 'models/prefixed-model', 'supportedGenerationMethods': ['generateContent'] },
    ],
  };
  const restore = FetchStub.install(() =>
    Promise.resolve(new Response(JSON.stringify(cannedBody), { 'status': 200 })),
  );
  try {
    const adapter = new GeminiApiAdapter('key');
    const models = await adapter.listModels();
    assert.equal(models.length, 2);
    const first = models[0];
    const second = models[1];
    assert.ok(first !== undefined);
    assert.ok(second !== undefined);
    assert.equal(first.name, 'already-bare');
    assert.equal(second.name, 'prefixed-model');
  } finally {
    restore();
  }
});

void test('listModels returns [] when fetch returns non-ok status', async () => {
  const restore = FetchStub.install(() =>
    Promise.resolve(new Response('Forbidden', { 'status': 403 })),
  );
  try {
    const adapter = new GeminiApiAdapter('bad-key');
    const models = await adapter.listModels();
    assert.deepEqual(models, []);
  } finally {
    restore();
  }
});

void test('listModels returns [] when response body fails schema validation', async () => {
  const restore = FetchStub.install(() =>
    Promise.resolve(new Response(JSON.stringify({ 'notModels': [] }), { 'status': 200 })),
  );
  try {
    const adapter = new GeminiApiAdapter('key');
    const models = await adapter.listModels();
    assert.deepEqual(models, []);
  } finally {
    restore();
  }
});
