import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { ChatRequestBuilder, Classifications, LlmError } from '@studnicky/dagonizer/adapter';

import { GeminiNanoAdapter } from '../src/index.js';

class LanguageModelStub {
  private constructor() {}

  static install(stub: unknown): void {
    Object.assign(globalThis, { 'LanguageModel': stub });
  }

  static remove(): void {
    Reflect.deleteProperty(globalThis, 'LanguageModel');
  }
}

void test('GeminiNanoAdapter identity', () => {
  const a = new GeminiNanoAdapter();
  assert.equal(a.id, 'gemini-nano');
  assert.equal(a.capabilities.toolUse, 'partial');
});

void test('GeminiNanoAdapter.detect returns unavailable in node', async () => {
  const status = await GeminiNanoAdapter.detect();
  assert.equal(status, 'unavailable');
});

void test('GeminiNanoAdapter.probe returns false when window.LanguageModel is absent', async () => {
  LanguageModelStub.remove();
  const a = new GeminiNanoAdapter();
  assert.equal(await a.probe(), false);
});

void test('GeminiNanoAdapter.probe returns true when availability() reports "available"', async () => {
  LanguageModelStub.install({
    "availability": async () => Promise.resolve('available'),
    "create": async () => Promise.resolve({ "prompt": async () => Promise.resolve(''), "destroy": () => {} }),
  });
  const a = new GeminiNanoAdapter();
  try {
    assert.equal(await a.probe(), true);
  } finally {
    LanguageModelStub.remove();
  }
});

void test('GeminiNanoAdapter.probe returns true when the host is a callable function (real Chrome shape)', async () => {
  // Chrome exposes `globalThis.LanguageModel` as a CONSTRUCTOR FUNCTION that
  // carries static `availability`/`create` — not a plain object. A JSON-Schema
  // `type: 'object'` validator rejects a function, so the structural host guard
  // must accept the callable shape. Without this, the on-device adapter is
  // skipped in every real browser and the cascade falls through to web-llm.
  const callableHost = Object.assign(
    function LanguageModelCtor(): void { /* host constructor */ },
    {
      'availability': async () => Promise.resolve('available'),
      'create':       async () => Promise.resolve({ 'prompt': async () => Promise.resolve(''), 'destroy': () => {} }),
    },
  );
  LanguageModelStub.install(callableHost);
  const a = new GeminiNanoAdapter();
  try {
    assert.equal(await a.probe(), true);
  } finally {
    LanguageModelStub.remove();
  }
});

void test('GeminiNanoAdapter.probe returns false when availability() reports "downloadable"', async () => {
  LanguageModelStub.install({
    "availability": async () => Promise.resolve('downloadable'),
    "create": async () => Promise.resolve({ "prompt": async () => Promise.resolve(''), "destroy": () => {} }),
  });
  const a = new GeminiNanoAdapter();
  try {
    assert.equal(await a.probe(), false);
  } finally {
    LanguageModelStub.remove();
  }
});

void test('GeminiNanoAdapter.probe does not throw when availability() rejects', async () => {
  LanguageModelStub.install({
    "availability": async () => Promise.reject(new Error('boom')),
    "create": async () => Promise.resolve({ "prompt": async () => Promise.resolve(''), "destroy": () => {} }),
  });
  const a = new GeminiNanoAdapter();
  try {
    assert.equal(await a.probe(), false);
  } finally {
    LanguageModelStub.remove();
  }
});

void test('performChat collapses multiple system turns into one leading system prompt', async () => {
  // The Prompt API rejects a `{ role: 'system' }` entry at any index but 0 (so a
  // second system entry always rejects) with a `TypeError`. The adapter must
  // fold every system turn into a single index-0 system prompt; user turns go to
  // `prompt()`.
  let createOptions: Record<string, unknown> | undefined;
  let promptInput: unknown;
  LanguageModelStub.install({
    'availability': async () => Promise.resolve('available'),
    'create':       async (options: Record<string, unknown>) => {
      createOptions = options;
      return Promise.resolve({
        'prompt':  async (input: unknown) => { promptInput = input; return Promise.resolve('ok'); },
        'destroy': () => {},
      });
    },
  });
  const a = new GeminiNanoAdapter();
  try {
    await a.chat(ChatRequestBuilder.from({
      'messages': [
        { 'role': 'system', 'content': 'You are the Archivist.' },
        { 'role': 'system', 'content': 'Answer in English.' },
        { 'role': 'user',   'content': 'Recommend a surreal novel.' },
      ],
    }));
  } finally {
    LanguageModelStub.remove();
  }
  assert.ok(createOptions !== undefined);
  assert.deepEqual(createOptions['initialPrompts'], [{ 'role': 'system', 'content': 'You are the Archivist.\n\nAnswer in English.' }]);
  assert.ok(createOptions['signal'] instanceof AbortSignal, 'create options must carry the composed AbortSignal');
  assert.equal(promptInput, 'Recommend a surreal novel.');
});

void test('performChat omits initialPrompts for a user-only request', async () => {
  let createOptions: Record<string, unknown> | undefined;
  LanguageModelStub.install({
    'availability': async () => Promise.resolve('available'),
    'create':       async (options: Record<string, unknown>) => {
      createOptions = options;
      return Promise.resolve({
        'prompt':  async () => Promise.resolve('ok'),
        'destroy': () => {},
      });
    },
  });
  const a = new GeminiNanoAdapter();
  try {
    await a.chat(ChatRequestBuilder.from({ 'messages': [{ 'role': 'user', 'content': 'Hello.' }] }));
  } finally {
    LanguageModelStub.remove();
  }
  // A user-only session is valid; the adapter passes no initialPrompts but
  // always carries the composed AbortSignal for timeout enforcement.
  assert.ok(createOptions !== undefined);
  assert.equal(createOptions['initialPrompts'], undefined);
  assert.ok(createOptions['signal'] instanceof AbortSignal, 'create options must carry the composed AbortSignal');
});

void test('performChat classifies a create() failure instead of leaking it raw', async () => {
  LanguageModelStub.install({
    'availability': async () => Promise.resolve('available'),
    'create':       async () => Promise.reject(new TypeError('initialPrompts: system prompt must be first')),
  });
  const a = new GeminiNanoAdapter({ 'maxAttempts': 1 });
  try {
    await assert.rejects(
      a.chat(ChatRequestBuilder.from({ 'messages': [{ 'role': 'user', 'content': 'Hello.' }] })),
      (err: unknown) => err instanceof Error && /system prompt must be first/u.test(err.message),
    );
  } finally {
    LanguageModelStub.remove();
  }
});

void test('a configured systemPrompt is injected as the leading system turn when the request has none', async () => {
  // The BaseAdapter `systemPrompt` seam supplies a default persona; the Nano
  // adapter then collapses it into the leading `initialPrompts` entry.
  let createOptions: Record<string, unknown> | undefined;
  LanguageModelStub.install({
    'availability': async () => Promise.resolve('available'),
    'create':       async (options: Record<string, unknown>) => {
      createOptions = options;
      return Promise.resolve({
        'prompt':  async () => Promise.resolve('ok'),
        'destroy': () => {},
      });
    },
  });
  const a = new GeminiNanoAdapter({ 'systemPrompt': 'You are the Archivist.' });
  try {
    await a.chat(ChatRequestBuilder.from({ 'messages': [{ 'role': 'user', 'content': 'Hello.' }] }));
  } finally {
    LanguageModelStub.remove();
  }
  assert.ok(createOptions !== undefined);
  assert.deepEqual(createOptions['initialPrompts'], [{ 'role': 'system', 'content': 'You are the Archivist.' }]);
  assert.ok(createOptions['signal'] instanceof AbortSignal, 'create options must carry the composed AbortSignal');
});

void test('a configured systemPrompt never overrides a caller-supplied system turn', async () => {
  let createOptions: Record<string, unknown> | undefined;
  LanguageModelStub.install({
    'availability': async () => Promise.resolve('available'),
    'create':       async (options: Record<string, unknown>) => {
      createOptions = options;
      return Promise.resolve({
        'prompt':  async () => Promise.resolve('ok'),
        'destroy': () => {},
      });
    },
  });
  const a = new GeminiNanoAdapter({ 'systemPrompt': 'Default persona.' });
  try {
    await a.chat(ChatRequestBuilder.from({
      'messages': [
        { 'role': 'system', 'content': 'Caller persona.' },
        { 'role': 'user',   'content': 'Hello.' },
      ],
    }));
  } finally {
    LanguageModelStub.remove();
  }
  assert.ok(createOptions !== undefined);
  assert.deepEqual(createOptions['initialPrompts'], [{ 'role': 'system', 'content': 'Caller persona.' }]);
  assert.ok(createOptions['signal'] instanceof AbortSignal, 'create options must carry the composed AbortSignal');
});

void test('GeminiNanoAdapter.listModels returns single gemini-nano descriptor', async () => {
  const a = new GeminiNanoAdapter();
  const models = await a.listModels();
  assert.equal(models.length, 1);
  const [m] = models;
  assert.ok(m !== undefined);
  assert.equal(m.name, 'gemini-nano');
  assert.equal(m.variant, 'chat');
  assert.equal(m.cloud, false);
});

void test('GeminiNanoAdapter.listModels requires no window.LanguageModel', async () => {
  LanguageModelStub.remove();
  const a = new GeminiNanoAdapter();
  const models = await a.listModels();
  assert.equal(models.length, 1);
  assert.equal(models[0]?.name, 'gemini-nano');
});

void test('GeminiNanoAdapter.selectChatModel picks gemini-nano', async () => {
  const a = new GeminiNanoAdapter();
  const picked = await a.selectChatModel({ 'preferred': 'gemini-nano' });
  assert.equal(picked, 'gemini-nano');
});

void test('GeminiNanoAdapter.selectChatModel with no preferred picks the single model', async () => {
  const a = new GeminiNanoAdapter();
  const picked = await a.selectChatModel();
  assert.equal(picked, 'gemini-nano');
});

void test('GeminiNanoAdapter accepts a timeoutMs option at construction', () => {
  // Type-level and construction-level acceptance — no runtime host needed.
  const a = new GeminiNanoAdapter({ 'timeoutMs': 5_000 });
  assert.equal(a.id, 'gemini-nano');
});

void test('performChat surfaces a TIMEOUT classification when timeoutMs elapses', async () => {
  // Install a stub whose prompt() hangs indefinitely; set timeoutMs to 1 ms so
  // the AbortController fires immediately. The error must be an LlmError with
  // the TIMEOUT classification — not an unclassified AbortError.
  LanguageModelStub.install({
    'availability': async () => Promise.resolve('available'),
    'create':       async () => Promise.resolve({
      'prompt':  async (_input: unknown, opts: { signal?: AbortSignal } = {}) =>
        new Promise<string>((_resolve, reject) => {
          if (opts.signal !== undefined) {
            opts.signal.addEventListener('abort', () => { reject(opts.signal?.reason); }, { 'once': true });
          }
        }),
      'destroy': () => {},
    }),
  });
  const a = new GeminiNanoAdapter({ 'maxAttempts': 1, 'timeoutMs': 1 });
  try {
    await assert.rejects(
      a.chat(ChatRequestBuilder.from({ 'messages': [{ 'role': 'user', 'content': 'Hello.' }] })),
      (err: unknown) => {
        assert.ok(err instanceof LlmError, `expected LlmError, got ${String(err)}`);
        assert.equal(err.classification, Classifications['TIMEOUT']);
        return true;
      },
    );
  } finally {
    LanguageModelStub.remove();
  }
});
