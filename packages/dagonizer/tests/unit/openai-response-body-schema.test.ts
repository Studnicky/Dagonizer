/**
 * Tests for untrusted-input hardening in OpenAiCompatibleAdapter:
 *
 * (a) A schema-valid OpenAI response parses correctly.
 * (b) A schema-INVALID response (not an object) throws LlmError SCHEMA_VIOLATION.
 * (c) A malformed tool_calls entry (missing function.name) throws SCHEMA_VIOLATION,
 *     not UNKNOWN.
 *
 * All tests use the InjectableAdapter pattern (monkey-patch global fetch)
 * established by adapter-parse-json.test.ts.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { AdapterCapabilities, ChatRequest, ChatResponse } from '../../src/adapter/LlmAdapter.js';
import { LlmError } from '../../src/adapter/LlmError.js';
import { OpenAiCompatibleAdapter } from '../../src/adapter/OpenAiCompatibleAdapter.js';

const CAPS: AdapterCapabilities = { 'toolUse': 'full', 'structuredOutput': true, 'jsonMode': true };

/** Concrete subclass that injects a raw HTTP response body via monkey-patched fetch. */
class InjectableAdapter extends OpenAiCompatibleAdapter {
  readonly #rawBody: unknown;

  constructor(rawBody: unknown) {
    super('test-key', {
      'id': 'test',
      'displayName': 'Test',
      'capabilities': CAPS,
      'endpoint': 'https://example.com/v1/chat/completions',
      'defaultModel': 'test-model',
      'tokenField': 'max_tokens',
      'timeoutMs': 5_000,
      'extraHeaders': {},
    });
    this.#rawBody = rawBody;
  }

  protected override async performChat(request: ChatRequest): Promise<ChatResponse> {
    const body = this.#rawBody;
    const saved = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(JSON.stringify(body), {
        'status': 200,
        'headers': { 'content-type': 'application/json' },
      });
    try {
      return await super.performChat(request);
    } finally {
      globalThis.fetch = saved;
    }
  }
}

function makeRequest(): ChatRequest {
  return {
    'messages': [{ 'role': 'user', 'content': 'hi' }],
    'tools': [],
    'toolChoice': { 'type': 'auto' },
    'outputSchema': { 'kind': 'none' },
    'maxTokens': 64,
    'temperature': 0.2,
    'signal': new AbortController().signal,
  };
}

void describe('OpenAiCompatibleAdapter — untrusted input hardening', () => {
  // (a) Schema-valid response parses correctly
  void it('(a) parses a schema-valid response and returns message text', async () => {
    const adapter = new InjectableAdapter({
      'choices': [{
        'message': { 'content': 'Hello world', 'tool_calls': [] },
        'finish_reason': 'stop',
      }],
      'usage': { 'prompt_tokens': 5, 'completion_tokens': 3 },
    });

    const resp = await adapter.chat(makeRequest());
    assert.equal(resp.finishReason, 'stop');
    assert.equal(resp.message.kind, 'text');
    if (resp.message.kind === 'text') {
      assert.equal(resp.message.content, 'Hello world');
    }
    assert.deepEqual(resp.usage, { 'promptTokens': 5, 'completionTokens': 3 });
  });

  // (b) Schema-INVALID response (not an object) throws SCHEMA_VIOLATION
  void it('(b) throws LlmError SCHEMA_VIOLATION for a non-object response body', async () => {
    const adapter = new InjectableAdapter('this is not an object');

    await assert.rejects(
      () => adapter.chat(makeRequest()),
      (err: unknown): err is LlmError => {
        if (!(err instanceof LlmError)) return false;
        assert.equal(err.classification.reason, 'SCHEMA_VIOLATION');
        assert.equal(err.classification.retryable, false);
        assert.match(err.message, /schema violation/iu);
        return true;
      },
    );
  });

  // (b) Schema-INVALID response — choices is not an array
  void it('(b) throws LlmError SCHEMA_VIOLATION when choices is a string instead of array', async () => {
    const adapter = new InjectableAdapter({ 'choices': 'not-an-array' });

    await assert.rejects(
      () => adapter.chat(makeRequest()),
      (err: unknown): err is LlmError => {
        if (!(err instanceof LlmError)) return false;
        assert.equal(err.classification.reason, 'SCHEMA_VIOLATION');
        return true;
      },
    );
  });

  // (c) Malformed tool_calls entry — missing function.name → SCHEMA_VIOLATION not UNKNOWN
  void it('(c) throws SCHEMA_VIOLATION (not UNKNOWN) for a tool_calls entry missing function.name', async () => {
    // This body passes the outer schema (choices is an array, items are objects)
    // but the tool_calls entry lacks the required `function.name` field.
    const adapter = new InjectableAdapter({
      'choices': [{
        'message': {
          'content': '',
          'tool_calls': [{
            'id': 'tc1',
            'type': 'function',
            'function': { 'arguments': '{"x":1}' }, // name intentionally omitted
          }],
        },
        'finish_reason': 'tool_calls',
      }],
    });

    const request: ChatRequest = {
      'messages': [{ 'role': 'user', 'content': 'hi' }],
      'tools': [{ 'name': 'test', 'description': 'd', 'inputSchema': {}, 'strict': false }],
      'toolChoice': { 'type': 'auto' },
      'outputSchema': { 'kind': 'none' },
      'maxTokens': 64,
      'temperature': 0.2,
      'signal': new AbortController().signal,
    };

    await assert.rejects(
      () => adapter.chat(request),
      (err: unknown): err is LlmError => {
        if (!(err instanceof LlmError)) return false;
        assert.equal(err.classification.reason, 'SCHEMA_VIOLATION',
          `expected SCHEMA_VIOLATION but got ${err.classification.reason}`);
        assert.equal(err.classification.retryable, false);
        return true;
      },
    );
  });

  // (c) Malformed tool_calls entry — missing id → SCHEMA_VIOLATION
  void it('(c) throws SCHEMA_VIOLATION for a tool_calls entry missing id', async () => {
    const adapter = new InjectableAdapter({
      'choices': [{
        'message': {
          'content': '',
          'tool_calls': [{
            // id intentionally omitted
            'type': 'function',
            'function': { 'name': 'test', 'arguments': '{}' },
          }],
        },
        'finish_reason': 'tool_calls',
      }],
    });

    const request: ChatRequest = {
      'messages': [{ 'role': 'user', 'content': 'hi' }],
      'tools': [{ 'name': 'test', 'description': 'd', 'inputSchema': {}, 'strict': false }],
      'toolChoice': { 'type': 'auto' },
      'outputSchema': { 'kind': 'none' },
      'maxTokens': 64,
      'temperature': 0.2,
      'signal': new AbortController().signal,
    };

    await assert.rejects(
      () => adapter.chat(request),
      (err: unknown): err is LlmError => {
        if (!(err instanceof LlmError)) return false;
        assert.equal(err.classification.reason, 'SCHEMA_VIOLATION');
        return true;
      },
    );
  });
});
