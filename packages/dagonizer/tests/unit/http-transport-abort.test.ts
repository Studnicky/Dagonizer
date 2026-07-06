/**
 * HttpTransport behavior over a monkey-patched global fetch.
 *
 * Abort-aware backoff (ADP-4):
 *  - An already-aborted signal at backoff time rejects immediately, no hang.
 *  - Aborting during the backoff sleep rejects before the full delay elapses.
 *  - Retries still work when no signal is provided.
 *
 * Schema-backed shape validation:
 *  - getJson/postJson require an `EntityValidatorInterface` and narrow the parsed JSON
 *    body to its derived type before returning.
 *  - A wrong-shaped body throws a non-retryable `ToolError(PARSE_ERROR)`.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { CircuitBreaker, TokenBucket } from '@studnicky/resilience';

import { HttpTransport } from '../../src/tool/HttpTransport.js';
import { ToolError } from '../../src/tool/ToolError.js';
import type { EntityValidatorInterface } from '../../src/validation/Validator.js';

/** Patches globalThis.fetch for one test, restoring it after. */
class FetchPatch {
  static async with<T>(
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
}

/**
 * Builds a minimal structural `EntityValidatorInterface<T>` for tests: narrows a
 * body that contains every key of `keys`. Mirrors the shape predicate a compiled
 * `Validator.<entity>` exposes without pulling a full Ajv schema into the
 * test fixture.
 */
class KeyValidatorFixture {
  static of<T>(keys: readonly string[]): EntityValidatorInterface<T> {
    const matches = (value: unknown): value is T =>
      typeof value === 'object' && value !== null && keys.every((k) => k in value);
    return {
      'is': matches,
      'validate'(value): T {
        if (matches(value)) return value;
        throw new Error('invalid');
      },
      'errors'(value): string[] | null {
        return matches(value) ? null : [`<root>: missing one of ${keys.join(', ')}`];
      },
    };
  }
}

class CountingTokenBucket extends TokenBucket {
  acquisitions = 0;

  private constructor() {
    super({ 'requestsPerSecond': 1_000, 'burstSize': 10 });
  }

  static of(): CountingTokenBucket {
    return new CountingTokenBucket();
  }

  protected override onTokenAcquired(): void {
    this.acquisitions++;
  }
}

void describe('HttpTransport abort-aware sleep (ADP-4)', () => {
  void it('pre-aborted signal causes rejection during backoff without hang', async () => {
    let callCount = 0;
    const controller = new AbortController();
    controller.abort(); // abort before the request even starts

    await assert.rejects(
      () => FetchPatch.with(
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
      () => FetchPatch.with(
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
    const result = await FetchPatch.with(
      async () => new Response(JSON.stringify({ 'ok': true }), { 'status': 200, 'headers': { 'content-type': 'application/json' } }),
      () => HttpTransport.getJson<{ ok: boolean }>('https://example.test/api', KeyValidatorFixture.of<{ ok: boolean }>(['ok'])),
    );
    assert.equal(result.ok, true);
  });

  void it('retries transient 503 without a signal and eventually throws', async () => {
    let callCount = 0;
    await assert.rejects(
      () => FetchPatch.with(
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

void describe('HttpTransport — schema-backed shape validation', () => {
  // The validator narrows the parsed body to its derived type.
  void it('returns the body narrowed by the validator', async () => {
    interface Expected { count: number }

    const result = await FetchPatch.with(
      async () => new Response(
        JSON.stringify({ 'count': 42 }),
        { 'status': 200, 'headers': { 'content-type': 'application/json' } },
      ),
      () => HttpTransport.getJson<Expected>('https://example.test/api', KeyValidatorFixture.of<Expected>(['count'])),
    );

    assert.equal(result.count, 42);
  });

  // Wrong-shaped body now throws a non-retryable PARSE_ERROR.
  void it('throws ToolError(PARSE_ERROR) on a shape mismatch', async () => {
    interface Expected { ok: boolean }

    await assert.rejects(
      () => FetchPatch.with(
        async () => new Response(
          JSON.stringify({ 'wrong': 'shape' }),
          { 'status': 200, 'headers': { 'content-type': 'application/json' } },
        ),
        () => HttpTransport.getJson<Expected>('https://example.test/api', KeyValidatorFixture.of<Expected>(['ok'])),
      ),
      (err: unknown): err is ToolError => {
        if (!(err instanceof ToolError)) return false;
        assert.equal(err.reason, 'PARSE_ERROR');
        assert.equal(err.retryable, false);
        return true;
      },
    );
  });

  // postJson narrows the parsed body through the validator too.
  void it('postJson returns the body narrowed by the validator', async () => {
    interface Expected { id: string }

    const result = await FetchPatch.with(
      async () => new Response(
        JSON.stringify({ 'id': 'abc-123' }),
        { 'status': 200, 'headers': { 'content-type': 'application/json' } },
      ),
      () => HttpTransport.postJson<Expected>('https://example.test/api', { 'query': 'test' }, KeyValidatorFixture.of<Expected>(['id'])),
    );

    assert.equal(result.id, 'abc-123');
  });

  // No options required beyond the validator.
  void it('works without any options (all defaults)', async () => {
    interface Expected { arbitrary: string }

    const result = await FetchPatch.with(
      async () => new Response(
        JSON.stringify({ 'arbitrary': 'data' }),
        { 'status': 200, 'headers': { 'content-type': 'application/json' } },
      ),
      () => HttpTransport.getJson<Expected>('https://example.test/api', KeyValidatorFixture.of<Expected>(['arbitrary'])),
    );

    assert.equal(result.arbitrary, 'data');
  });
});

void describe('HttpTransport — substrate resilience knobs', () => {
  void it('token bucket is acquired once per logical request, not once per retry attempt', async () => {
    let callCount = 0;
    const tokenBucket = CountingTokenBucket.of();

    const result = await FetchPatch.with(
      async () => {
        callCount++;
        if (callCount === 1) return new Response('transient', { 'status': 503 });
        return new Response(JSON.stringify({ 'ok': true }), { 'status': 200, 'headers': { 'content-type': 'application/json' } });
      },
      () => HttpTransport.getJson<{ ok: boolean }>(
        'https://example.test/api',
        KeyValidatorFixture.of<{ ok: boolean }>(['ok']),
        { 'maxRetries': 1, 'baseBackoffMs': 1, 'maxBackoffMs': 1, tokenBucket },
      ),
    );

    assert.equal(result.ok, true);
    assert.equal(callCount, 2);
    assert.equal(tokenBucket.acquisitions, 1);
  });

  void it('open circuit breaker rejects without invoking fetch', async () => {
    let callCount = 0;
    const circuitBreaker = CircuitBreaker.create({ 'failureThreshold': 1, 'resetTimeoutMs': 60_000 });
    circuitBreaker.forceOpen();

    await assert.rejects(
      () => FetchPatch.with(
        async () => {
          callCount++;
          return new Response(JSON.stringify({ 'ok': true }), { 'status': 200 });
        },
        () => HttpTransport.request('https://example.test/api', {}, { circuitBreaker }),
      ),
      (err: unknown): boolean => {
        assert.equal((err as Error).name, 'CircuitBreakerOpenError');
        return true;
      },
    );

    assert.equal(callCount, 0);
  });
});
