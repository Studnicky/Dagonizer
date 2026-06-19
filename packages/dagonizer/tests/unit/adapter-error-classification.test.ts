/**
 * Tests for the ADP-6 discriminated union on ErrorClassificationType.
 *
 * Verifies:
 *  - Retryable classifications carry `retryAfterMs: number | null`
 *  - Non-retryable classifications have no `retryAfterMs` property
 *  - `classifyHttp` produces correctly shaped results (with and without hint)
 *  - `Classifications` constants have the right shapes
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  Classifications,
  LlmError,
  type ErrorClassificationType,
} from '../../src/adapter/LlmError.js';

void describe('ErrorClassificationType discriminated union (ADP-6)', () => {
  void it('retryable classifications have retryAfterMs: null by default', () => {
    const retryableReasons = ['QUOTA_EXHAUSTED', 'TIMEOUT', 'NETWORK'] as const;
    for (const reason of retryableReasons) {
      const c = Classifications[reason];
      assert.equal(c.retryable, true, `${reason} should be retryable`);
      // TypeScript narrows c.retryable === true, so retryAfterMs is present
      assert.ok('retryAfterMs' in c, `${reason} should have retryAfterMs`);
      assert.equal((c as Extract<ErrorClassificationType, { retryable: true }>).retryAfterMs, null,
        `${reason} retryAfterMs should be null (no hint)`);
    }
  });

  void it('non-retryable classifications have no retryAfterMs property', () => {
    const nonRetryable = ['AUTH_FAILED', 'MODEL_NOT_FOUND', 'CREDIT_EXHAUSTED',
      'SCHEMA_VIOLATION', 'CONFIGURATION', 'NO_ADAPTER_AVAILABLE', 'UNKNOWN'] as const;
    for (const reason of nonRetryable) {
      const c = Classifications[reason];
      assert.equal(c.retryable, false, `${reason} should not be retryable`);
      assert.ok(!('retryAfterMs' in c), `${reason} should not have retryAfterMs`);
    }
  });

  void it('classifyHttp 429 without body hint → retryAfterMs: null', () => {
    const c = LlmError.classifyHttp(429);
    assert.equal(c.reason, 'QUOTA_EXHAUSTED');
    assert.equal(c.retryable, true);
    assert.equal((c as Extract<ErrorClassificationType, { retryable: true }>).retryAfterMs, null);
  });

  void it('classifyHttp 429 with body hint → retryAfterMs: number', () => {
    const c = LlmError.classifyHttp(429, { 'body': '{"retry_after": "30"}' });
    assert.equal(c.reason, 'QUOTA_EXHAUSTED');
    assert.equal(c.retryable, true);
    const retryable = c as Extract<ErrorClassificationType, { retryable: true }>;
    assert.ok(retryable.retryAfterMs !== null, 'should have numeric retryAfterMs hint');
    assert.equal(retryable.retryAfterMs, 30_000);
  });

  void it('classifyHttp non-retryable statuses (4xx non-timeout) have no retryAfterMs', () => {
    // 401, 403 → AUTH_FAILED (non-retryable)
    // 404 → MODEL_NOT_FOUND (non-retryable)
    // 402 → CREDIT_EXHAUSTED (non-retryable)
    // 422 → SCHEMA_VIOLATION (non-retryable)
    // Note: 408 → TIMEOUT (retryable) — not in this list
    const statuses = [401, 403, 404, 402, 422] as const;
    for (const status of statuses) {
      const c = LlmError.classifyHttp(status);
      assert.equal(c.retryable, false, `status ${String(status)} should not be retryable`);
      assert.ok(!('retryAfterMs' in c), `status ${String(status)} should not have retryAfterMs`);
    }
  });

  void it('classifyHttp 408 (request timeout) is retryable with null retryAfterMs', () => {
    const c = LlmError.classifyHttp(408);
    assert.equal(c.reason, 'TIMEOUT');
    assert.equal(c.retryable, true);
    assert.ok('retryAfterMs' in c, '408 TIMEOUT should have retryAfterMs');
    assert.equal((c as Extract<ErrorClassificationType, { retryable: true }>).retryAfterMs, null);
  });

  void it('classifyHttp 5xx produces retryable NETWORK with null retryAfterMs', () => {
    const c = LlmError.classifyHttp(503);
    assert.equal(c.reason, 'NETWORK');
    assert.equal(c.retryable, true);
    assert.equal((c as Extract<ErrorClassificationType, { retryable: true }>).retryAfterMs, null);
  });
});
