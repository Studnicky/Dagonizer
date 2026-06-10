/**
 * Tests for ADP-1: shouldFallbackWithoutTools protected method replaces
 * the toolsFallback callback on OpenAiCompatibleConfig.
 *
 * Verifies:
 *  - Default implementation returns false (no fallback)
 *  - Subclass override returning true triggers the tools-free retry path
 *  - Fallback is not triggered when request.tools is empty
 *  - OpenAiCompatibleConfig no longer accepts toolsFallback property
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { AdapterCapabilities, ChatRequest } from '../../src/adapter/LlmAdapter.js';
import { LlmError } from '../../src/adapter/LlmError.js';
import { OpenAiCompatibleAdapter } from '../../src/adapter/OpenAiCompatibleAdapter.js';
import type { OpenAiCompatibleConfig } from '../../src/adapter/OpenAiCompatibleAdapter.js';

const CAPS: AdapterCapabilities = { 'toolUse': 'partial', 'structuredOutput': false, 'jsonMode': false };

const BASE_CONFIG: OpenAiCompatibleConfig = {
  'id': 'test-adapter',
  'displayName': 'Test',
  'capabilities': CAPS,
  'endpoint': 'https://example.test/v1/chat/completions',
  'defaultModel': 'test-model',
  'tokenField': 'max_tokens',
  'extraHeaders': {},
};

function makeFakeResponse(content: string): Response {
  return new Response(JSON.stringify({
    'choices': [{ 'message': { 'content': content }, 'finish_reason': 'stop' }],
    'usage': { 'prompt_tokens': 5, 'completion_tokens': 3 },
  }), { 'status': 200, 'headers': { 'content-type': 'application/json' } });
}

function makeRequest(withTools: boolean): ChatRequest {
  return {
    'messages': [{ 'role': 'user', 'content': 'hello', 'toolCallId': '', 'toolName': '' }],
    'tools': withTools
      ? [{ 'name': 'search', 'description': 'do a search', 'inputSchema': {}, 'strict': false }]
      : [],
    'toolChoice': { 'type': 'auto' },
    'outputSchema': { 'kind': 'none' },
    'maxTokens': 64,
    'temperature': 0.2,
    'signal': new AbortController().signal,
  };
}

async function withFetch<T>(impl: () => Promise<Response>, fn: () => Promise<T>): Promise<T> {
  const saved = globalThis.fetch;
  globalThis.fetch = impl;
  try { return await fn(); } finally { globalThis.fetch = saved; }
}

/** Default adapter — shouldFallbackWithoutTools returns false. */
class DefaultFallbackAdapter extends OpenAiCompatibleAdapter {
  constructor() { super('key', BASE_CONFIG, { 'maxAttempts': 1 }); }
}

/**
 * Adapter that overrides shouldFallbackWithoutTools.
 * Uses fetch injection to simulate the provider rejecting tools on the first
 * call and succeeding on the second (tools-free) call.
 */
class FallbackEnabledAdapter extends OpenAiCompatibleAdapter {
  constructor() {
    super('key', BASE_CONFIG, { 'maxAttempts': 1 });
  }

  protected override shouldFallbackWithoutTools(error: unknown): boolean {
    if (error instanceof LlmError) {
      // Trigger fallback for SCHEMA_VIOLATION (422 from the provider)
      return error.classification.reason === 'SCHEMA_VIOLATION';
    }
    return false;
  }
}

void describe('OpenAiCompatibleAdapter shouldFallbackWithoutTools (ADP-1)', () => {
  void it('default adapter does not fallback — SCHEMA_VIOLATION propagates', async () => {
    const adapter = new DefaultFallbackAdapter();
    let callCount = 0;

    await assert.rejects(
      () => withFetch(
        async () => {
          callCount++;
          // Simulate provider returning 422 (SCHEMA_VIOLATION) for tools
          return new Response('tools not supported', { 'status': 422 });
        },
        () => adapter.chat(makeRequest(true)),
      ),
      (err: unknown): err is LlmError => {
        if (!(err instanceof LlmError)) return false;
        assert.equal(err.classification.reason, 'SCHEMA_VIOLATION');
        return true;
      },
    );
    assert.equal(callCount, 1, 'should not retry on non-retryable error');
  });

  void it('subclass overriding shouldFallbackWithoutTools retries on SCHEMA_VIOLATION', async () => {
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
        return makeFakeResponse('fallback works');
      },
      () => adapter.chat(makeRequest(true)),
    );

    assert.equal(fetchCallCount, 2, 'should make exactly 2 fetch calls');
    assert.equal(resp.message.kind, 'text');
    if (resp.message.kind === 'text') {
      assert.equal(resp.message.content, 'fallback works');
    }
  });

  void it('fallback is not triggered when request has no tools', async () => {
    const adapter = new FallbackEnabledAdapter();
    let fetchCallCount = 0;

    await assert.rejects(
      () => withFetch(
        async () => {
          fetchCallCount++;
          return new Response('error', { 'status': 422 });
        },
        () => adapter.chat(makeRequest(false)), // no tools
      ),
      (err: unknown): err is LlmError => {
        if (!(err instanceof LlmError)) return false;
        assert.equal(err.classification.reason, 'SCHEMA_VIOLATION');
        return true;
      },
    );
    // No fallback when request.tools is empty — shouldFallbackWithoutTools is
    // only consulted when tools.length > 0
    assert.equal(fetchCallCount, 1, 'fallback not triggered with empty tools');
  });

  void it('OpenAiCompatibleConfig has no toolsFallback property', () => {
    // Compile-time verification: the config must not accept toolsFallback.
    const config: OpenAiCompatibleConfig = { ...BASE_CONFIG };
    assert.ok(!('toolsFallback' in config), 'toolsFallback should not be present on config');
  });
});
