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
 */

import { strict as assert } from 'node:assert';
import { afterEach, beforeEach, test } from 'node:test';

import { ChatRequestBuilder } from '@studnicky/dagonizer/adapter';

import { AnthropicApiAdapter } from '../src/index.js';

// ── Fetch stub infrastructure ─────────────────────────────────────────────

let originalFetch: typeof globalThis.fetch;

function makeOkResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    'status': 200,
    'headers': { 'content-type': 'application/json' },
  });
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
        Object.assign(this.headers, rawHeaders as Record<string, string>);
      }

      if (typeof init?.body === 'string') {
        this.body = JSON.parse(init.body) as Record<string, unknown>;
      }

      return makeOkResponse(responseBody);
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
  await adapter.chat(ChatRequestBuilder.from({
    'messages': [{ 'role': 'user', 'content': 'Hello' }],
  }));

  assert.equal(capture.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(capture.method, 'POST');
});

void test('outgoing request carries x-api-key and anthropic-version headers', async () => {
  const capture = new FetchCapture();
  globalThis.fetch = capture.stub(TEXT_RESPONSE);

  const adapter = new AnthropicApiAdapter('sk-ant-key-value');
  await adapter.chat(ChatRequestBuilder.from({
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
  await adapter.chat(ChatRequestBuilder.from({
    'messages': [
      { 'role': 'system',    'content': 'You are helpful.' },
      { 'role': 'user',      'content': 'Hello' },
    ],
  }));

  assert.equal(capture.body['system'], 'You are helpful.');
  const messages = capture.body['messages'] as unknown[];
  assert.equal(messages.length, 1);
  const first = messages[0] as { role: string; content: string };
  assert.equal(first.role, 'user');
  assert.equal(first.content, 'Hello');
});

void test('system messages are absent from wire body when none supplied', async () => {
  const capture = new FetchCapture();
  globalThis.fetch = capture.stub(TEXT_RESPONSE);

  const adapter = new AnthropicApiAdapter('sk-ant-test');
  await adapter.chat(ChatRequestBuilder.from({
    'messages': [{ 'role': 'user', 'content': 'Hello' }],
  }));

  assert.equal(Object.prototype.hasOwnProperty.call(capture.body, 'system'), false);
});

void test('tool definitions map to Anthropic tools array with input_schema', async () => {
  const capture = new FetchCapture();
  globalThis.fetch = capture.stub(TOOL_USE_RESPONSE);

  const adapter = new AnthropicApiAdapter('sk-ant-test');
  await adapter.chat(ChatRequestBuilder.from({
    'messages': [{ 'role': 'user', 'content': 'Search for cats.' }],
    'tools': [SEARCH_TOOL],
  }));

  const tools = capture.body['tools'] as Array<{ name: string; description: string; input_schema: unknown }>;
  assert.equal(tools.length, 1);
  const tool = tools[0];
  assert.ok(tool !== undefined);
  assert.equal(tool.name, 'search');
  assert.equal(tool.description, 'Search for information.');
  assert.deepEqual(
    tool.input_schema,
    { 'type': 'object', 'properties': { 'query': { 'type': 'string' } } },
  );
});

void test('tool_choice auto maps to { type: "auto" } on wire', async () => {
  const capture = new FetchCapture();
  globalThis.fetch = capture.stub(TOOL_USE_RESPONSE);

  const adapter = new AnthropicApiAdapter('sk-ant-test');
  await adapter.chat(ChatRequestBuilder.from({
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
  await adapter.chat(ChatRequestBuilder.from({
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
  await adapter.chat(ChatRequestBuilder.from({
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
  await adapter.chat(ChatRequestBuilder.from({
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

  const messages = capture.body['messages'] as Array<{ role: string; content: unknown }>;
  const toolResultMsg = messages[1] as { role: string; content: Array<{ type: string; tool_use_id: string; content: string }> };
  assert.equal(toolResultMsg.role, 'user');
  assert.ok(Array.isArray(toolResultMsg.content));
  const block = toolResultMsg.content[0];
  assert.ok(block !== undefined);
  assert.equal(block.type, 'tool_result');
  assert.equal(block.tool_use_id, 'toolu_01abc');
  assert.equal(block.content, '{"result":"cats found"}');
});

void test('text response decodes to { variant: "text", content } message', async () => {
  globalThis.fetch = new FetchCapture().stub(TEXT_RESPONSE);

  const adapter = new AnthropicApiAdapter('sk-ant-test');
  const response = await adapter.chat(ChatRequestBuilder.from({
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
  const response = await adapter.chat(ChatRequestBuilder.from({
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
  const response = await adapter.chat(ChatRequestBuilder.from({
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
  await adapter.chat(ChatRequestBuilder.from({
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
  await adapter.chat(ChatRequestBuilder.from({
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
  const response = await adapter.chat(ChatRequestBuilder.from({
    'messages': [{ 'role': 'user', 'content': 'Hello' }],
  }));

  assert.equal(response.usage.promptTokens, 0);
  assert.equal(response.usage.completionTokens, 0);
});
