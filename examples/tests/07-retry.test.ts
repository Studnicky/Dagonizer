import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Dagonizer } from '@studnicky/dagonizer';
import {
  FetchState,
  FetchNode,
  FlakyDownstream,
  FibonacciRetry,
  TransientError,
  dag,
} from '../dags/07-retry.ts';

describe('07-retry: RetryPolicy and FibonacciRetry', () => {
  it('dag completes with result=OK despite transient failures', async () => {
    const dispatcher = new Dagonizer<FetchState>();
    dispatcher.registerNode(new FetchNode());
    dispatcher.registerDAG(dag);

    const state = new FetchState();
    const result = await dispatcher.execute('retry-dag', state);

    assert.equal(result.terminalOutcome, 'completed');
    assert.equal(state.result, 'OK');
  });

  it('FlakyDownstream throws twice then returns OK', async () => {
    const flaky = new FlakyDownstream();

    await assert.rejects(() => flaky.call(), TransientError);
    await assert.rejects(() => flaky.call(), TransientError);
    const outcome = await flaky.call();
    assert.equal(outcome, 'OK');
    assert.equal(flaky.attempts, 3);
  });

  it('FibonacciRetry.getDelay(1) returns 100 (fib(1)*100)', () => {
    const retry = new FibonacciRetry({ maxDelay: 100_000 });
    assert.equal(retry.getDelay(1), 100);
  });

  it('FibonacciRetry.getDelay(5) returns 500 (fib(5)*100)', () => {
    const retry = new FibonacciRetry({ maxDelay: 100_000 });
    // fib(5) = 5
    assert.equal(retry.getDelay(5), 500);
  });

  it('FibonacciRetry.getDelay(2) returns 100 (fib(2)*100)', () => {
    const retry = new FibonacciRetry({ maxDelay: 100_000 });
    // fib(2) = 1
    assert.equal(retry.getDelay(2), 100);
  });

  it('FibonacciRetry.getDelay(3) returns 200 (fib(3)*100)', () => {
    const retry = new FibonacciRetry({ maxDelay: 100_000 });
    // fib(3) = 2
    assert.equal(retry.getDelay(3), 200);
  });

  it('FibonacciRetry.getDelay respects maxDelay cap', () => {
    const retry = new FibonacciRetry({ maxDelay: 150 });
    // fib(5)*100 = 500 > 150 → capped at 150
    assert.equal(retry.getDelay(5), 150);
  });
});
