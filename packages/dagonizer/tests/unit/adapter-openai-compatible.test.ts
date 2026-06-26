/**
 * Tests for OpenAiCompatibleAdapter request-body shape and preset behavior.
 *
 * Covers:
 *  1. Per-preset token field: groq + cerebras post `max_completion_tokens`;
 *     mistral + openRouter post `max_tokens`. Neither preset sends the
 *     other field. This is load-bearing: Cerebras rejects `max_tokens`;
 *     Mistral has no `max_completion_tokens`.
 *  2. systemPrompt seam: a configured default injects a leading system
 *     message; a caller-supplied system message is never overridden.
 *  3. timeoutMs → TIMEOUT (the timeout controller aborts the fetch with a
 *     TIMEOUT-classified LlmError; the catch block preserves it unchanged).
 *
 * Every test stubs `globalThis.fetch` to capture the POST body and return
 * a minimal OpenAI-shaped response. The original fetch is restored in a
 * `finally` block regardless of outcome.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ChatRequestBuilder, Classifications, LlmError, OpenAiCompatibleAdapter } from '../../src/adapter/index.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Minimal valid OpenAI chat-completions response the adapter accepts. */
const MINIMAL_RESPONSE = JSON.stringify({
  'choices': [{ 'message': { 'content': 'ok' }, 'finish_reason': 'stop' }],
  'usage': { 'prompt_tokens': 1, 'completion_tokens': 1 },
});

/** A fetch stub that records the parsed POST body and returns a 200 with MINIMAL_RESPONSE. */
class CapturingFetch {
  capturedBody: Record<string, unknown> | null = null;

  stub(): typeof globalThis.fetch {
    return async (_input, init) => {
      const raw: unknown = JSON.parse(typeof init?.body === 'string' ? init.body : '{}');
      if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
        this.capturedBody = raw as Record<string, unknown>;
      }
      return new Response(MINIMAL_RESPONSE, {
        'status': 200,
        'headers': { 'content-type': 'application/json' },
      });
    };
  }
}

/** Run `fn` with the global fetch replaced by `stub`; restore in finally. */
async function withFetch<T>(
  stub: typeof globalThis.fetch,
  fn: () => Promise<T>,
): Promise<T> {
  const saved = globalThis.fetch;
  globalThis.fetch = stub;
  try {
    return await fn();
  } finally {
    globalThis.fetch = saved;
  }
}

/** A minimal ChatRequestType with 256 maxTokens and no tools. */
function baseRequest() {
  return ChatRequestBuilder.from({
    'messages': [{ 'role': 'user', 'content': 'Hello.' }],
    'maxTokens': 256,
  });
}

// ── 1. Per-preset token field ─────────────────────────────────────────────────

void describe('OpenAiCompatibleAdapter — per-preset token field', () => {
  void it('groq posts max_completion_tokens and omits max_tokens', async () => {
    const adapter = OpenAiCompatibleAdapter.groq('test-key');
    const cf = new CapturingFetch();

    await withFetch(cf.stub(), () => adapter.chat(baseRequest()));

    assert.ok(cf.capturedBody !== null, 'fetch must have been called');
    assert.equal(cf.capturedBody['max_completion_tokens'], 256, 'groq must use max_completion_tokens');
    assert.ok(!('max_tokens' in cf.capturedBody), 'groq must not send max_tokens');
  });

  void it('cerebras posts max_completion_tokens and omits max_tokens', async () => {
    const adapter = OpenAiCompatibleAdapter.cerebras('test-key');
    const cf = new CapturingFetch();

    await withFetch(cf.stub(), () => adapter.chat(baseRequest()));

    assert.ok(cf.capturedBody !== null, 'fetch must have been called');
    assert.equal(cf.capturedBody['max_completion_tokens'], 256, 'cerebras must use max_completion_tokens');
    assert.ok(!('max_tokens' in cf.capturedBody), 'cerebras must not send max_tokens');
  });

  void it('mistral posts max_tokens and omits max_completion_tokens', async () => {
    const adapter = OpenAiCompatibleAdapter.mistral('test-key');
    const cf = new CapturingFetch();

    await withFetch(cf.stub(), () => adapter.chat(baseRequest()));

    assert.ok(cf.capturedBody !== null, 'fetch must have been called');
    assert.equal(cf.capturedBody['max_tokens'], 256, 'mistral must use max_tokens');
    assert.ok(!('max_completion_tokens' in cf.capturedBody), 'mistral must not send max_completion_tokens');
  });

  void it('openRouter posts max_tokens and omits max_completion_tokens', async () => {
    const adapter = OpenAiCompatibleAdapter.openRouter('test-key');
    const cf = new CapturingFetch();

    await withFetch(cf.stub(), () => adapter.chat(baseRequest()));

    assert.ok(cf.capturedBody !== null, 'fetch must have been called');
    assert.equal(cf.capturedBody['max_tokens'], 256, 'openRouter must use max_tokens');
    assert.ok(!('max_completion_tokens' in cf.capturedBody), 'openRouter must not send max_completion_tokens');
  });
});

// ── 2. systemPrompt seam ──────────────────────────────────────────────────────

void describe('OpenAiCompatibleAdapter — systemPrompt seam', () => {
  void it('injects a leading system message when none is in the request', async () => {
    const adapter = OpenAiCompatibleAdapter.groq('test-key', { 'systemPrompt': 'You are X.' });
    const cf = new CapturingFetch();

    await withFetch(cf.stub(), () => adapter.chat(
      ChatRequestBuilder.from({ 'messages': [{ 'role': 'user', 'content': 'Hello.' }] }),
    ));

    assert.ok(cf.capturedBody !== null, 'fetch must have been called');
    const messages = cf.capturedBody['messages'];
    assert.ok(Array.isArray(messages), 'messages must be an array');
    const first = messages[0] as Record<string, unknown>;
    assert.equal(first['role'], 'system', 'first message must be system');
    assert.equal(first['content'], 'You are X.', 'system content must match configured prompt');
  });

  void it('does not override an explicit caller system message', async () => {
    const adapter = OpenAiCompatibleAdapter.groq('test-key', { 'systemPrompt': 'Default.' });
    const cf = new CapturingFetch();

    await withFetch(cf.stub(), () => adapter.chat(
      ChatRequestBuilder.from({
        'messages': [
          { 'role': 'system', 'content': 'Caller persona.' },
          { 'role': 'user',   'content': 'Hello.' },
        ],
      }),
    ));

    assert.ok(cf.capturedBody !== null, 'fetch must have been called');
    const messages = cf.capturedBody['messages'];
    assert.ok(Array.isArray(messages), 'messages must be an array');
    assert.equal(messages.length, 2, 'must not inject a second system message');
    const first = messages[0] as Record<string, unknown>;
    assert.equal(first['content'], 'Caller persona.', 'caller system message must be preserved unchanged');
  });
});

// ── 3. timeoutMs fires → TIMEOUT (classified abort reason preserved) ──────────

void describe('OpenAiCompatibleAdapter — timeoutMs abort path', () => {
  void it('rejects with LlmError TIMEOUT when the fetch hangs past timeoutMs', async () => {
    // Single attempt (maxAttempts: 1) so the retry policy does not obscure
    // the classification. timeoutMs: 1 fires almost immediately.
    const adapter = OpenAiCompatibleAdapter.groq('test-key', {
      'timeoutMs': 1,
    });

    // A fetch stub that honors the abort signal: blocks until the signal
    // fires, then rejects with the signal's reason.
    const hangingFetch: typeof globalThis.fetch = (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (signal === undefined || signal === null) {
          // No signal — hang forever (the timeout will fire from the adapter).
          return;
        }
        if (signal.aborted) {
          reject(signal.reason instanceof Error ? signal.reason : new Error(String(signal.reason)));
          return;
        }
        signal.addEventListener('abort', () => {
          reject(signal.reason instanceof Error ? signal.reason : new Error(String(signal.reason)));
        }, { 'once': true });
      });

    await assert.rejects(
      () => withFetch(hangingFetch, () => adapter.chat(baseRequest())),
      (err: unknown): err is LlmError => {
        if (!(err instanceof LlmError)) return false;
        // The timeout AbortController fires with Classifications['TIMEOUT'] as its reason.
        // #sendRequest re-throws an already-classified LlmError unchanged (only a
        // genuine transport failure routes through ofNetworkError → NETWORK), so the
        // final surfaced classification is TIMEOUT.
        assert.equal(
          err.classification.reason,
          Classifications['TIMEOUT'].reason,
          `expected TIMEOUT but got ${err.classification.reason}`,
        );
        assert.equal(err.classification.retryable, true, 'TIMEOUT is retryable');
        return true;
      },
    );
  });
});
