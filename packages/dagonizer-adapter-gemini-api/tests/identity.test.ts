import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { ChatRequestBuilder, Classifications, LlmError } from '@studnicky/dagonizer/adapter';

import { GeminiApiAdapter, GeminiModelsResponseSchema, GeminiModelsResponseValidator } from '../src/index.js';

// ---------------------------------------------------------------------------
// Helpers shared by the performChat wire-shape tests
// ---------------------------------------------------------------------------

/** Minimal valid Gemini generateContent response body. */
const CANNED_GENERATE_RESPONSE = {
  'candidates': [
    {
      'content': { 'parts': [{ 'text': 'ok' }] },
      'finishReason': 'STOP',
    },
  ],
} as const;

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

// ---------------------------------------------------------------------------
// performChat wire-shape: maxTokens, systemPrompt, timeout
// ---------------------------------------------------------------------------

void test('performChat posts maxTokens as generationConfig.maxOutputTokens (not top-level max_tokens)', async () => {
  let capturedBody: Record<string, unknown> | undefined;
  const restore = FetchStub.install((_input, init) => {
    capturedBody = JSON.parse(init?.body as string) as Record<string, unknown>;
    return Promise.resolve(new Response(JSON.stringify(CANNED_GENERATE_RESPONSE), { 'status': 200 }));
  });
  try {
    const adapter = new GeminiApiAdapter('key', { 'model': 'gemini-2.0-flash', 'maxAttempts': 1 });
    const request = ChatRequestBuilder.from({
      'messages': [{ 'role': 'user', 'content': 'hi' }],
      'maxTokens': 256,
    });
    await adapter.chat(request);
    assert.ok(capturedBody !== undefined, 'fetch was called');
    const generationConfig = capturedBody['generationConfig'] as Record<string, unknown>;
    assert.equal(generationConfig['maxOutputTokens'], 256, 'maxTokens maps to generationConfig.maxOutputTokens');
    assert.ok(!('max_tokens' in capturedBody), 'no top-level max_tokens field');
  } finally {
    restore();
  }
});

void test('performChat injects configured systemPrompt as leading system content when request has no system message', async () => {
  let capturedBody: Record<string, unknown> | undefined;
  const restore = FetchStub.install((_input, init) => {
    capturedBody = JSON.parse(init?.body as string) as Record<string, unknown>;
    return Promise.resolve(new Response(JSON.stringify(CANNED_GENERATE_RESPONSE), { 'status': 200 }));
  });
  try {
    const adapter = new GeminiApiAdapter('key', {
      'model': 'gemini-2.0-flash',
      'maxAttempts': 1,
      'systemPrompt': 'You are X.',
    });
    const request = ChatRequestBuilder.from({
      'messages': [{ 'role': 'user', 'content': 'hello' }],
    });
    await adapter.chat(request);
    assert.ok(capturedBody !== undefined, 'fetch was called');
    const contents = capturedBody['contents'] as Array<Record<string, unknown>>;
    const first = contents[0];
    assert.ok(first !== undefined, 'contents is non-empty');
    assert.equal(first['role'], 'system', 'leading content has role system');
    const parts = first['parts'] as Array<Record<string, unknown>>;
    assert.ok(parts !== undefined && parts.length > 0, 'system content has parts');
    assert.equal(parts[0]?.['text'], 'You are X.', 'system part text matches configured systemPrompt');
  } finally {
    restore();
  }
});

void test('performChat does not inject default systemPrompt when request already carries a system message', async () => {
  let capturedBody: Record<string, unknown> | undefined;
  const restore = FetchStub.install((_input, init) => {
    capturedBody = JSON.parse(init?.body as string) as Record<string, unknown>;
    return Promise.resolve(new Response(JSON.stringify(CANNED_GENERATE_RESPONSE), { 'status': 200 }));
  });
  try {
    const adapter = new GeminiApiAdapter('key', {
      'model': 'gemini-2.0-flash',
      'maxAttempts': 1,
      'systemPrompt': 'You are X.',
    });
    const request = ChatRequestBuilder.from({
      'messages': [
        { 'role': 'system', 'content': 'You are Y.' },
        { 'role': 'user', 'content': 'hello' },
      ],
    });
    await adapter.chat(request);
    assert.ok(capturedBody !== undefined, 'fetch was called');
    const contents = capturedBody['contents'] as Array<Record<string, unknown>>;
    const systemContents = contents.filter((c) => c['role'] === 'system');
    assert.equal(systemContents.length, 1, 'exactly one system content — no double-injection');
    const parts = systemContents[0]?.['parts'] as Array<Record<string, unknown>>;
    assert.equal(parts?.[0]?.['text'], 'You are Y.', 'consumer system message is preserved unchanged');
  } finally {
    restore();
  }
});

void test('performChat rejects with LlmError on timeout (hanging fetch that honors abort signal)', async () => {
  // The abort reason is LlmError(TIMEOUT); the catch block preserves an
  // already-classified LlmError, so the surfaced classification is TIMEOUT.
  const restore = FetchStub.install((_input, init) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        reject(init.signal?.reason as Error);
      });
    }),
  );
  try {
    const adapter = new GeminiApiAdapter('key', {
      'model': 'gemini-2.0-flash',
      'maxAttempts': 1,
      'timeoutMs': 1,
    });
    const request = ChatRequestBuilder.from({
      'messages': [{ 'role': 'user', 'content': 'hi' }],
    });
    await assert.rejects(
      () => adapter.chat(request),
      (err: unknown) => {
        assert.ok(err instanceof LlmError, `expected LlmError, got ${String(err)}`);
        // The adapter aborts with Classifications['TIMEOUT']; the catch block
        // re-throws the already-classified LlmError unchanged, so the surfaced
        // classification is TIMEOUT (a cascade falls through instead of hanging).
        assert.equal(
          err.classification.reason,
          Classifications['TIMEOUT'].reason,
          'timed-out request surfaces as TIMEOUT (classified abort reason preserved)',
        );
        return true;
      },
    );
  } finally {
    restore();
  }
});
