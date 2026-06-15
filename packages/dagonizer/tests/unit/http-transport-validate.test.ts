/**
 * Tests for HttpTransport shape-validation behavior.
 *
 * `HttpRequestOptions` carries no `validate` callback — shape validation is
 * the caller's responsibility in their own domain layer.
 * These tests verify that getJson/postJson return the parsed JSON typed as
 * `TResponse` so the caller can narrow it, and that unknown/wrong shapes
 * are returned unmodified (no transport-level validation error).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { HttpTransport } from '../../src/tool/HttpTransport.js';

/** Monkey-patch globalThis.fetch for one test, restore after. */
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

  // Existing behavior: no options required.
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
