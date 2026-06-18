/**
 * HttpTransport behavior over a monkey-patched global fetch.
 *
 * Abort-aware backoff (ADP-4):
 *  - An already-aborted signal at backoff time rejects immediately, no hang.
 *  - Aborting during the backoff sleep rejects before the full delay elapses.
 *  - Retries still work when no signal is provided.
 *
 * Caller-side shape validation:
 *  - HttpRequestOptions carries no `validate` callback; getJson/postJson return
 *    the parsed JSON typed as TResponse for the caller to narrow.
 *  - Wrong-shaped bodies are returned unmodified (no transport-level error).
 *  - getJson works with no options (all defaults).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { HttpTransport } from '../../src/tool/HttpTransport.js';
import { ToolError } from '../../src/tool/ToolError.js';

/** Patch globalThis.fetch for one test, restore after. */
async function withFetchPatch<T>(
  impl: () => Promise<Response>,
  fn: () => Promise<T>,
): Promise<T> {
  const saved = globalThis.fetch;
  globalThis.fetch = impl;
  try {
    return await fn();
  } finally {
    globalThis.fetch = saved;
  }
}

void describe('HttpTransport abort-aware sleep (ADP-4)', () => {
  void it('pre-aborted signal causes rejection during backoff without hang', async () => {
    let callCount = 0;
    const controller = new AbortController();
    controller.abort(); // abort before the request even starts

    await assert.rejects(
      () => withFetchPatch(
        async () => {
          callCount++;
          // Always return 503 to trigger retry + backoff
          return new Response('server error', { 'status': 503 });
        },
        () => HttpTransport.request('https://example.test/api', {}, { 'signal': controller.signal, 'maxRetries': 2 }),
      ),
      (err: unknown): err is ToolError => {
        if (!(err instanceof ToolError)) return false;
        // Should fail fast — either on the abort check or during backoff
        return true;
      },
    );
    // With a pre-aborted signal the request may not even proceed to backoff —
    // either path is correct as long as we don't hang.
    assert.ok(callCount <= 1, 'should not retry a pre-aborted request');
  });

  void it('abort during backoff rejects without waiting full delay', async () => {
    let callCount = 0;
    const controller = new AbortController();

    // Abort after a short delay (well under the base backoff of 400ms)
    setTimeout(() => { controller.abort(); }, 50);

    const start = Date.now();
    await assert.rejects(
      () => withFetchPatch(
        async () => {
          callCount++;
          return new Response('oops', { 'status': 503 });
        },
        () => HttpTransport.request('https://example.test/api', {}, { 'signal': controller.signal, 'maxRetries': 3, 'timeoutMs': 5_000 }),
      ),
      (err: unknown): err is ToolError => {
        return err instanceof ToolError;
      },
    );
    const elapsed = Date.now() - start;
    // Should resolve in well under 400ms (the base backoff) because the abort fires at ~50ms
    assert.ok(elapsed < 380, `expected fast abort, got ${String(elapsed)}ms`);
    // At least one call was made before abort during backoff
    assert.ok(callCount >= 1, 'at least one fetch call should have been made');
  });

  void it('request succeeds on first try without signal', async () => {
    const result = await withFetchPatch(
      async () => new Response(JSON.stringify({ 'ok': true }), { 'status': 200, 'headers': { 'content-type': 'application/json' } }),
      () => HttpTransport.getJson<{ ok: boolean }>('https://example.test/api'),
    );
    assert.equal(result.ok, true);
  });

  void it('retries transient 503 without a signal and eventually throws', async () => {
    let callCount = 0;
    await assert.rejects(
      () => withFetchPatch(
        async () => {
          callCount++;
          return new Response('error', { 'status': 503 });
        },
        () => HttpTransport.request('https://example.test/api', {}, { 'maxRetries': 1, 'timeoutMs': 5_000 }),
      ),
      (err: unknown): err is ToolError => {
        if (!(err instanceof ToolError)) return false;
        assert.equal(err.retryable, true);
        return true;
      },
    );
    assert.equal(callCount, 2); // initial + 1 retry
  });
});

void describe('HttpTransport — caller-side shape validation', () => {
  // Caller receives the raw parsed JSON and can narrow it themselves.
  void it('returns parsed JSON as TResponse for the caller to narrow', async () => {
    interface Expected { count: number }

    const result = await withFetchPatch(
      async () => new Response(
        JSON.stringify({ 'count': 42 }),
        { 'status': 200, 'headers': { 'content-type': 'application/json' } },
      ),
      () => HttpTransport.getJson<Expected>('https://example.test/api'),
    );

    assert.equal(result.count, 42);
  });

  // Wrong-shaped body is returned as-is; caller must validate.
  void it('returns wrong-shaped body without error — validation is caller responsibility', async () => {
    interface Expected { ok: boolean }

    const result = await withFetchPatch(
      async () => new Response(
        JSON.stringify({ 'wrong': 'shape' }),
        { 'status': 200, 'headers': { 'content-type': 'application/json' } },
      ),
      () => HttpTransport.getJson<Expected>('https://example.test/api'),
    );

    // Shape is wrong but HttpTransport does not validate; the caller receives
    // the raw parsed object typed as TResponse.
    assert.deepEqual(result, { 'wrong': 'shape' });
  });

  // postJson also returns parsed JSON without transport-level shape checking.
  void it('postJson returns parsed JSON as TResponse', async () => {
    interface Expected { id: string }

    const result = await withFetchPatch(
      async () => new Response(
        JSON.stringify({ 'id': 'abc-123' }),
        { 'status': 200, 'headers': { 'content-type': 'application/json' } },
      ),
      () => HttpTransport.postJson<Expected>('https://example.test/api', { 'query': 'test' }),
    );

    assert.equal(result.id, 'abc-123');
  });

  // No options required.
  void it('works without any options (all defaults)', async () => {
    const result = await withFetchPatch(
      async () => new Response(
        JSON.stringify({ 'arbitrary': 'data' }),
        { 'status': 200, 'headers': { 'content-type': 'application/json' } },
      ),
      () => HttpTransport.getJson<{ arbitrary: string }>('https://example.test/api'),
    );

    assert.equal(result.arbitrary, 'data');
  });
});
