import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { Clock } from '../../src/runtime/Clock.js';
import { BackoffStrategy, RetryPolicy } from '../../src/runtime/RetryPolicy.js';
import { Scheduler } from '../../src/runtime/Scheduler.js';
import { VirtualClockProvider } from '../../testing/VirtualClock.js';
import { VirtualScheduler } from '../../testing/VirtualScheduler.js';

class TransientError extends Error { constructor() { super('transient'); } }
class FatalError extends Error { constructor() { super('fatal'); } }

void describe('RetryPolicy backoff math', () => {
  void it('constant returns baseDelay every attempt', () => {
    const p = RetryPolicy.from({ "strategy": BackoffStrategy.CONSTANT, "baseDelay": 500, "jitterFactor": 0 });
    assert.equal(p.getDelay(1), 500);
    assert.equal(p.getDelay(2), 500);
    assert.equal(p.getDelay(5), 500);
  });

  void it('linear scales with attempt number', () => {
    const p = RetryPolicy.from({ "strategy": BackoffStrategy.LINEAR, "baseDelay": 100, "jitterFactor": 0 });
    assert.equal(p.getDelay(1), 100);
    assert.equal(p.getDelay(3), 300);
  });

  void it('exponential doubles per attempt by default', () => {
    const p = RetryPolicy.from({ "strategy": BackoffStrategy.EXPONENTIAL, "baseDelay": 100, "multiplier": 2, "jitterFactor": 0 });
    assert.equal(p.getDelay(1), 100);
    assert.equal(p.getDelay(2), 200);
    assert.equal(p.getDelay(3), 400);
  });

  void it('caps delay at maxDelay', () => {
    const p = RetryPolicy.from({ "strategy": BackoffStrategy.EXPONENTIAL, "baseDelay": 100, "maxDelay": 250, "jitterFactor": 0 });
    assert.equal(p.getDelay(5), 250);
  });
});

void describe('RetryPolicy.shouldRetry filtering', () => {
  void it('returns false past maxAttempts', () => {
    const p = RetryPolicy.from({ "maxAttempts": 3 });
    assert.equal(p.shouldRetry(new Error('x'), 3), false);
  });

  void it('honors abortOn list', () => {
    const p = RetryPolicy.from({ "maxAttempts": 5, "abortOn": [FatalError] });
    assert.equal(p.shouldRetry(new FatalError(), 1), false);
    assert.equal(p.shouldRetry(new TransientError(), 1), true);
  });

  void it('honors retryOn list (everything else aborts)', () => {
    const p = RetryPolicy.from({ "maxAttempts": 5, "retryOn": [TransientError] });
    assert.equal(p.shouldRetry(new TransientError(), 1), true);
    assert.equal(p.shouldRetry(new FatalError(), 1), false);
  });
});

void describe('RetryPolicy.run', () => {
  afterEach(() => { Scheduler.reset(); Clock.reset(); });

  void it('returns the result on first success', async () => {
    const sched = new VirtualScheduler();
    Scheduler.configure(sched);
    const p = RetryPolicy.from({ "maxAttempts": 3, "jitterFactor": 0, "baseDelay": 100 });
    const result = await p.run(() => Promise.resolve('ok'));
    assert.equal(result, 'ok');
  });

  void it('retries with backoff under virtual scheduler', async () => {
    const clock = new VirtualClockProvider(0n);
    const sched = new VirtualScheduler(0);
    Clock.configure(clock);
    Scheduler.configure(sched);

    const attempts: number[] = [];
    const p = RetryPolicy.from({
      "maxAttempts": 3,
      "baseDelay": 100,
      "strategy": BackoffStrategy.CONSTANT,
      "jitterFactor": 0,
    });

    const promise = p.run((attempt) => {
      attempts.push(attempt);
      if (attempt < 3) throw new TransientError();
      return Promise.resolve('done');
    });

    // Each attempt rejects then awaits a 100ms virtual sleep.
    // Advance virtual time to drain both retries.
    for (let i = 0; i < 5; i++) {
      // Allow microtasks to settle so the next after() promise is registered.
      await new Promise<void>((r) => setImmediate(r));
      sched.advance(100);
    }
    const result = await promise;
    assert.equal(result, 'done');
    assert.deepEqual(attempts, [1, 2, 3]);
  });

  void it('aborts mid-wait when signal fires', async () => {
    const sched = new VirtualScheduler(0);
    Scheduler.configure(sched);
    const controller = new AbortController();
    const p = RetryPolicy.from({ "maxAttempts": 5, "baseDelay": 1000, "strategy": BackoffStrategy.CONSTANT, "jitterFactor": 0 });

    const promise = p.run(() => { throw new TransientError(); }, { 'signal': controller.signal });
    await new Promise<void>((r) => setImmediate(r));
    controller.abort(new Error('cancelled by test'));
    await assert.rejects(promise, /cancelled by test/);
  });

  void it('throws the last error after exhausting attempts', async () => {
    const sched = new VirtualScheduler(0);
    Scheduler.configure(sched);
    const p = RetryPolicy.from({ "maxAttempts": 2, "baseDelay": 0, "strategy": BackoffStrategy.CONSTANT, "jitterFactor": 0 });
    await assert.rejects(p.run(() => { throw new TransientError(); }), TransientError);
  });

  void it('detects abort racing task completion (abort fires while task is running)', async () => {
    // Abort fires synchronously inside the task body; by the time `await task`
    // returns, signal.aborted is already true. The post-task abort check must
    // catch this before returning the (stale) result.
    const sched = new VirtualScheduler(0);
    Scheduler.configure(sched);
    const controller = new AbortController();
    const p = RetryPolicy.from({ "maxAttempts": 3, "baseDelay": 0, "strategy": BackoffStrategy.CONSTANT, "jitterFactor": 0 });

    const promise = p.run(() => {
      controller.abort(new Error('aborted-during-task'));
      return Promise.resolve('stale-result');
    }, { 'signal': controller.signal });

    await assert.rejects(promise, /aborted-during-task/);
  });
});
