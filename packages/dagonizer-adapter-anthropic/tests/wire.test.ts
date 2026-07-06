/**
 * AnthropicApiAdapter wire-format tests.
 *
 * All tests are offline: `globalThis.fetch` is replaced with a deterministic
 * stub. No network calls are made. Validates:
 *   1. Identity and capabilities (id, displayName, capabilities)
 *   2. probe() — true with key, false without key
 *   3. Outgoing wire shape — system extraction, messages, tools (input_schema),
 *      x-api-key + anthropic-version headers, tool_choice
 *   4. Text response parsing → `{ variant: 'text', content }` message
 *   5. tool_use response parsing → `{ variant: 'tools', toolCalls }` message
 *   6. Mixed response parsing → `{ variant: 'mixed', content, toolCalls }` message
 *   7. maxTokens → native max_tokens field (not max_completion_tokens / maxOutputTokens)
 *   8. systemPrompt seam — configured default vs caller-supplied system message
 *   9. timeoutMs → LlmError on hang (abort reason passes through ofNetworkError)
 */

import { strict as assert } from 'node:assert';
import { afterEach, beforeEach, test } from 'node:test';

import type { StreamSinkInterface } from '@studnicky/dagonizer';
import type { ChatStreamChunkType } from '@studnicky/dagonizer/adapter';
import { ChatRequest, Classifications, LlmError } from '@studnicky/dagonizer/adapter';

import { AnthropicApiAdapter } from '../src/index.js';

// ── Fetch stub infrastructure ─────────────────────────────────────────────

let originalFetch: typeof globalThis.fetch;

class OkResponse {
  private constructor() {}

  static of(body: unknown): Response {
    return new Response(JSON.stringify(body), {
      'status': 200,
      'headers': { 'content-type': 'application/json' },
    });
  }
}

/** Capture the last outgoing request so tests can assert wire shape. */
class FetchCapture {
  url = '';
  method = '';
  headers: Record<string, string> = {};
  body: Record<string, unknown> = {};

  stub(responseBody: unknown): typeof globalThis.fetch {
    return async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      this.url    = String(input);
      this.method = init?.method ?? 'GET';

      const rawHeaders = init?.headers;
      if (rawHeaders instanceof Headers) {
        rawHeaders.forEach((v, k) => { this.headers[k] = v; });
      } else if (rawHeaders !== undefined && typeof rawHeaders === 'object' && !Array.isArray(rawHeaders)) {
        for (const [k, v] of Object.entries(rawHeaders)) {
          if (typeof v === 'string') {
            this.headers[k] = v;
          }
        }
      }

      if (typeof init?.body === 'string') {
        const parsed: unknown = JSON.parse(init.body);
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
          // Rebuild a typed record from the narrowed object (same cast-free
          // pattern as the headers loop above) — no `as`.
          const body: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(parsed)) { body[k] = v; }
          this.body = body;
        }
      }

      return OkResponse.of(responseBody);
    };
  }
}

// ── Fixtures ───────────────────────────────────────────────────────────────

const TEXT_RESPONSE = {
  'content': [{ 'type': 'text', 'text': 'Hello there.' }],
  'stop_reason': 'end_turn',
  'usage': { 'input_tokens': 10, 'output_tokens': 5 },
};

const TOOL_USE_RESPONSE = {
  'content': [
    {
      'type': 'tool_use',
      'id':   'toolu_01abc',
      'name': 'search',
      'input': { 'query': 'test' },
    },
  ],
  'stop_reason': 'tool_use',
  'usage': { 'input_tokens': 20, 'output_tokens': 15 },
};

const MIXED_RESPONSE = {
  'content': [
    { 'type': 'text', 'text': 'Let me search for that.' },
    {
      'type': 'tool_use',
      'id':   'toolu_02def',
      'name': 'lookup',
      'input': { 'term': 'foo' },
    },
  ],
  'stop_reason': 'tool_use',
  'usage': { 'input_tokens': 30, 'output_tokens': 25 },
};

const SEARCH_TOOL = {
  'name':         'search',
  'description':  'Search for information.',
  'inputSchema':  { 'type': 'object', 'properties': { 'query': { 'type': 'string' } } },
  'outputSchema': { 'type': 'object' },
  'strict':       false,
} as const;

/** Encodes a sequence of named SSE frames into a `ReadableStream<Uint8Array>`. */
class SseFixture {
  private constructor() { /* static class */ }

  static of(frames: readonly { readonly event: string; readonly data: unknown }[]): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder();
    const text = frames.map((f) => `event: ${f.event}\ndata: ${JSON.stringify(f.data)}\n\n`).join('');
    const bytes = encoder.encode(text);
    return new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    });
  }
}

/** Records every chunk pushed by the adapter during a streaming call. */
class RecordingSink implements StreamSinkInterface<ChatStreamChunkType> {
  readonly pushed: ChatStreamChunkType[] = [];

  async push(item: ChatStreamChunkType): Promise<void> {
    this.pushed.push(item);
    return Promise.resolve();
  }
}

// ── Setup / teardown ──────────────────────────────────────────────────────

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// ── Tests ──────────────────────────────────────────────────────────────────

void test('AnthropicApiAdapter identity + capabilities', () => {
  const adapter = new AnthropicApiAdapter('test-key');
  assert.equal(adapter.id, 'anthropic');
  assert.ok(adapter.displayName.includes('Anthropic'));
  assert.equal(adapter.capabilities.toolUse, 'full');
  assert.equal(adapter.capabilities.structuredOutput, false);
  assert.equal(adapter.capabilities.jsonMode, false);
});

void test('AnthropicApiAdapter.probe returns true when apiKey is supplied', async () => {
  const adapter = new AnthropicApiAdapter('real-key');
  assert.equal(await adapter.probe(), true);
});

void test('AnthropicApiAdapter.probe returns false when apiKey is empty', async () => {
  const adapter = new AnthropicApiAdapter('');
  assert.equal(await adapter.probe(), false);
});

void test('outgoing request targets the Anthropic Messages endpoint', async () => {
  const capture = new FetchCapture();
  globalThis.fetch = capture.stub(TEXT_RESPONSE);

  const adapter = new AnthropicApiAdapter('sk-ant-test');
  await adapter.chat(ChatRequest.create({
    'messages': [{ 'role': 'user', 'content': 'Hello' }],
  }));

  assert.equal(capture.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(capture.method, 'POST');
});

void test('outgoing request carries x-api-key and anthropic-version headers', async () => {
  const capture = new FetchCapture();
  globalThis.fetch = capture.stub(TEXT_RESPONSE);

  const adapter = new AnthropicApiAdapter('sk-ant-key-value');
  await adapter.chat(ChatRequest.create({
    'messages': [{ 'role': 'user', 'content': 'Hello' }],
  }));

  assert.equal(capture.headers['x-api-key'], 'sk-ant-key-value');
  assert.equal(capture.headers['anthropic-version'], '2023-06-01');
  assert.equal(capture.headers['content-type'], 'application/json');
});

void test('system messages are extracted into top-level system field', async () => {
  const capture = new FetchCapture();
  globalThis.fetch = capture.stub(TEXT_RESPONSE);

  const adapter = new AnthropicApiAdapter('sk-ant-test');
  await adapter.chat(ChatRequest.create({
    'messages': [
      { 'role': 'system',    'content': 'You are helpful.' },
      { 'role': 'user',      'content': 'Hello' },
    ],
  }));

  assert.equal(capture.body['system'], 'You are helpful.');
  const messages = capture.body['messages'];
  assert.ok(Array.isArray(messages), 'messages must be an array');
  assert.equal(messages.length, 1);
  const firstMsg: Record<string, unknown> = messages[0];
  assert.equal(firstMsg['role'], 'user');
  assert.equal(firstMsg['content'], 'Hello');
});

void test('system messages are absent from wire body when none supplied', async () => {
  const capture = new FetchCapture();
  globalThis.fetch = capture.stub(TEXT_RESPONSE);

  const adapter = new AnthropicApiAdapter('sk-ant-test');
  await adapter.chat(ChatRequest.create({
    'messages': [{ 'role': 'user', 'content': 'Hello' }],
  }));

  assert.equal(Object.prototype.hasOwnProperty.call(capture.body, 'system'), false);
});

void test('tool definitions map to Anthropic tools array with input_schema', async () => {
  const capture = new FetchCapture();
  globalThis.fetch = capture.stub(TOOL_USE_RESPONSE);

  const adapter = new AnthropicApiAdapter('sk-ant-test');
  await adapter.chat(ChatRequest.create({
    'messages': [{ 'role': 'user', 'content': 'Search for cats.' }],
    'tools': [SEARCH_TOOL],
  }));

  const tools = capture.body['tools'];
  assert.ok(Array.isArray(tools), 'tools must be an array');
  assert.equal(tools.length, 1);
  const tool: Record<string, unknown> = tools[0];
  assert.ok(tool !== undefined);
  assert.equal(tool['name'], 'search');
  assert.equal(tool['description'], 'Search for information.');
  assert.deepEqual(
    tool['input_schema'],
    { 'type': 'object', 'properties': { 'query': { 'type': 'string' } } },
  );
});

void test('tool_choice auto maps to { type: "auto" } on wire', async () => {
  const capture = new FetchCapture();
  globalThis.fetch = capture.stub(TOOL_USE_RESPONSE);

  const adapter = new AnthropicApiAdapter('sk-ant-test');
  await adapter.chat(ChatRequest.create({
    'messages':   [{ 'role': 'user', 'content': 'Go.' }],
    'tools':      [SEARCH_TOOL],
    'toolChoice': { 'type': 'auto' },
  }));

  assert.deepEqual(capture.body['tool_choice'], { 'type': 'auto' });
});

void test('tool_choice required maps to { type: "any" } on wire', async () => {
  const capture = new FetchCapture();
  globalThis.fetch = capture.stub(TOOL_USE_RESPONSE);

  const adapter = new AnthropicApiAdapter('sk-ant-test');
  await adapter.chat(ChatRequest.create({
    'messages':   [{ 'role': 'user', 'content': 'Go.' }],
    'tools':      [SEARCH_TOOL],
    'toolChoice': { 'type': 'required' },
  }));

  assert.deepEqual(capture.body['tool_choice'], { 'type': 'any' });
});

void test('tool_choice specific tool maps to { type: "tool", name } on wire', async () => {
  const capture = new FetchCapture();
  globalThis.fetch = capture.stub(TOOL_USE_RESPONSE);

  const adapter = new AnthropicApiAdapter('sk-ant-test');
  await adapter.chat(ChatRequest.create({
    'messages':   [{ 'role': 'user', 'content': 'Go.' }],
    'tools':      [SEARCH_TOOL],
    'toolChoice': { 'type': 'tool', 'name': 'search' },
  }));

  assert.deepEqual(capture.body['tool_choice'], { 'type': 'tool', 'name': 'search' });
});

void test('tool result message maps to user role with tool_result content block', async () => {
  const capture = new FetchCapture();
  globalThis.fetch = capture.stub(TEXT_RESPONSE);

  const adapter = new AnthropicApiAdapter('sk-ant-test');
  await adapter.chat(ChatRequest.create({
    'messages': [
      { 'role': 'user',    'content': 'Search for cats.' },
      {
        'role':       'tool',
        'content':    '{"result":"cats found"}',
        'toolCallId': 'toolu_01abc',
        'toolName':   'search',
      },
    ],
  }));

  const messages = capture.body['messages'];
  assert.ok(Array.isArray(messages), 'messages must be an array');
  const toolResultMsg: Record<string, unknown> = messages[1];
  assert.equal(toolResultMsg['role'], 'user');
  const toolResultContent = toolResultMsg['content'];
  assert.ok(Array.isArray(toolResultContent), 'content must be an array');
  const block: Record<string, unknown> = toolResultContent[0];
  assert.ok(block !== undefined);
  assert.equal(block['type'], 'tool_result');
  assert.equal(block['tool_use_id'], 'toolu_01abc');
  assert.equal(block['content'], '{"result":"cats found"}');
});

void test('text response decodes to { variant: "text", content } message', async () => {
  globalThis.fetch = new FetchCapture().stub(TEXT_RESPONSE);

  const adapter = new AnthropicApiAdapter('sk-ant-test');
  const response = await adapter.chat(ChatRequest.create({
    'messages': [{ 'role': 'user', 'content': 'Hello' }],
  }));

  assert.equal(response.message.variant, 'text');
  if (response.message.variant === 'text') {
    assert.equal(response.message.content, 'Hello there.');
  }
  assert.equal(response.finishReason, 'stop');
  assert.equal(response.usage.promptTokens, 10);
  assert.equal(response.usage.completionTokens, 5);
});

void test('tool_use response decodes to { variant: "tools", toolCalls } message', async () => {
  globalThis.fetch = new FetchCapture().stub(TOOL_USE_RESPONSE);

  const adapter = new AnthropicApiAdapter('sk-ant-test');
  const response = await adapter.chat(ChatRequest.create({
    'messages': [{ 'role': 'user', 'content': 'Search for cats.' }],
    'tools':    [SEARCH_TOOL],
  }));

  assert.equal(response.message.variant, 'tools');
  if (response.message.variant === 'tools') {
    assert.equal(response.message.toolCalls.length, 1);
    const call = response.message.toolCalls[0];
    assert.ok(call !== undefined);
    assert.equal(call.id, 'toolu_01abc');
    assert.equal(call.name, 'search');
    assert.deepEqual(call.arguments, { 'query': 'test' });
  }
  assert.equal(response.finishReason, 'tool_call');
  assert.equal(response.usage.promptTokens, 20);
  assert.equal(response.usage.completionTokens, 15);
});

void test('mixed response (text + tool_use) decodes to { variant: "mixed" } message', async () => {
  globalThis.fetch = new FetchCapture().stub(MIXED_RESPONSE);

  const adapter = new AnthropicApiAdapter('sk-ant-test');
  const response = await adapter.chat(ChatRequest.create({
    'messages': [{ 'role': 'user', 'content': 'Look up foo.' }],
    'tools':    [{ ...SEARCH_TOOL, 'name': 'lookup', 'description': 'Look up a term.' }],
  }));

  assert.equal(response.message.variant, 'mixed');
  if (response.message.variant === 'mixed') {
    assert.equal(response.message.content, 'Let me search for that.');
    assert.equal(response.message.toolCalls.length, 1);
    const call = response.message.toolCalls[0];
    assert.ok(call !== undefined);
    assert.equal(call.id, 'toolu_02def');
    assert.equal(call.name, 'lookup');
    assert.deepEqual(call.arguments, { 'term': 'foo' });
  }
  assert.equal(response.finishReason, 'tool_call');
});

void test('custom baseUrl is used for the endpoint', async () => {
  const capture = new FetchCapture();
  globalThis.fetch = capture.stub(TEXT_RESPONSE);

  const adapter = new AnthropicApiAdapter('sk-ant-test', {
    'baseUrl': 'https://proxy.example.com',
  });
  await adapter.chat(ChatRequest.create({
    'messages': [{ 'role': 'user', 'content': 'Hello' }],
  }));

  assert.equal(capture.url, 'https://proxy.example.com/v1/messages');
});

void test('custom anthropicVersion option overrides default header', async () => {
  const capture = new FetchCapture();
  globalThis.fetch = capture.stub(TEXT_RESPONSE);

  const adapter = new AnthropicApiAdapter('sk-ant-test', {
    'anthropicVersion': '2024-01-01',
  });
  await adapter.chat(ChatRequest.create({
    'messages': [{ 'role': 'user', 'content': 'Hello' }],
  }));

  assert.equal(capture.headers['anthropic-version'], '2024-01-01');
});

void test('usage is zero when provider omits usage field', async () => {
  globalThis.fetch = new FetchCapture().stub({
    'content':     [{ 'type': 'text', 'text': 'ok' }],
    'stop_reason': 'end_turn',
  });

  const adapter = new AnthropicApiAdapter('sk-ant-test');
  const response = await adapter.chat(ChatRequest.create({
    'messages': [{ 'role': 'user', 'content': 'Hello' }],
  }));

  assert.equal(response.usage.promptTokens, 0);
  assert.equal(response.usage.completionTokens, 0);
});

// ── Cross-cutting guarantee tests ─────────────────────────────────────────

void test('maxTokens maps to top-level max_tokens (not max_completion_tokens or maxOutputTokens)', async () => {
  const capture = new FetchCapture();
  globalThis.fetch = capture.stub(TEXT_RESPONSE);

  const adapter = new AnthropicApiAdapter('sk-ant-test');
  await adapter.chat(ChatRequest.create({
    'messages':  [{ 'role': 'user', 'content': 'Hello' }],
    'maxTokens': 256,
  }));

  assert.equal(capture.body['max_tokens'], 256);
  assert.equal(Object.prototype.hasOwnProperty.call(capture.body, 'max_completion_tokens'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(capture.body, 'maxOutputTokens'), false);
});

void test('configured systemPrompt is injected when request has no system message', async () => {
  const capture = new FetchCapture();
  globalThis.fetch = capture.stub(TEXT_RESPONSE);

  const adapter = new AnthropicApiAdapter('sk-ant-test', { 'systemPrompt': 'You are X.' });
  await adapter.chat(ChatRequest.create({
    'messages': [{ 'role': 'user', 'content': 'Hello' }],
  }));

  assert.equal(capture.body['system'], 'You are X.');
});

void test('caller system message is not overridden by configured systemPrompt', async () => {
  const capture = new FetchCapture();
  globalThis.fetch = capture.stub(TEXT_RESPONSE);

  const adapter = new AnthropicApiAdapter('sk-ant-test', { 'systemPrompt': 'You are X.' });
  await adapter.chat(ChatRequest.create({
    'messages': [
      { 'role': 'system', 'content': 'You are Y.' },
      { 'role': 'user',   'content': 'Hello' },
    ],
  }));

  // Caller's system message wins; the configured systemPrompt must not override it.
  assert.equal(capture.body['system'], 'You are Y.');
});

void test('timeoutMs fires and rejects with LlmError from the timeout path', async () => {
  // A fetch stub that never resolves but rejects with signal.reason when the
  // passed signal fires. The base composes the configured timeoutMs ceiling into
  // request.signal before calling performChat; the adapter forwards that signal
  // to fetch. When the ceiling fires the base aborts with
  // LlmError('anthropic request timeout', TIMEOUT). The catch block preserves an
  // already-classified LlmError unchanged, so the final thrown error has TIMEOUT
  // classification and a message that includes "timeout".
  globalThis.fetch = async (_input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const signal = init?.signal;
    return new Promise<Response>((_resolve, reject) => {
      if (signal !== undefined) {
        if (signal.aborted) {
          reject(signal.reason instanceof Error ? signal.reason : new Error(String(signal.reason)));
          return;
        }
        signal.addEventListener('abort', () => {
          reject(signal.reason instanceof Error ? signal.reason : new Error(String(signal.reason)));
        }, { 'once': true });
      }
    });
  };

  const adapter = new AnthropicApiAdapter('sk-ant-test', { 'maxAttempts': 1, 'timeoutMs': 1 });
  let thrown: unknown;
  try {
    await adapter.chat(ChatRequest.create({
      'messages': [{ 'role': 'user', 'content': 'Hello' }],
    }));
  } catch (err) {
    thrown = err;
  }

  assert.ok(thrown instanceof LlmError, 'expected LlmError to be thrown');
  // The abort reason (TIMEOUT LlmError) is re-thrown unchanged by the catch
  // block, so the final classification is TIMEOUT with its original "timeout" message.
  assert.equal(thrown.classification, Classifications['TIMEOUT']);
  assert.ok(
    thrown.message.includes('timeout'),
    `expected message to include "timeout", got: ${thrown.message}`,
  );
});

// ── Streaming ──────────────────────────────────────────────────────────────

void test('chatStream drains SSE frames into sink chunks and an assembled response', async () => {
  globalThis.fetch = async (): Promise<Response> => {
    const body = SseFixture.of([
      { 'event': 'message_start', 'data': { 'type': 'message_start', 'message': { 'usage': { 'input_tokens': 12 } } } },
      {
        'event': 'content_block_delta',
        'data': { 'type': 'content_block_delta', 'index': 0, 'delta': { 'type': 'text_delta', 'text': 'Hello' } },
      },
      {
        'event': 'content_block_delta',
        'data': { 'type': 'content_block_delta', 'index': 0, 'delta': { 'type': 'text_delta', 'text': ' there.' } },
      },
      {
        'event': 'message_delta',
        'data': { 'type': 'message_delta', 'delta': { 'stop_reason': 'end_turn' }, 'usage': { 'output_tokens': 8 } },
      },
      { 'event': 'message_stop', 'data': { 'type': 'message_stop' } },
    ]);
    return new Response(body, { 'status': 200, 'headers': { 'content-type': 'text/event-stream' } });
  };

  const adapter = new AnthropicApiAdapter('sk-ant-test');
  const sink = new RecordingSink();
  const response = await adapter.chatStream(
    ChatRequest.create({ 'messages': [{ 'role': 'user', 'content': 'Hello' }] }),
    sink,
  );

  assert.equal(sink.pushed.length, 2);
  assert.equal(sink.pushed[0]?.delta, 'Hello');
  assert.equal(sink.pushed[1]?.delta, ' there.');

  assert.equal(response.message.variant, 'text');
  if (response.message.variant === 'text') {
    assert.equal(response.message.content, 'Hello there.');
  }
  assert.equal(response.finishReason, 'stop');
  assert.equal(response.usage.promptTokens, 12);
  assert.equal(response.usage.completionTokens, 8);
});

void test('chatStream with tools falls back to the buffered path (no stream: true on wire)', async () => {
  const capture = new FetchCapture();
  globalThis.fetch = capture.stub(TOOL_USE_RESPONSE);

  const adapter = new AnthropicApiAdapter('sk-ant-test');
  const sink = new RecordingSink();
  await adapter.chatStream(
    ChatRequest.create({
      'messages': [{ 'role': 'user', 'content': 'Search for cats.' }],
      'tools':    [SEARCH_TOOL],
    }),
    sink,
  );

  assert.equal(Object.prototype.hasOwnProperty.call(capture.body, 'stream'), false);
});

void test('chatStream drains a text_delta frame split across two chunk() boundaries', async () => {
  // Same happy-path frames as the passing test above, but the SSE bytes are
  // enqueued as two separate ReadableStream chunks with the split landing
  // mid-frame — SseLineParser must reassemble the frame across the read()
  // boundary rather than treating each enqueue as a complete frame.
  globalThis.fetch = async (): Promise<Response> => {
    const encoder = new TextEncoder();
    const full = [
      { 'event': 'message_start', 'data': { 'type': 'message_start', 'message': { 'usage': { 'input_tokens': 12 } } } },
      {
        'event': 'content_block_delta',
        'data': { 'type': 'content_block_delta', 'index': 0, 'delta': { 'type': 'text_delta', 'text': 'Hello there.' } },
      },
      {
        'event': 'message_delta',
        'data': { 'type': 'message_delta', 'delta': { 'stop_reason': 'end_turn' }, 'usage': { 'output_tokens': 8 } },
      },
      { 'event': 'message_stop', 'data': { 'type': 'message_stop' } },
    ].map((f) => `event: ${f.event}\ndata: ${JSON.stringify(f.data)}\n\n`).join('');
    const bytes = encoder.encode(full);
    const splitAt = Math.floor(bytes.length / 2); // lands inside a frame, not on a boundary
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, splitAt));
        controller.enqueue(bytes.slice(splitAt));
        controller.close();
      },
    });
    return new Response(stream, { 'status': 200, 'headers': { 'content-type': 'text/event-stream' } });
  };

  const adapter = new AnthropicApiAdapter('sk-ant-test');
  const sink = new RecordingSink();
  const response = await adapter.chatStream(
    ChatRequest.create({ 'messages': [{ 'role': 'user', 'content': 'Hello' }] }),
    sink,
  );

  assert.equal(sink.pushed.map((c) => c.delta).join(''), 'Hello there.');
  assert.equal(response.finishReason, 'stop');
  assert.equal(response.usage.promptTokens, 12);
  assert.equal(response.usage.completionTokens, 8);
});

void test('chatStream rejects with a classified LlmError (not a raw AbortError) on a hung stream', async () => {
  // The SSE body emits message_start then hangs forever on the next chunk.
  // BaseAdapter.withDeadline composes a short-lived timeout into
  // request.signal; when it fires, the composed abort reason is already an
  // LlmError('… request timeout', TIMEOUT) rather than a raw DOMException —
  // proving the caller never observes an unclassified AbortError for a
  // stalled stream, end to end through the public chatStream() API.
  const encoder = new TextEncoder();
  let pullCount = 0;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      pullCount += 1;
      if (pullCount === 1) {
        controller.enqueue(encoder.encode(
          'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":5}}}\n\n',
        ));
        return;
      }
      await new Promise<void>(() => { /* never resolves — simulates a stalled connection */ });
    },
  });

  globalThis.fetch = async (): Promise<Response> => new Response(body, {
    'status':  200,
    'headers': { 'content-type': 'text/event-stream' },
  });

  const adapter = new AnthropicApiAdapter('sk-ant-test', { 'timeoutMs': 20, 'maxAttempts': 1 });
  const sink = new RecordingSink();

  let thrown: unknown;
  try {
    await adapter.chatStream(
      ChatRequest.create({ 'messages': [{ 'role': 'user', 'content': 'Hello' }] }),
      sink,
    );
  } catch (err) {
    thrown = err;
  }

  assert.ok(thrown instanceof LlmError, `expected a classified LlmError, got: ${String(thrown)}`);
  if (thrown instanceof LlmError) {
    assert.equal(thrown.classification.reason, 'TIMEOUT');
  }
});

void test('a mid-stream read failure is classified as a NETWORK LlmError, not left as a raw DOMException', async () => {
  // The underlying stream read rejects with a raw AbortError-shaped
  // DOMException (as a real fetch body reader does on a socket-level abort)
  // with request.signal never aborted. Before the #drainStream try/catch,
  // this raw DOMException would propagate unclassified through
  // BaseAdapter.withDeadline's reject path (it IS an Error, so the guard
  // that only wraps non-Error reasons lets it straight through). The fix
  // classifies it via the same LlmError.ofNetworkError path #postJson uses.
  const encoder = new TextEncoder();
  let pullCount = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      pullCount += 1;
      if (pullCount === 1) {
        controller.enqueue(encoder.encode(
          'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":5}}}\n\n',
        ));
        return;
      }
      throw new DOMException('The operation was aborted.', 'AbortError');
    },
  });

  globalThis.fetch = async (): Promise<Response> => new Response(body, {
    'status':  200,
    'headers': { 'content-type': 'text/event-stream' },
  });

  const adapter = new AnthropicApiAdapter('sk-ant-test');
  const sink = new RecordingSink();

  let thrown: unknown;
  try {
    await adapter.chatStream(
      ChatRequest.create({ 'messages': [{ 'role': 'user', 'content': 'Hello' }] }),
      sink,
    );
  } catch (err) {
    thrown = err;
  }

  assert.ok(thrown instanceof LlmError, `expected a classified LlmError, got: ${String(thrown)}`);
  if (thrown instanceof LlmError) {
    assert.equal(thrown.classification, Classifications['NETWORK']);
  }
});

void test('an "error" SSE event is classified as a SCHEMA_VIOLATION LlmError surfacing the provider message', async () => {
  globalThis.fetch = async (): Promise<Response> => {
    const body = SseFixture.of([
      { 'event': 'message_start', 'data': { 'type': 'message_start', 'message': { 'usage': { 'input_tokens': 4 } } } },
      {
        'event': 'error',
        'data': { 'type': 'error', 'error': { 'type': 'overloaded_error', 'message': 'Overloaded' } },
      },
    ]);
    return new Response(body, { 'status': 200, 'headers': { 'content-type': 'text/event-stream' } });
  };

  const adapter = new AnthropicApiAdapter('sk-ant-test');
  const sink = new RecordingSink();

  let thrown: unknown;
  try {
    await adapter.chatStream(
      ChatRequest.create({ 'messages': [{ 'role': 'user', 'content': 'Hello' }] }),
      sink,
    );
  } catch (err) {
    thrown = err;
  }

  assert.ok(thrown instanceof LlmError, `expected a classified LlmError, got: ${String(thrown)}`);
  if (thrown instanceof LlmError) {
    assert.equal(thrown.classification, Classifications['SCHEMA_VIOLATION']);
    assert.ok(thrown.message.includes('Overloaded'), `expected message to surface the provider text, got: ${thrown.message}`);
  }
});
