/**
 * Tests for ADP-4: abort-aware backoff sleep in HttpTransport.
 *
 * Verifies:
 *  - An already-aborted signal at backoff time produces an immediate rejection
 *  - Aborting during the backoff sleep rejects without waiting the full delay
 *  - Normal retries still work when no signal is provided
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
