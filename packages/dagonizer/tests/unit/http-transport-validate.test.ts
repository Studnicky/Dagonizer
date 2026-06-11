/**
 * Tests for the optional `validate` field added to `HttpRequestOptions`:
 *
 * (d) HttpTransport with a validator rejects a wrong-shaped body as ToolError(PARSE_ERROR).
 * Also verifies: when validate is absent, current behavior is preserved.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { HttpTransport } from '../../src/tool/HttpTransport.js';
import { ToolError } from '../../src/tool/ToolError.js';

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

void describe('HttpTransport — validate option (shape validation)', () => {
  // (d) When validate throws, getJson rethrows as ToolError(PARSE_ERROR)
  void it('(d) rejects a wrong-shaped body with ToolError PARSE_ERROR when validate throws', async () => {
    interface Expected { ok: boolean }

    await assert.rejects(
      () => withFetchPatch(
        async () => new Response(
          JSON.stringify({ 'wrong': 'shape' }),
          { 'status': 200, 'headers': { 'content-type': 'application/json' } },
        ),
        () => HttpTransport.getJson<Expected>('https://example.test/api', {
          validate(value: unknown): Expected {
            const v = value as Record<string, unknown>;
            if (typeof v['ok'] !== 'boolean') {
              throw new Error('missing required field: ok');
            }
            return v as unknown as Expected;
          },
        }),
      ),
      (err: unknown): err is ToolError => {
        if (!(err instanceof ToolError)) return false;
        assert.equal(err.reason, 'PARSE_ERROR');
        assert.equal(err.retryable, false);
        assert.match(err.message, /shape validation/u);
        assert.match(err.message, /missing required field: ok/u);
        return true;
      },
    );
  });

  // (d) When validate passes, getJson returns the validated value
  void it('(d) returns the validated value when it matches expected shape', async () => {
    interface Expected { count: number }

    const result = await withFetchPatch(
      async () => new Response(
        JSON.stringify({ 'count': 42 }),
        { 'status': 200, 'headers': { 'content-type': 'application/json' } },
      ),
      () => HttpTransport.getJson<Expected>('https://example.test/api', {
        validate(value: unknown): Expected {
          const v = value as Record<string, unknown>;
          if (typeof v['count'] !== 'number') throw new Error('count must be number');
          return v as unknown as Expected;
        },
      }),
    );

    assert.equal(result.count, 42);
  });

  // Without validate, existing behavior is preserved (no error for unknown shape)
  void it('preserves existing behavior when validate is absent', async () => {
    const result = await withFetchPatch(
      async () => new Response(
        JSON.stringify({ 'arbitrary': 'data' }),
        { 'status': 200, 'headers': { 'content-type': 'application/json' } },
      ),
      () => HttpTransport.getJson<{ arbitrary: string }>('https://example.test/api'),
    );

    assert.equal(result.arbitrary, 'data');
  });

  // postJson also threads the validate option
  void it('(d) postJson also rejects wrong-shaped body with ToolError PARSE_ERROR', async () => {
    interface Expected { id: string }

    await assert.rejects(
      () => withFetchPatch(
        async () => new Response(
          JSON.stringify({ 'wrong': true }),
          { 'status': 200, 'headers': { 'content-type': 'application/json' } },
        ),
        () => HttpTransport.postJson<Expected>('https://example.test/api', { 'query': 'test' }, {
          validate(value: unknown): Expected {
            const v = value as Record<string, unknown>;
            if (typeof v['id'] !== 'string') throw new Error('id must be string');
            return v as unknown as Expected;
          },
        }),
      ),
      (err: unknown): err is ToolError => {
        if (!(err instanceof ToolError)) return false;
        assert.equal(err.reason, 'PARSE_ERROR');
        return true;
      },
    );
  });
});
