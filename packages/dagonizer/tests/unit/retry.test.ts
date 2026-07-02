import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { BackoffStrategyNames } from '../../src/entities/runtime/BackoffStrategy.js';
import { DAGError } from '../../src/errors/DAGError.js';
import { RetryPolicy } from '../../src/runtime/RetryPolicy.js';

class TransientError extends Error { constructor() { super('transient'); } }
class FatalError extends Error { constructor() { super('fatal'); } }

void describe('RetryPolicy.getDelay backoff math', () => {
  void it('constant strategy returns baseDelay on every attempt', () => {
    const p = RetryPolicy.from({ "strategy": BackoffStrategyNames.CONSTANT, "baseDelay": 500, "jitterFactor": 0 });
    assert.equal(p.getDelay(1), 500);
    assert.equal(p.getDelay(2), 500);
    assert.equal(p.getDelay(5), 500);
  });

  void it('linear strategy scales delay with the attempt number', () => {
    const p = RetryPolicy.from({ "strategy": BackoffStrategyNames.LINEAR, "baseDelay": 100, "jitterFactor": 0 });
    assert.equal(p.getDelay(1), 100);
    assert.equal(p.getDelay(2), 200);
    assert.equal(p.getDelay(3), 300);
  });

  void it('exponential strategy multiplies the base by multiplier^(attempt-1)', () => {
    const p = RetryPolicy.from({ "strategy": BackoffStrategyNames.EXPONENTIAL, "baseDelay": 100, "multiplier": 2, "jitterFactor": 0 });
    assert.equal(p.getDelay(1), 100);
    assert.equal(p.getDelay(2), 200);
    assert.equal(p.getDelay(3), 400);
  });

  void it('clamps the computed delay at maxDelay', () => {
    const p = RetryPolicy.from({ "strategy": BackoffStrategyNames.EXPONENTIAL, "baseDelay": 100, "maxDelay": 250, "jitterFactor": 0 });
    // attempt 1 (100) is under the cap; attempt 5 (1600) is clamped to 250.
    assert.equal(p.getDelay(1), 100);
    assert.equal(p.getDelay(5), 250);
  });
});

void describe('RetryPolicy.shouldRetry filtering', () => {
  void it('stops retrying at or past maxAttempts', () => {
    const p = RetryPolicy.from({ "maxAttempts": 3 });
    // Below the ceiling retries; at the ceiling stops.
    assert.equal(p.shouldRetry(new Error('x'), 2), true);
    assert.equal(p.shouldRetry(new Error('x'), 3), false);
    assert.equal(p.shouldRetry(new Error('x'), 4), false);
  });

  void it('aborts on any error type listed in abortOn, retries the rest', () => {
    const p = RetryPolicy.from({ "maxAttempts": 5, "abortOn": [FatalError] });
    assert.equal(p.shouldRetry(new FatalError(), 1), false);
    assert.equal(p.shouldRetry(new TransientError(), 1), true);
  });

  void it('retries only error types listed in retryOn, aborts everything else', () => {
    const p = RetryPolicy.from({ "maxAttempts": 5, "retryOn": [TransientError] });
    assert.equal(p.shouldRetry(new TransientError(), 1), true);
    assert.equal(p.shouldRetry(new FatalError(), 1), false);
  });
});

void describe('RetryPolicy.shouldRetry DAGError.retryable fallback precedence', () => {
  void it('with no retryOn/abortOn filters, falls back to DAGError.retryable: false to stop retrying', () => {
    const p = RetryPolicy.from({ "maxAttempts": 5 });
    const notRetryable = new DAGError('nope', { "code": 'VALIDATION_ERROR', "retryable": false });
    assert.equal(p.shouldRetry(notRetryable, 1), false);
  });

  void it('with no retryOn/abortOn filters, falls back to DAGError.retryable: true to keep retrying', () => {
    const p = RetryPolicy.from({ "maxAttempts": 5 });
    const retryable = new DAGError('later', { "code": 'EXECUTION_ERROR', "retryable": true });
    assert.equal(p.shouldRetry(retryable, 1), true);
  });

  void it('with no filters, a non-DAGError error keeps the default "retry everything" behavior', () => {
    const p = RetryPolicy.from({ "maxAttempts": 5 });
    assert.equal(p.shouldRetry(new TransientError(), 1), true);
  });

  void it('an explicit abortOn match wins over DAGError.retryable: true', () => {
    const p = RetryPolicy.from({ "maxAttempts": 5, "abortOn": ['EXECUTION_ERROR'] });
    const retryable = new DAGError('but aborted', { "code": 'EXECUTION_ERROR', "retryable": true });
    assert.equal(p.shouldRetry(retryable, 1), false);
  });

  void it('an explicit retryOn match wins over DAGError.retryable: false', () => {
    const p = RetryPolicy.from({ "maxAttempts": 5, "retryOn": ['VALIDATION_ERROR'] });
    const notRetryable = new DAGError('but listed', { "code": 'VALIDATION_ERROR', "retryable": false });
    assert.equal(p.shouldRetry(notRetryable, 1), true);
  });

  void it('a non-empty retryOn miss stops retrying regardless of DAGError.retryable: true', () => {
    const p = RetryPolicy.from({ "maxAttempts": 5, "retryOn": ['OTHER_CODE'] });
    const retryable = new DAGError('unmatched', { "code": 'EXECUTION_ERROR', "retryable": true });
    assert.equal(p.shouldRetry(retryable, 1), false);
  });
});

// `RetryPolicy` schedules its backoff delays through `@studnicky/retry`'s
// `Retry` (a real timer, not the injected `Scheduler`), so this suite uses
// small real delays instead of a `VirtualScheduler`.
void describe('RetryPolicy.run execution loop', () => {
  void it('returns the task result on first success without retrying', async () => {
    const p = RetryPolicy.from({ "maxAttempts": 3, "jitterFactor": 0, "baseDelay": 10 });
    const attempts: number[] = [];
    const result = await p.run((attempt) => {
      attempts.push(attempt);
      return Promise.resolve('ok');
    });
    assert.equal(result, 'ok');
    // Success on the first try invokes the task exactly once.
    assert.deepEqual(attempts, [1]);
  });

  void it('retries with backoff until the task succeeds', async () => {
    const BASE_DELAY_MS = 10;
    const attempts: number[] = [];
    const p = RetryPolicy.from({
      "maxAttempts": 3,
      "baseDelay": BASE_DELAY_MS,
      "strategy": BackoffStrategyNames.CONSTANT,
      "jitterFactor": 0,
    });

    const startedAt = Date.now();
    const result = await p.run((attempt) => {
      attempts.push(attempt);
      if (attempt < 3) throw new TransientError();
      return Promise.resolve('done');
    });
    const elapsedMs = Date.now() - startedAt;

    assert.equal(result, 'done');
    assert.deepEqual(attempts, [1, 2, 3]);
    // Two constant-strategy sleeps of BASE_DELAY_MS each.
    assert.ok(elapsedMs >= BASE_DELAY_MS * 2, `expected at least ${(BASE_DELAY_MS * 2).toString()}ms elapsed, got ${elapsedMs.toString()}ms`);
  });

  void it('aborts mid-wait when the signal fires between attempts', async () => {
    const controller = new AbortController();
    const p = RetryPolicy.from({ "maxAttempts": 5, "baseDelay": 1000, "strategy": BackoffStrategyNames.CONSTANT, "jitterFactor": 0 });

    const promise = p.run(() => { throw new TransientError(); }, { 'signal': controller.signal });
    await new Promise<void>((r) => setImmediate(r));
    controller.abort(new Error('cancelled by test'));
    await assert.rejects(promise, /cancelled by test/);
  });

  void it('throws the last error after exhausting all attempts', async () => {
    const attempts: number[] = [];
    const p = RetryPolicy.from({ "maxAttempts": 2, "baseDelay": 0, "strategy": BackoffStrategyNames.CONSTANT, "jitterFactor": 0 });
    await assert.rejects(p.run((attempt) => {
      attempts.push(attempt);
      throw new TransientError();
    }), TransientError);
    // The loop runs exactly maxAttempts times before throwing the last error.
    assert.deepEqual(attempts, [1, 2]);
  });

  void it('treats an abort that races task completion as an abort, not a stale success', async () => {
    // Abort fires synchronously inside the task body; by the time `await task`
    // returns, signal.aborted is already true. The post-task abort check must
    // catch this before returning the (stale) result.
    const controller = new AbortController();
    const p = RetryPolicy.from({ "maxAttempts": 3, "baseDelay": 0, "strategy": BackoffStrategyNames.CONSTANT, "jitterFactor": 0 });

    const promise = p.run(() => {
      controller.abort(new Error('aborted-during-task'));
      return Promise.resolve('stale-result');
    }, { 'signal': controller.signal });

    await assert.rejects(promise, /aborted-during-task/);
  });
});
