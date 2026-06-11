/**
 * Tests for ADP-5: #parseJson throws LlmError(SCHEMA_VIOLATION) on malformed
 * tool-call arguments instead of silently returning {}.
 *
 * We test this indirectly via a concrete OpenAiCompatibleAdapter subclass
 * that feeds a response with malformed JSON arguments through performChat().
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { AdapterCapabilities, ChatRequest, ChatResponse } from '../../src/adapter/LlmAdapter.js';
import { ZERO_TOKEN_USAGE } from '../../src/adapter/LlmAdapter.js';
import { LlmError } from '../../src/adapter/LlmError.js';
import { OpenAiCompatibleAdapter } from '../../src/adapter/OpenAiCompatibleAdapter.js';

const CAPS: AdapterCapabilities = { 'toolUse': 'full', 'structuredOutput': true, 'jsonMode': true };

/** Concrete subclass that intercepts fetch via a patched request method. */
class InjectableAdapter extends OpenAiCompatibleAdapter {
  #resolveWith: unknown;

  constructor(responseBody: unknown) {
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
    this.#resolveWith = responseBody;
  }

  /** Override performChat to bypass actual HTTP — call parseResponse via inherited path. */
  protected override async performChat(request: ChatRequest): Promise<ChatResponse> {
    // Simulate what #parseResponse does — it's private, so we trigger it by
    // calling the parent performChat through a mocked fetch. We monkey-patch
    // global fetch for this single call.
    const body = this.#resolveWith;
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
    'tools': [{ 'name': 'test', 'description': 'd', 'inputSchema': {}, 'strict': false }],
    'toolChoice': { 'type': 'auto' },
    'outputSchema': { 'kind': 'none' },
    'maxTokens': 64,
    'temperature': 0.2,
    'signal': new AbortController().signal,
  };
}

void describe('OpenAiCompatibleAdapter #parseJson (ADP-5)', () => {
  void it('throws SCHEMA_VIOLATION when tool-call arguments are malformed JSON', async () => {
    const adapter = new InjectableAdapter({
      'choices': [{
        'message': {
          'content': '',
          'tool_calls': [{
            'id': 'tc1',
            'type': 'function',
            'function': { 'name': 'test', 'arguments': '{ invalid json !' },
          }],
        },
        'finish_reason': 'tool_calls',
      }],
      'usage': { 'prompt_tokens': 10, 'completion_tokens': 5 },
    });

    await assert.rejects(
      () => adapter.chat(makeRequest()),
      (err: unknown): err is LlmError => {
        if (!(err instanceof LlmError)) return false;
        assert.equal(err.classification.reason, 'SCHEMA_VIOLATION');
        assert.equal(err.classification.retryable, false);
        assert.match(err.message, /malformed tool-call arguments/u);
        return true;
      },
    );
  });

  void it('succeeds when tool-call arguments are valid JSON', async () => {
    const adapter = new InjectableAdapter({
      'choices': [{
        'message': {
          'content': '',
          'tool_calls': [{
            'id': 'tc1',
            'type': 'function',
            'function': { 'name': 'test', 'arguments': '{"query":"cats"}' },
          }],
        },
        'finish_reason': 'tool_calls',
      }],
      'usage': { 'prompt_tokens': 10, 'completion_tokens': 5 },
    });

    const resp = await adapter.chat(makeRequest());
    assert.equal(resp.finishReason, 'tool_call');
    assert.equal(resp.message.kind, 'tools');
    if (resp.message.kind === 'tools') {
      assert.equal(resp.message.toolCalls.length, 1);
      assert.deepEqual(resp.message.toolCalls[0]?.arguments, { 'query': 'cats' });
    }
  });

  void it('empty response without usage falls back to ZERO_TOKEN_USAGE', async () => {
    const adapter = new InjectableAdapter({
      'choices': [{
        'message': { 'content': 'hello', 'tool_calls': [] },
        'finish_reason': 'stop',
      }],
    });
    const resp = await adapter.chat(makeRequest());
    assert.deepEqual(resp.usage, ZERO_TOKEN_USAGE);
  });
});
