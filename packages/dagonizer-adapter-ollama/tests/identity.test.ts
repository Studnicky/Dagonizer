/**
 * Smoke: OllamaApiAdapter exposes the expected id, display name, and capability shape.
 * No network calls; instantiation only.
 *
 * Also covers three cross-cutting wire guarantees:
 *   1. maxTokens → max_tokens field in the POST body (not max_completion_tokens)
 *   2. systemPrompt injection seam via BaseAdapter#withDefaultSystemPrompt
 *   3. timeoutMs → network abort → LlmError with a retryable NETWORK classification
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { ChatRequestBuilder, Classifications, LlmError } from '@studnicky/dagonizer/adapter';

import { OllamaApiAdapter } from '../src/index.js';

void test('OllamaApiAdapter identity + capabilities', () => {
  const adapter = new OllamaApiAdapter();

  assert.equal(adapter.id, 'ollama');
  assert.ok(adapter.displayName.toLowerCase().includes('ollama'));
  assert.equal(adapter.capabilities.toolUse, 'partial');
  assert.equal(adapter.capabilities.structuredOutput, true);
  assert.equal(adapter.capabilities.jsonMode, true);
});

void test('OllamaApiAdapter accepts model + baseUrl overrides without throwing', () => {
  const adapter = new OllamaApiAdapter({
    "model": 'mistral:latest',
    "baseUrl": 'http://10.0.0.5:11434'
  });

  assert.equal(adapter.id, 'ollama');
});

void test('OllamaApiAdapter accepts custom apiKey for proxied deployments', () => {
  const adapter = new OllamaApiAdapter({ "apiKey": 'gateway-token-123' });

  assert.equal(adapter.id, 'ollama');
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

void test('OllamaApiAdapter.probe returns true when /api/tags answers 200', async () => {
  FetchStub.install(async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    assert.ok(url.endsWith('/api/tags'));
    return new Response('{"models":[]}', { "status": 200 });
  });
  const adapter = new OllamaApiAdapter({ "baseUrl": 'http://127.0.0.1:11434' });
  try {
    assert.equal(await adapter.probe(), true);
  } finally {
    FetchStub.restore();
  }
});

void test('OllamaApiAdapter.probe returns false when /api/tags answers non-2xx', async () => {
  FetchStub.install(async () => new Response('nope', { "status": 500 }));
  const adapter = new OllamaApiAdapter();
  try {
    assert.equal(await adapter.probe(), false);
  } finally {
    FetchStub.restore();
  }
});

void test('OllamaApiAdapter.probe returns false when fetch rejects (daemon down)', async () => {
  FetchStub.install(async () => { throw new Error('ECONNREFUSED'); });
  const adapter = new OllamaApiAdapter();
  try {
    assert.equal(await adapter.probe(), false);
  } finally {
    FetchStub.restore();
  }
});

void test('OllamaApiAdapter.probe returns false on abort/timeout without throwing', async () => {
  FetchStub.install((_input: string | URL | Request, init?: RequestInit) => {
    return new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal ?? undefined;
      if (signal !== undefined) {
        signal.addEventListener('abort', () => { reject(new Error('aborted')); });
      }
    });
  });
  const adapter = new OllamaApiAdapter();
  try {
    assert.equal(await adapter.probe(), false);
  } finally {
    FetchStub.restore();
  }
});

void test('OllamaApiAdapter.probe hits the configured baseUrl, not the default', async () => {
  let seen = '';
  FetchStub.install(async (input: string | URL | Request) => {
    seen = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    return new Response('{}', { "status": 200 });
  });
  const adapter = new OllamaApiAdapter({ "baseUrl": 'http://10.0.0.5:11434' });
  try {
    await adapter.probe();
    assert.equal(seen, 'http://10.0.0.5:11434/api/tags');
  } finally {
    FetchStub.restore();
  }
});

// ── Wire guarantee 1: maxTokens → max_tokens field ───────────────────────────
//
// Ollama's OpenAI-compatible endpoint maps `max_tokens` to `num_predict`
// internally. It does NOT accept `max_completion_tokens`. Verify that a
// request with `maxTokens: 256` POSTs `max_tokens: 256` and that the body
// contains no `max_completion_tokens` key.

/** Minimal valid OpenAI-compatible response body the adapter accepts. */
const CHAT_RESPONSE_BODY = JSON.stringify({
  'choices': [{ 'message': { 'content': 'ok', 'role': 'assistant' }, 'finish_reason': 'stop' }],
  'usage': { 'prompt_tokens': 1, 'completion_tokens': 1 },
});

void test('OllamaApiAdapter.chat POSTs max_tokens (not max_completion_tokens) for maxTokens', async () => {
  let captured: Record<string, unknown> = {};
  FetchStub.install(async (_input: string | URL | Request, init?: RequestInit) => {
    if (init?.method === 'POST') {
      captured = JSON.parse(typeof init.body === 'string' ? init.body : '') as Record<string, unknown>;
    }
    return new Response(CHAT_RESPONSE_BODY, { "status": 200 });
  });
  const adapter = new OllamaApiAdapter({ "model": 'llama3:latest' });
  const request = ChatRequestBuilder.from({
    'messages': [{ 'role': 'user', 'content': 'hello' }],
    'maxTokens': 256,
  });
  try {
    await adapter.chat(request);
    assert.equal(captured['max_tokens'], 256, 'max_tokens should equal 256');
    assert.equal('max_completion_tokens' in captured, false, 'max_completion_tokens must not be present');
  } finally {
    FetchStub.restore();
  }
});

// ── Wire guarantee 2: systemPrompt seam ──────────────────────────────────────
//
// BaseAdapter#withDefaultSystemPrompt prepends a system turn only when the
// request has no system message. Two assertions:
//   a) configured systemPrompt + no system turn → messages[0] is the system turn
//   b) configured systemPrompt + existing system turn → no second system turn injected

void test('OllamaApiAdapter.chat injects configured systemPrompt as leading message when request has none', async () => {
  let captured: Record<string, unknown> = {};
  FetchStub.install(async (_input: string | URL | Request, init?: RequestInit) => {
    if (init?.method === 'POST') {
      captured = JSON.parse(typeof init.body === 'string' ? init.body : '') as Record<string, unknown>;
    }
    return new Response(CHAT_RESPONSE_BODY, { "status": 200 });
  });
  const adapter = new OllamaApiAdapter({ "model": 'llama3:latest', "systemPrompt": 'You are X.' });
  const request = ChatRequestBuilder.from({
    'messages': [{ 'role': 'user', 'content': 'hello' }],
  });
  try {
    await adapter.chat(request);
    const messages = captured['messages'] as Array<{ role: string; content: string }>;
    assert.ok(Array.isArray(messages), 'messages should be an array');
    assert.equal(messages[0]?.role, 'system', 'first message role should be system');
    assert.equal(messages[0]?.content, 'You are X.', 'first message content should be the configured systemPrompt');
  } finally {
    FetchStub.restore();
  }
});

void test('OllamaApiAdapter.chat does not override an existing system turn with configured systemPrompt', async () => {
  let captured: Record<string, unknown> = {};
  FetchStub.install(async (_input: string | URL | Request, init?: RequestInit) => {
    if (init?.method === 'POST') {
      captured = JSON.parse(typeof init.body === 'string' ? init.body : '') as Record<string, unknown>;
    }
    return new Response(CHAT_RESPONSE_BODY, { "status": 200 });
  });
  const adapter = new OllamaApiAdapter({ "model": 'llama3:latest', "systemPrompt": 'You are X.' });
  const request = ChatRequestBuilder.from({
    'messages': [
      { 'role': 'system', 'content': 'You are Y.' },
      { 'role': 'user', 'content': 'hello' },
    ],
  });
  try {
    await adapter.chat(request);
    const messages = captured['messages'] as Array<{ role: string; content: string }>;
    assert.ok(Array.isArray(messages), 'messages should be an array');
    const systemTurns = messages.filter((m) => m.role === 'system');
    assert.equal(systemTurns.length, 1, 'there should be exactly one system turn');
    assert.equal(systemTurns[0]?.content, 'You are Y.', 'the original system prompt should be preserved');
  } finally {
    FetchStub.restore();
  }
});

// ── Wire guarantee 3: timeoutMs → abort → LlmError ───────────────────────────
//
// A hanging fetch (honors the abort signal but never resolves) with a 1ms
// timeout causes the internal AbortController to fire. The abort reason is
// an LlmError(TIMEOUT); the catch block re-throws the already-classified
// LlmError unchanged, so the final error from chat() is an LlmError with
// classification TIMEOUT (retryable). With maxAttempts:1 the call is not retried.

void test('OllamaApiAdapter.chat rejects with LlmError on timeout (hanging fetch)', async () => {
  FetchStub.install((_input: string | URL | Request, init?: RequestInit) => {
    return new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal ?? undefined;
      if (signal !== undefined) {
        signal.addEventListener('abort', () => { reject(signal.reason ?? new Error('aborted')); });
      }
    });
  });
  const adapter = new OllamaApiAdapter({ "model": 'llama3:latest', "maxAttempts": 1, "timeoutMs": 1 });
  const request = ChatRequestBuilder.from({
    'messages': [{ 'role': 'user', 'content': 'hello' }],
  });
  try {
    let caught: unknown;
    try {
      await adapter.chat(request);
    } catch (err) {
      caught = err;
    }
    assert.ok(caught instanceof LlmError, 'chat() should reject with an LlmError on timeout');
    assert.equal(
      (caught as LlmError).classification.reason,
      Classifications['TIMEOUT'].reason,
      'timeout abort surfaces as TIMEOUT classification (classified reason preserved)',
    );
  } finally {
    FetchStub.restore();
  }
});
