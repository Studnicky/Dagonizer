import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { ChatRequestBuilder, Classifications, LlmError } from '@studnicky/dagonizer/adapter';

import { WebLlmAdapter } from '../src/index.js';
import type { WebLlmEngineType, WebLlmStreamingParamsType } from '../src/index.js';

class NavigatorStub {
  private constructor() {}

  static install(nav: unknown): void {
    Object.assign(globalThis, { 'navigator': nav });
  }

  static remove(): void {
    Reflect.deleteProperty(globalThis, 'navigator');
  }
}

/**
 * Recorded parameters from a single `chat.completions.create` call.
 * Mirrors `WebLlmStreamingParamsType` so the test can assert exact
 * forwarding without any `as` casts.
 */
type CreateCallRecord = {
  readonly 'stream': boolean;
  readonly 'messages': WebLlmStreamingParamsType['messages'];
  readonly 'temperature': number | undefined;
  readonly 'max_tokens': number | undefined;
  readonly 'response_format': WebLlmStreamingParamsType['response_format'];
};

/**
 * Minimal structural stub that satisfies `WebLlmEngineType`.
 *
 * The streaming `create` returns an async generator that either:
 *  - yields chunks from `chunks` then returns, or
 *  - hangs until `interruptGenerate()` is called (when `chunks` is empty).
 *
 * This is the engine-stub pattern for testing `performChat` without WebGPU.
 * No `as` cast anywhere — the type is structurally verified at the
 * `TestAdapter.loadEngine()` return site.
 */
class EngineStub {
  readonly 'interruptGenerate': () => void;
  readonly 'chat': WebLlmEngineType['chat'];

  #interruptCalled = 0;
  #interruptResolve: (() => void) | undefined;
  readonly 'createCalls': CreateCallRecord[] = [];

  constructor(chunks: ReadonlyArray<string>) {
    const stub = this;

    async function* streamGen(): AsyncGenerator<{ 'choices': Array<{ 'delta': { 'content': string } }> }> {
      if (chunks.length === 0) {
        await new Promise<void>((resolve) => { stub.#interruptResolve = resolve; });
        return;
      }
      for (const chunk of chunks) {
        yield { 'choices': [{ 'delta': { 'content': chunk } }] };
      }
    }

    this['interruptGenerate'] = (): void => {
      stub.#interruptCalled++;
      if (stub.#interruptResolve !== undefined) {
        stub.#interruptResolve();
      }
    };

    this['chat'] = {
      'completions': {
        'create': (params: WebLlmStreamingParamsType): Promise<AsyncIterable<{ 'choices': ReadonlyArray<{ 'delta': { 'content'?: string } }> }>> => {
          stub.createCalls.push({
            'stream':          params['stream'],
            'messages':        params['messages'],
            'temperature':     params['temperature'],
            'max_tokens':      params['max_tokens'],
            'response_format': params['response_format'],
          });
          return Promise.resolve(streamGen());
        },
      },
    };
  }

  get interruptCallCount(): number {
    return this.#interruptCalled;
  }
}

/**
 * A `WebLlmAdapter` subclass that bypasses the real CDN boot and supplies
 * a stub engine. This is the "class extension is the only extension
 * mechanism" pattern mandated by the project standards.
 */
class TestAdapter extends WebLlmAdapter {
  readonly #stub: EngineStub;

  constructor(stub: EngineStub, options: ConstructorParameters<typeof WebLlmAdapter>[0] = {}) {
    super(options);
    this.#stub = stub;
  }

  protected override loadEngine(): Promise<WebLlmEngineType> {
    return Promise.resolve(this.#stub);
  }
}

// ---------------------------------------------------------------------------
// Existing identity / catalog / probe tests (unchanged)
// ---------------------------------------------------------------------------

void test('WebLlmAdapter identity', () => {
  const a = new WebLlmAdapter();
  assert.equal(a.id, 'web-llm');
  assert.equal(a.capabilities.toolUse, 'partial');
});

void test('WebLlmAdapter.listModels returns static prebuilt catalog with correct shape', async () => {
  const a = new WebLlmAdapter();
  const models = await a.listModels();
  assert.ok(models.length > 0, 'catalog must be non-empty');
  for (const m of models) {
    assert.equal(m.variant, 'chat', `expected variant 'chat' for ${m.name}`);
    assert.equal(m.cloud, false, `expected cloud false for ${m.name}`);
    assert.ok(m.name.length > 0, 'name must be non-empty');
  }
});

void test('WebLlmAdapter.listModels includes the default Phi-3.5 model', async () => {
  const a = new WebLlmAdapter();
  const models = await a.listModels();
  const found = models.some((m) => m.name === 'Phi-3.5-mini-instruct-q4f16_1-MLC');
  assert.ok(found, 'default model must appear in the catalog');
});

void test('WebLlmAdapter.selectChatModel picks a preferred model by name', async () => {
  const a = new WebLlmAdapter();
  const picked = await a.selectChatModel({ 'preferred': 'Llama-3.2-1B-Instruct-q4f16_1-MLC' });
  assert.equal(picked, 'Llama-3.2-1B-Instruct-q4f16_1-MLC');
});

void test('WebLlmAdapter.selectChatModel falls back to first catalog entry when preferred is absent', async () => {
  const a = new WebLlmAdapter();
  const models = await a.listModels();
  const picked = await a.selectChatModel();
  assert.ok(picked !== null, 'selectChatModel must return a model name');
  assert.ok(
    models.some((m) => m.name === picked),
    'selected model must be in the catalog',
  );
});

void test('WebLlmAdapter.probe returns false in node (no navigator)', async () => {
  const a = new WebLlmAdapter();
  assert.equal(await a.probe(), false);
});

void test('WebLlmAdapter.probe returns false when navigator is absent', async () => {
  NavigatorStub.remove();
  const a = new WebLlmAdapter();
  assert.equal(await a.probe(), false);
});

void test('WebLlmAdapter.probe returns false when navigator.gpu is missing', async () => {
  NavigatorStub.install({});
  const a = new WebLlmAdapter();
  try {
    assert.equal(await a.probe(), false);
  } finally {
    NavigatorStub.remove();
  }
});

void test('WebLlmAdapter.probe returns true when requestAdapter resolves to a non-null adapter', async () => {
  NavigatorStub.install({
    "gpu": { "requestAdapter": async () => Promise.resolve({}) },
  });
  const a = new WebLlmAdapter();
  try {
    assert.equal(await a.probe(), true);
  } finally {
    NavigatorStub.remove();
  }
});

void test('WebLlmAdapter.probe returns false when requestAdapter resolves to null (no hardware)', async () => {
  NavigatorStub.install({
    "gpu": { "requestAdapter": async () => Promise.resolve(null) },
  });
  const a = new WebLlmAdapter();
  try {
    assert.equal(await a.probe(), false);
  } finally {
    NavigatorStub.remove();
  }
});

void test('WebLlmAdapter.probe does not throw when requestAdapter rejects', async () => {
  NavigatorStub.install({
    "gpu": { "requestAdapter": async () => Promise.reject(new Error('driver fail')) },
  });
  const a = new WebLlmAdapter();
  try {
    assert.equal(await a.probe(), false);
  } finally {
    NavigatorStub.remove();
  }
});

void test('composeMessages folds the schema coercion into one leading system message', () => {
  // The MLC engine rejects a `{ role: 'system' }` entry at any index but 0.
  // A schema request must NOT append a trailing system message — the coercion
  // instruction folds into the single index-0 system turn.
  const messages = WebLlmAdapter.composeMessages(ChatRequestBuilder.from({
    'messages':     [{ 'role': 'user', 'content': 'Recommend a novel.' }],
    'outputSchema': { 'variant': 'schema', 'id': 'rec', 'schema': { 'type': 'object' } },
  }));
  assert.equal(messages.length, 2);
  assert.equal(messages[0]?.role, 'system');
  assert.match(messages[0]?.content ?? '', /JSON Schema/u);
  assert.deepEqual(messages[1], { 'role': 'user', 'content': 'Recommend a novel.' });
  // Exactly one system message, and it leads.
  assert.equal(messages.filter((m) => m.role === 'system').length, 1);
});

void test('composeMessages folds caller system turns and tool coercion into one leading system message', () => {
  const messages = WebLlmAdapter.composeMessages(ChatRequestBuilder.from({
    'messages': [
      { 'role': 'system', 'content': 'You are the Archivist.' },
      { 'role': 'user',   'content': 'Find a book.' },
    ],
    'tools': [{ 'name': 'search', 'description': 'search', 'inputSchema': { 'type': 'object' } }],
  }));
  const systemMessages = messages.filter((m) => m.role === 'system');
  assert.equal(systemMessages.length, 1);
  assert.equal(messages[0]?.role, 'system');
  assert.match(messages[0]?.content ?? '', /You are the Archivist\./u);
  assert.match(messages[0]?.content ?? '', /tool_calls/u);
  assert.deepEqual(messages[1], { 'role': 'user', 'content': 'Find a book.' });
});

void test('composeMessages emits no system message when none is needed', () => {
  const messages = WebLlmAdapter.composeMessages(ChatRequestBuilder.from({
    'messages': [{ 'role': 'user', 'content': 'Hello.' }],
  }));
  assert.deepEqual(messages, [{ 'role': 'user', 'content': 'Hello.' }]);
});

void test('WebLlmAdapter accepts timeoutMs option without error', () => {
  const a = new WebLlmAdapter({ 'timeoutMs': 5_000 });
  assert.equal(a.id, 'web-llm');
});

void test('WebLlmAdapter default construction (no timeoutMs) still has correct identity', () => {
  const a = new WebLlmAdapter({});
  assert.equal(a.id, 'web-llm');
});

// ---------------------------------------------------------------------------
// New streaming / cancellation / max_tokens tests
// ---------------------------------------------------------------------------

void test('max_tokens forwarding: create is called with max_tokens from the request', async () => {
  const stub = new EngineStub(['Hello']);
  const adapter = new TestAdapter(stub);
  const request = ChatRequestBuilder.from({
    'messages':  [{ 'role': 'user', 'content': 'Hi' }],
    'maxTokens': 256,
  });

  await adapter.chat(request);

  assert.equal(stub.createCalls.length, 1, 'create must be called exactly once');
  assert.equal(stub.createCalls[0]?.['max_tokens'], 256, 'max_tokens must equal request.maxTokens');
});

void test('streaming accumulation: chunks are concatenated into the text response', async () => {
  const stub = new EngineStub(['Hel', 'lo']);
  const adapter = new TestAdapter(stub);
  const request = ChatRequestBuilder.from({
    'messages': [{ 'role': 'user', 'content': 'Say hello.' }],
  });

  const response = await adapter.chat(request);

  assert.equal(response.message.variant, 'text', 'response variant must be text');
  assert.equal(response.message.content, 'Hello', 'accumulated chunks must equal Hello');
});

void test('interrupt on timeout: rejects with TIMEOUT LlmError and calls interruptGenerate', async () => {
  // Stub with no chunks — the stream hangs until interruptGenerate() is called.
  const stub = new EngineStub([]);
  const adapter = new TestAdapter(stub, { 'timeoutMs': 1 });
  const request = ChatRequestBuilder.from({
    'messages': [{ 'role': 'user', 'content': 'Slow response.' }],
  });

  await assert.rejects(
    async () => adapter.chat(request),
    (err: unknown) => {
      assert.ok(err instanceof LlmError, 'must reject with LlmError');
      assert.equal(err.classification, Classifications['TIMEOUT'], 'classification must be TIMEOUT');
      return true;
    },
  );

  assert.ok(stub.interruptCallCount > 0, 'interruptGenerate must have been called on timeout');
});

void test('interrupt on external abort: interruptGenerate is called and call rejects', async () => {
  // Stub with no chunks — hangs until interrupted.
  const stub = new EngineStub([]);
  const adapter = new TestAdapter(stub, { 'timeoutMs': 60_000 });
  const controller = new AbortController();
  const request = ChatRequestBuilder.from({
    'messages': [{ 'role': 'user', 'content': 'Abort this.' }],
    'signal':   controller.signal,
  });

  // Abort after a small delay so the `for await` loop has time to enter the
  // generator and register the abort listener before the signal fires.
  const abortTimer = setTimeout(() => {
    controller.abort(new LlmError('caller cancelled', Classifications['TIMEOUT']));
  }, 10);

  try {
    await assert.rejects(
      async () => adapter.chat(request),
      (err: unknown) => {
        assert.ok(err instanceof LlmError, 'must reject with LlmError');
        assert.equal(err.classification, Classifications['TIMEOUT'], 'classification must be TIMEOUT');
        return true;
      },
    );
  } finally {
    clearTimeout(abortTimer);
  }

  assert.ok(stub.interruptCallCount > 0, 'interruptGenerate must have been called on external abort');
});
