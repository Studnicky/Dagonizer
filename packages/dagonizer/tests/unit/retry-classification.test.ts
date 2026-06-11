import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Classifications, LlmError } from '../../src/adapter/LlmError.js';
import { RetryableErrorPolicy } from '../../src/adapter/RetryableErrorPolicy.js';
import { BackoffStrategy } from '../../src/runtime/index.js';

const policy = (): RetryableErrorPolicy =>
  RetryableErrorPolicy.from({ 'maxAttempts': 3, 'strategy': BackoffStrategy.EXPONENTIAL, 'baseDelay': 0 });

void describe('RetryableErrorPolicy honors LlmError.classification.retryable', () => {
  void it('does NOT retry a non-retryable LlmError (exactly one attempt)', async () => {
    let calls = 0;
    await assert.rejects(
      () => policy().run(async () => {
        calls += 1;
        throw new LlmError('auth failed', Classifications['AUTH_FAILED']);
      }),
      LlmError,
    );
    assert.equal(calls, 1, 'non-retryable error must not be retried');
  });

  void it('retries a retryable LlmError up to maxAttempts', async () => {
    let calls = 0;
    await assert.rejects(
      () => policy().run(async () => {
        calls += 1;
        throw new LlmError('network blip', Classifications['NETWORK']);
      }),
      LlmError,
    );
    assert.equal(calls, 3, 'retryable error is attempted maxAttempts times');
  });

  void it('falls back to default behavior for non-LlmError errors', async () => {
    let calls = 0;
    await assert.rejects(
      () => policy().run(async () => {
        calls += 1;
        throw new Error('plain');
      }),
    );
    assert.equal(calls, 3, 'plain errors use the base retry behavior');
  });
});
