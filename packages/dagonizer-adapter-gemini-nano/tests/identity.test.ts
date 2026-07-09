import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import type { ChatStreamChunkType } from '@studnicky/dagonizer/adapter';
import { ChatRequest, Classifications, LlmError } from '@studnicky/dagonizer/adapter';

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

class TestSink {
  readonly pushed: string[] = [];

  async push(item: ChatStreamChunkType): Promise<void> {
    this.pushed.push(item.delta);
    return Promise.resolve();
  }
}

function assertLanguageOptions(options: Record<string, unknown> | undefined, language: string): void {
  assert.ok(options !== undefined);
  assert.deepEqual(options['expectedInputs'], [{ 'type': 'text', 'languages': [language] }]);
  assert.deepEqual(options['expectedOutputs'], [{ 'type': 'text', 'languages': [language] }]);
  assert.equal(options['outputLanguage'], undefined);
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
  let availabilityOptions: Record<string, unknown> | undefined;
  LanguageModelStub.install({
    "availability": async (options: Record<string, unknown>) => {
      availabilityOptions = options;
      return Promise.resolve('available');
    },
    "create": async () => Promise.resolve({ "prompt": async () => Promise.resolve(''), "destroy": () => {} }),
  });
  const a = new GeminiNanoAdapter();
  try {
    assert.equal(await a.probe(), true);
  } finally {
    LanguageModelStub.remove();
  }
  assertLanguageOptions(availabilityOptions, 'en');
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
    await a.chat(ChatRequest.create({
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
    await a.chat(ChatRequest.create({ 'messages': [{ 'role': 'user', 'content': 'Hello.' }] }));
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
      a.chat(ChatRequest.create({ 'messages': [{ 'role': 'user', 'content': 'Hello.' }] })),
      (err: unknown) => err instanceof Error && /system prompt must be first/u.test(err.message),
    );
  } finally {
    LanguageModelStub.remove();
  }
});

void test('a configured systemPrompt is injected as the leading system turn when the request has none', async () => {
  // The BaseAdapter `systemPrompt` seam supplies a default directive; the Nano
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
    await a.chat(ChatRequest.create({ 'messages': [{ 'role': 'user', 'content': 'Hello.' }] }));
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
  const a = new GeminiNanoAdapter({ 'systemPrompt': 'Default directive.' });
  try {
    await a.chat(ChatRequest.create({
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
  // the base deadline fires immediately. The error must be an LlmError with
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
      a.chat(ChatRequest.create({ 'messages': [{ 'role': 'user', 'content': 'Hello.' }] })),
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

void test('performChat does not forward maxTokens to the Prompt API', async () => {
  // The Chrome Prompt API exposes no output-token cap: neither lm.create() nor
  // session.prompt() accepts maxTokens / maxOutputTokens / max_tokens. The
  // adapter deliberately ignores the request's maxTokens budget so it never
  // passes an unrecognised field that would cause the browser to reject the
  // call. This test documents that deliberate absence and confirms the call
  // still succeeds when the caller supplies a token budget.
  let capturedCreateOptions: Record<string, unknown> | undefined;
  let capturedPromptOptions: Record<string, unknown> | undefined;
  LanguageModelStub.install({
    'availability': async () => Promise.resolve('available'),
    'create':       async (options: Record<string, unknown>) => {
      capturedCreateOptions = options;
      return Promise.resolve({
        'prompt':  async (_input: unknown, opts: Record<string, unknown> = {}) => {
          capturedPromptOptions = opts;
          return Promise.resolve('ok');
        },
        'destroy': () => {},
      });
    },
  });
  const a = new GeminiNanoAdapter();
  try {
    await a.chat(ChatRequest.create({
      'messages':  [{ 'role': 'user', 'content': 'Hi.' }],
      'maxTokens': 256,
    }));
  } finally {
    LanguageModelStub.remove();
  }
  assert.ok(capturedCreateOptions !== undefined);
  assert.ok(capturedPromptOptions !== undefined);
  // No token-cap field must appear on either the create() or the prompt() options.
  assert.equal(capturedCreateOptions['maxTokens'],       undefined);
  assert.equal(capturedCreateOptions['maxOutputTokens'], undefined);
  assert.equal(capturedCreateOptions['max_tokens'],      undefined);
  assert.equal(capturedPromptOptions['maxTokens'],       undefined);
  assert.equal(capturedPromptOptions['maxOutputTokens'], undefined);
  assert.equal(capturedPromptOptions['max_tokens'],      undefined);
});

void test('performChatStream emits per-chunk deltas from a cumulative promptStreaming stream', async () => {
  LanguageModelStub.install({
    'availability': async () => Promise.resolve('available'),
    'create':       async () => Promise.resolve({
      'promptStreaming': () => new ReadableStream<string>({
        start(controller) {
          controller.enqueue('He');
          controller.enqueue('Hello');
          controller.enqueue('Hello world');
          controller.close();
        },
      }),
      'prompt':  async () => Promise.resolve(''),
      'destroy': () => {},
    }),
  });
  const a = new GeminiNanoAdapter();
  const sink = new TestSink();
  try {
    const res = await a.chatStream(ChatRequest.create({ 'messages': [{ 'role': 'user', 'content': 'Hi.' }] }), sink);
    assert.deepEqual(sink.pushed, ['He', 'llo', ' world']);
    assert.equal(res.finishReason, 'stop');
    assert.equal(res.message.variant === 'tools' ? '' : res.message.content, 'Hello world');
  } finally {
    LanguageModelStub.remove();
  }
});

void test('performChatStream emits per-chunk deltas from an incremental promptStreaming stream', async () => {
  LanguageModelStub.install({
    'availability': async () => Promise.resolve('available'),
    'create':       async () => Promise.resolve({
      'promptStreaming': () => new ReadableStream<string>({
        start(controller) {
          controller.enqueue('He');
          controller.enqueue('llo');
          controller.enqueue(' world');
          controller.close();
        },
      }),
      'prompt':  async () => Promise.resolve(''),
      'destroy': () => {},
    }),
  });
  const a = new GeminiNanoAdapter();
  const sink = new TestSink();
  try {
    const res = await a.chatStream(ChatRequest.create({ 'messages': [{ 'role': 'user', 'content': 'Hi.' }] }), sink);
    assert.deepEqual(sink.pushed, ['He', 'llo', ' world']);
    assert.equal(res.finishReason, 'stop');
    assert.equal(res.message.variant === 'tools' ? '' : res.message.content, 'Hello world');
  } finally {
    LanguageModelStub.remove();
  }
});

void test('performChatStream locks cumulative mode from the second chunk and does not corrupt a stream containing a repeated/short chunk', async () => {
  // The stream is cumulative throughout (chunk 2 extends chunk 1), which locks
  // 'cumulative' mode. Chunk 4 momentarily repeats a SHORTER prefix than the
  // accumulated text so far ('Hello' is shorter than 'Hello there') — the OLD
  // per-chunk `chunk.startsWith(accumulated)` heuristic would fail this check
  // and wrongly append the whole chunk, duplicating text. The mode-locked
  // version keeps treating it as cumulative and must not corrupt the output.
  LanguageModelStub.install({
    'availability': async () => Promise.resolve('available'),
    'create':       async () => Promise.resolve({
      'promptStreaming': () => new ReadableStream<string>({
        start(controller) {
          controller.enqueue('Hello');
          controller.enqueue('Hello there');
          controller.enqueue('Hello');
          controller.enqueue('Hello there friend');
          controller.close();
        },
      }),
      'prompt':  async () => Promise.resolve(''),
      'destroy': () => {},
    }),
  });
  const a = new GeminiNanoAdapter();
  const sink = new TestSink();
  try {
    const res = await a.chatStream(ChatRequest.create({ 'messages': [{ 'role': 'user', 'content': 'Hi.' }] }), sink);
    // The mode-locked cumulative handling keeps the FINAL accumulated text
    // exactly the last chunk's cumulative value — no runaway duplication of
    // the kind the old per-chunk heuristic produced (which would have folded
    // 'Hello' back in as an incremental append, garbling the accumulated text
    // with a repeated 'Hello').
    assert.equal(res.finishReason, 'stop');
    assert.equal(res.message.variant === 'tools' ? '' : res.message.content, 'Hello there friend');
    assert.ok(!/Hello there friendHello|HelloHello|thereHello/u.test(sink.pushed.join('')), 'deltas must not contain the old heuristic\'s corrupted re-append pattern');
  } finally {
    LanguageModelStub.remove();
  }
});

void test('performChatStream emits the single chunk of a one-chunk promptStreaming stream', async () => {
  LanguageModelStub.install({
    'availability': async () => Promise.resolve('available'),
    'create':       async () => Promise.resolve({
      'promptStreaming': () => new ReadableStream<string>({
        start(controller) {
          controller.enqueue('Hi');
          controller.close();
        },
      }),
      'prompt':  async () => Promise.resolve(''),
      'destroy': () => {},
    }),
  });
  const a = new GeminiNanoAdapter();
  const sink = new TestSink();
  try {
    const res = await a.chatStream(ChatRequest.create({ 'messages': [{ 'role': 'user', 'content': 'Hi.' }] }), sink);
    assert.deepEqual(sink.pushed, ['Hi']);
    assert.equal(res.finishReason, 'stop');
    assert.equal(res.message.variant === 'tools' ? '' : res.message.content, 'Hi');
  } finally {
    LanguageModelStub.remove();
  }
});

void test('performChat resolves outputLanguage to "en" when no option is set and no navigator global exists', async () => {
  // Modern Node ships its own getter-only `navigator` global, so this test
  // explicitly removes it (rather than assuming absence) to exercise the
  // default path in OutputLanguage.detect() when neither an explicit option
  // nor a browser locale is available. `Object.defineProperty` with
  // `configurable: true` replaces the getter-only descriptor; the original
  // is restored in `finally`.
  const originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Reflect.deleteProperty(globalThis, 'navigator');
  let createOptions: Record<string, unknown> | undefined;
  LanguageModelStub.install({
    'availability': async () => Promise.resolve('available'),
    'create':       async (options: Record<string, unknown>) => {
      createOptions = options;
      return Promise.resolve({ 'prompt': async () => Promise.resolve('ok'), 'destroy': () => {} });
    },
  });
  const a = new GeminiNanoAdapter();
  try {
    await a.chat(ChatRequest.create({ 'messages': [{ 'role': 'user', 'content': 'Hello.' }] }));
  } finally {
    LanguageModelStub.remove();
    if (originalNavigatorDescriptor !== undefined) {
      Object.defineProperty(globalThis, 'navigator', originalNavigatorDescriptor);
    }
  }
  assertLanguageOptions(createOptions, 'en');
});

void test('performChat forwards an explicitly configured outputLanguage through Prompt API language expectations', async () => {
  let createOptions: Record<string, unknown> | undefined;
  let promptOptions: Record<string, unknown> | undefined;
  LanguageModelStub.install({
    'availability': async () => Promise.resolve('available'),
    'create':       async (options: Record<string, unknown>) => {
      createOptions = options;
      return Promise.resolve({
        'prompt':  async (_input: unknown, options: Record<string, unknown> = {}) => {
          promptOptions = options;
          return Promise.resolve('ok');
        },
        'destroy': () => {},
      });
    },
  });
  const a = new GeminiNanoAdapter({ 'outputLanguage': 'fr' });
  try {
    await a.chat(ChatRequest.create({ 'messages': [{ 'role': 'user', 'content': 'Bonjour.' }] }));
  } finally {
    LanguageModelStub.remove();
  }
  assertLanguageOptions(createOptions, 'fr');
  assertLanguageOptions(promptOptions, 'fr');
});

void test('performChat narrows an unsupported explicit outputLanguage down to "en"', async () => {
  let createOptions: Record<string, unknown> | undefined;
  LanguageModelStub.install({
    'availability': async () => Promise.resolve('available'),
    'create':       async (options: Record<string, unknown>) => {
      createOptions = options;
      return Promise.resolve({ 'prompt': async () => Promise.resolve('ok'), 'destroy': () => {} });
    },
  });
  // 'zh' is not in Chrome's supported output-language set (de/en/es/fr/ja).
  const a = new GeminiNanoAdapter({ 'outputLanguage': 'zh' });
  try {
    await a.chat(ChatRequest.create({ 'messages': [{ 'role': 'user', 'content': 'Hello.' }] }));
  } finally {
    LanguageModelStub.remove();
  }
  assertLanguageOptions(createOptions, 'en');
});

void test('performChat detects and narrows navigator.language when no explicit outputLanguage is configured', async () => {
  // Simulate the browser: install a `navigator.language` global carrying a
  // full BCP-47 tag, and confirm the adapter narrows it to the 2-letter
  // Chrome-supported code at construction time. Node 21+ ships its own
  // getter-only `navigator` global, so `Object.assign` cannot overwrite it —
  // `Object.defineProperty` with `configurable: true` replaces it and the
  // original descriptor is restored in `finally`.
  const originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', {
    'value':        { 'language': 'es-MX' },
    'configurable': true,
    'writable':     true,
  });
  let createOptions: Record<string, unknown> | undefined;
  LanguageModelStub.install({
    'availability': async () => Promise.resolve('available'),
    'create':       async (options: Record<string, unknown>) => {
      createOptions = options;
      return Promise.resolve({ 'prompt': async () => Promise.resolve('ok'), 'destroy': () => {} });
    },
  });
  const a = new GeminiNanoAdapter();
  try {
    await a.chat(ChatRequest.create({ 'messages': [{ 'role': 'user', 'content': 'Hola.' }] }));
  } finally {
    LanguageModelStub.remove();
    if (originalNavigatorDescriptor !== undefined) {
      Object.defineProperty(globalThis, 'navigator', originalNavigatorDescriptor);
    } else {
      Reflect.deleteProperty(globalThis, 'navigator');
    }
  }
  assertLanguageOptions(createOptions, 'es');
});

void test('performChatStream forwards the resolved outputLanguage through Prompt API language expectations', async () => {
  let createOptions: Record<string, unknown> | undefined;
  let promptStreamingOptions: Record<string, unknown> | undefined;
  LanguageModelStub.install({
    'availability': async () => Promise.resolve('available'),
    'create':       async (options: Record<string, unknown>) => {
      createOptions = options;
      return Promise.resolve({
        'promptStreaming': (_input: unknown, options: Record<string, unknown> = {}) => {
          promptStreamingOptions = options;
          return new ReadableStream<string>({
            start(controller) {
              controller.enqueue('Hi');
              controller.close();
            },
          });
        },
        'prompt':  async () => Promise.resolve(''),
        'destroy': () => {},
      });
    },
  });
  const a = new GeminiNanoAdapter({ 'outputLanguage': 'ja' });
  const sink = new TestSink();
  try {
    await a.chatStream(ChatRequest.create({ 'messages': [{ 'role': 'user', 'content': 'Hi.' }] }), sink);
  } finally {
    LanguageModelStub.remove();
  }
  assertLanguageOptions(createOptions, 'ja');
  assertLanguageOptions(promptStreamingOptions, 'ja');
});

void test('performChatStream uses the buffered default for a tool-bearing request', async () => {
  let promptCalled = false;
  let promptStreamingCalled = false;
  LanguageModelStub.install({
    'availability': async () => Promise.resolve('available'),
    'create':       async () => Promise.resolve({
      'promptStreaming': () => {
        promptStreamingCalled = true;
        throw new Error('promptStreaming must not be invoked for a tool-bearing request');
      },
      'prompt': async () => {
        promptCalled = true;
        return Promise.resolve('{"tool_calls":[]}');
      },
      'destroy': () => {},
    }),
  });
  const a = new GeminiNanoAdapter();
  const sink = new TestSink();
  try {
    const request = ChatRequest.create({
      'messages': [{ 'role': 'user', 'content': 'Search.' }],
      'tools': [{
        'name':        'search',
        'description': 'Search the web.',
        'inputSchema': { 'type': 'object', 'additionalProperties': false, 'properties': {}, 'required': [] },
        'outputSchema': { 'type': 'object' },
        'strict':      true,
      }],
    });
    await a.chatStream(request, sink);
    assert.equal(promptCalled, true);
    assert.equal(promptStreamingCalled, false);
    assert.equal(sink.pushed.length, 1);
  } finally {
    LanguageModelStub.remove();
  }
});
