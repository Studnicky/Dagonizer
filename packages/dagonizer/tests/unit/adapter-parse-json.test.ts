/**
 * OpenAiCompatibleAdapter behavior over an injected HTTP response body.
 *
 * Covers, all through an InjectableAdapter that monkey-patches global fetch:
 *  - #decodeJson rejects malformed tool-call arguments with
 *    LlmError(SCHEMA_VIOLATION) instead of silently returning {}.
 *  - Valid tool-call arguments parse into a typed tools message.
 *  - A response without `usage` falls back to ZERO_TOKEN_USAGE.
 *  - Untrusted-input hardening: a schema-valid body parses; non-object and
 *    wrong-typed bodies, and tool_calls entries missing required fields,
 *    reject with SCHEMA_VIOLATION (never UNKNOWN).
 *  - shouldFallbackWithoutTools: default is no fallback; a subclass override
 *    retries tools-free on the chosen classification; fallback is skipped when
 *    the request carries no tools; the config exposes no toolsFallback field.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { AdapterCapabilitiesType, ChatRequestType, ChatResponseType } from '../../src/adapter/LlmAdapter.js';
import { ZERO_TOKEN_USAGE } from '../../src/adapter/LlmAdapter.js';
import { LlmError } from '../../src/adapter/LlmError.js';
import { OpenAiCompatibleAdapter } from '../../src/adapter/OpenAiCompatibleAdapter.js';
import type { OpenAiCompatibleConfigType } from '../../src/adapter/OpenAiCompatibleAdapter.js';

const FULL_CAPS: AdapterCapabilitiesType = { 'toolUse': 'full', 'structuredOutput': true, 'jsonMode': true };
const PARTIAL_CAPS: AdapterCapabilitiesType = { 'toolUse': 'partial', 'structuredOutput': false, 'jsonMode': false };

const FALLBACK_CONFIG: OpenAiCompatibleConfigType = {
  'id': 'test-adapter',
  'displayName': 'Test',
  'capabilities': PARTIAL_CAPS,
  'endpoint': 'https://example.test/v1/chat/completions',
  'modelsEndpoint': 'https://example.test/v1/models',
  'defaultModel': 'test-model',
  'tokenField': 'max_tokens',
  'extraHeaders': {},
  'timeoutMs': 5_000,
};

/** Concrete subclass that injects a raw HTTP response body via monkey-patched fetch. */
class InjectableAdapter extends OpenAiCompatibleAdapter {
  readonly #rawBody: unknown;

  constructor(rawBody: unknown) {
    super('test-key', {
      'id': 'test',
      'displayName': 'Test',
      'capabilities': FULL_CAPS,
      'endpoint': 'https://example.com/v1/chat/completions',
      'modelsEndpoint': 'https://example.com/v1/models',
      'defaultModel': 'test-model',
      'tokenField': 'max_tokens',
      'timeoutMs': 5_000,
      'extraHeaders': {},
    });
    this.#rawBody = rawBody;
  }

  protected override async performChat(request: ChatRequestType): Promise<ChatResponseType> {
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

class TestRequest {
  private constructor() {}
  static withTools(withTools: boolean): ChatRequestType {
    return {
      'messages': [{ 'role': 'user', 'content': 'hi' }],
      'tools': withTools
        ? [{ 'name': 'test', 'description': 'd', 'inputSchema': {}, 'outputSchema': {}, 'strict': false }]
        : [],
      'toolChoice': { 'type': 'auto' },
      'outputSchema': { 'variant': 'none' },
      'maxTokens': 64,
      'temperature': 0.2,
      'signal': new AbortController().signal,
    };
  }
}

class TestResponse {
  private constructor() {}
  static fake(content: string): Response {
    return new Response(JSON.stringify({
      'choices': [{ 'message': { 'content': content }, 'finish_reason': 'stop' }],
      'usage': { 'prompt_tokens': 5, 'completion_tokens': 3 },
    }), { 'status': 200, 'headers': { 'content-type': 'application/json' } });
  }
}

async function withFetch<T>(impl: () => Promise<Response>, fn: () => Promise<T>): Promise<T> {
  const saved = globalThis.fetch;
  globalThis.fetch = impl;
  try { return await fn(); } finally { globalThis.fetch = saved; }
}

/** Default adapter — shouldFallbackWithoutTools returns false. */
class DefaultFallbackAdapter extends OpenAiCompatibleAdapter {
  constructor() { super('key', FALLBACK_CONFIG, { 'maxAttempts': 1 }); }
}

/** Adapter that overrides shouldFallbackWithoutTools for SCHEMA_VIOLATION. */
class FallbackEnabledAdapter extends OpenAiCompatibleAdapter {
  constructor() { super('key', FALLBACK_CONFIG, { 'maxAttempts': 1 }); }

  protected override shouldFallbackWithoutTools(error: unknown): boolean {
    if (error instanceof LlmError) {
      return error.classification.reason === 'SCHEMA_VIOLATION';
    }
    return false;
  }
}

void describe('OpenAiCompatibleAdapter — response parsing and tool-call handling', () => {
  void it('parses a schema-valid text response, content and token usage', async () => {
    const adapter = new InjectableAdapter({
      'choices': [{
        'message': { 'content': 'Hello world', 'tool_calls': [] },
        'finish_reason': 'stop',
      }],
      'usage': { 'prompt_tokens': 5, 'completion_tokens': 3 },
    });

    const resp = await adapter.chat(TestRequest.withTools(false));
    assert.equal(resp.finishReason, 'stop');
    assert.equal(resp.message.variant, 'text');
    if (resp.message.variant === 'text') {
      assert.equal(resp.message.content, 'Hello world');
    }
    assert.deepEqual(resp.usage, { 'promptTokens': 5, 'completionTokens': 3 });
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

    const resp = await adapter.chat(TestRequest.withTools(true));
    assert.equal(resp.finishReason, 'tool_call');
    assert.equal(resp.message.variant, 'tools');
    if (resp.message.variant === 'tools') {
      assert.equal(resp.message.toolCalls.length, 1);
      assert.deepEqual(resp.message.toolCalls[0]?.arguments, { 'query': 'cats' });
    }
  });

  void it('falls back to ZERO_TOKEN_USAGE when the response omits usage', async () => {
    const adapter = new InjectableAdapter({
      'choices': [{
        'message': { 'content': 'hello', 'tool_calls': [] },
        'finish_reason': 'stop',
      }],
    });
    const resp = await adapter.chat(TestRequest.withTools(true));
    assert.deepEqual(resp.usage, ZERO_TOKEN_USAGE);
  });

  void it('rejects malformed tool-call arguments with SCHEMA_VIOLATION', async () => {
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
      () => adapter.chat(TestRequest.withTools(true)),
      (err: unknown): err is LlmError => {
        if (!(err instanceof LlmError)) return false;
        assert.equal(err.classification.reason, 'SCHEMA_VIOLATION');
        assert.equal(err.classification.retryable, false);
        assert.match(err.message, /malformed tool-call arguments/u);
        return true;
      },
    );
  });

  void it('rejects a non-object response body with SCHEMA_VIOLATION', async () => {
    const adapter = new InjectableAdapter('this is not an object');

    await assert.rejects(
      () => adapter.chat(TestRequest.withTools(false)),
      (err: unknown): err is LlmError => {
        if (!(err instanceof LlmError)) return false;
        assert.equal(err.classification.reason, 'SCHEMA_VIOLATION');
        assert.equal(err.classification.retryable, false);
        assert.match(err.message, /schema violation/iu);
        return true;
      },
    );
  });

  void it('rejects when choices is a string instead of an array with SCHEMA_VIOLATION', async () => {
    const adapter = new InjectableAdapter({ 'choices': 'not-an-array' });

    await assert.rejects(
      () => adapter.chat(TestRequest.withTools(false)),
      (err: unknown): err is LlmError => {
        if (!(err instanceof LlmError)) return false;
        assert.equal(err.classification.reason, 'SCHEMA_VIOLATION');
        return true;
      },
    );
  });

  void it('rejects a tool_calls entry missing function.name with SCHEMA_VIOLATION, not UNKNOWN', async () => {
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

    await assert.rejects(
      () => adapter.chat(TestRequest.withTools(true)),
      (err: unknown): err is LlmError => {
        if (!(err instanceof LlmError)) return false;
        assert.equal(err.classification.reason, 'SCHEMA_VIOLATION',
          `expected SCHEMA_VIOLATION but got ${err.classification.reason}`);
        assert.equal(err.classification.retryable, false);
        return true;
      },
    );
  });

  void it('rejects a tool_calls entry missing id with SCHEMA_VIOLATION', async () => {
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

    await assert.rejects(
      () => adapter.chat(TestRequest.withTools(true)),
      (err: unknown): err is LlmError => {
        if (!(err instanceof LlmError)) return false;
        assert.equal(err.classification.reason, 'SCHEMA_VIOLATION');
        return true;
      },
    );
  });
});

void describe('OpenAiCompatibleAdapter shouldFallbackWithoutTools', () => {
  void it('default adapter does not fallback — SCHEMA_VIOLATION propagates after one call', async () => {
    const adapter = new DefaultFallbackAdapter();
    let callCount = 0;

    await assert.rejects(
      () => withFetch(
        async () => {
          callCount++;
          // Provider returns 422 (SCHEMA_VIOLATION) for tools
          return new Response('tools not supported', { 'status': 422 });
        },
        () => adapter.chat(TestRequest.withTools(true)),
      ),
      (err: unknown): err is LlmError => {
        if (!(err instanceof LlmError)) return false;
        assert.equal(err.classification.reason, 'SCHEMA_VIOLATION');
        return true;
      },
    );
    assert.equal(callCount, 1, 'should not retry on non-retryable error');
  });

  void it('subclass override retries tools-free on SCHEMA_VIOLATION and succeeds', async () => {
    const adapter = new FallbackEnabledAdapter();
    let fetchCallCount = 0;

    const resp = await withFetch(
      async () => {
        fetchCallCount++;
        if (fetchCallCount === 1) {
          // First call: 422 triggers shouldFallbackWithoutTools
          return new Response('tools not supported', { 'status': 422 });
        }
        // Second call (without tools): success
        return TestResponse.fake('fallback works');
      },
      () => adapter.chat(TestRequest.withTools(true)),
    );

    assert.equal(fetchCallCount, 2, 'should make exactly 2 fetch calls');
    assert.equal(resp.message.variant, 'text');
    if (resp.message.variant === 'text') {
      assert.equal(resp.message.content, 'fallback works');
    }
  });

  void it('does not fall back when the request carries no tools', async () => {
    const adapter = new FallbackEnabledAdapter();
    let fetchCallCount = 0;

    await assert.rejects(
      () => withFetch(
        async () => {
          fetchCallCount++;
          return new Response('error', { 'status': 422 });
        },
        () => adapter.chat(TestRequest.withTools(false)), // no tools
      ),
      (err: unknown): err is LlmError => {
        if (!(err instanceof LlmError)) return false;
        assert.equal(err.classification.reason, 'SCHEMA_VIOLATION');
        return true;
      },
    );
    // shouldFallbackWithoutTools is only consulted when tools.length > 0
    assert.equal(fetchCallCount, 1, 'fallback not triggered with empty tools');
  });

  void it('OpenAiCompatibleConfigType carries no toolsFallback property', () => {
    const config: OpenAiCompatibleConfigType = { ...FALLBACK_CONFIG };
    assert.ok(!('toolsFallback' in config), 'toolsFallback should not be present on config');
  });
});
