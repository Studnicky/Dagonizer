/**
 * Tests for opt-in circuit breaking and rate limiting on `BaseAdapter.chat()`.
 *
 * Verifies:
 *  1. Default construction (`circuitBreaker`/`tokenBucket` omitted) behaves
 *     exactly as before — no regression for existing adapters/tests.
 *  2. A configured `CircuitBreaker` trips after its failure threshold, and a
 *     subsequent `chat()` call rejects instantly with `CircuitBreakerOpenError`
 *     without invoking `performChat` again — the circuit fails fast rather
 *     than burning a retry attempt.
 *  3. A configured `TokenBucket` with no tokens available rejects `chat()`
 *     with `TokenBucketExhaustedError` without invoking `performChat`.
 *  4. Ordering: the circuit breaker is checked before the token bucket, so a
 *     call rejected by an open circuit does not consume a token.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { CircuitBreaker, CircuitBreakerOpenError, TokenBucket, TokenBucketExhaustedError } from '@studnicky/resilience';

import {
  BaseAdapter,
  ChatRequestBuilder,
  ChatResponseMessageBuilder,
  ZERO_TOKEN_USAGE,
} from '../../src/adapter/index.js';
import type {
  AdapterCapabilitiesType,
  BaseAdapterOptionsType,
  ChatRequestType,
  ChatResponseType,
} from '../../src/adapter/index.js';
import { RetryPolicy } from '../../src/runtime/RetryPolicy.js';

const CAPS: AdapterCapabilitiesType = { 'toolUse': 'none', 'structuredOutput': false, 'jsonMode': false };

const RESPONSE: ChatResponseType = {
  'message':      ChatResponseMessageBuilder.from('ok', []),
  'finishReason': 'stop',
  'usage':        ZERO_TOKEN_USAGE,
};

/** Concrete adapter counting `performChat` invocations, with a configurable outcome. */
class ResilienceTestAdapter extends BaseAdapter {
  callCount = 0;
  #outcome: () => Promise<ChatResponseType>;

  constructor(outcome: () => Promise<ChatResponseType>, options: BaseAdapterOptionsType = {}) {
    super('resilience-test', 'Resilience Test Adapter', CAPS, { 'maxAttempts': 1, ...options });
    this.#outcome = outcome;
  }

  protected performChat(): Promise<ChatResponseType> {
    this.callCount++;
    return this.#outcome();
  }
}

function request(): ChatRequestType {
  return ChatRequestBuilder.from({ 'messages': [{ 'role': 'user', 'content': 'hello' }] });
}

void describe('BaseAdapter opt-in circuit breaker / token bucket', () => {
  void it('behaves unchanged when circuitBreaker/tokenBucket are omitted (default null)', async () => {
    const adapter = new ResilienceTestAdapter(() => Promise.resolve(RESPONSE));
    const result = await adapter.chat(request());
    assert.deepEqual(result.message, RESPONSE.message);
    assert.equal(adapter.callCount, 1);
  });

  void it('open circuit rejects with CircuitBreakerOpenError without another performChat call', async () => {
    const circuitBreaker = CircuitBreaker.create({ 'failureThreshold': 1, 'resetTimeoutMs': 60_000 });
    const adapter = new ResilienceTestAdapter(
      () => Promise.reject(new Error('boom')),
      { 'circuitBreaker': circuitBreaker },
    );

    // First call: circuit is closed, performChat runs and fails, tripping the circuit.
    await assert.rejects(adapter.chat(request()));
    assert.equal(adapter.callCount, 1);
    assert.equal(circuitBreaker.state, 'open');

    // Second call: circuit is open — rejects instantly, performChat is NOT invoked again.
    await assert.rejects(adapter.chat(request()), (err: unknown) => {
      assert.equal((err as Error).name, 'CircuitBreakerOpenError');
      return true;
    });
    assert.equal(adapter.callCount, 1, 'performChat must not run again while the circuit is open');
  });

  void it('exhausted token bucket rejects with TokenBucketExhaustedError without invoking performChat', async () => {
    const tokenBucket = TokenBucket.create({ 'requestsPerSecond': 1, 'burstSize': 1 });
    tokenBucket.consume(); // drain the single available token
    const adapter = new ResilienceTestAdapter(
      () => Promise.resolve(RESPONSE),
      { 'tokenBucket': tokenBucket },
    );

    await assert.rejects(adapter.chat(request()), (err: unknown) => {
      assert.equal((err as Error).name, 'TokenBucketExhaustedError');
      return true;
    });
    assert.equal(adapter.callCount, 0, 'performChat must not run when the bucket is exhausted');
  });

  void it('an open circuit is checked before the token bucket, so no token is spent on a fail-fast rejection', async () => {
    const circuitBreaker = CircuitBreaker.create({ 'failureThreshold': 1, 'resetTimeoutMs': 60_000 });
    circuitBreaker.forceOpen();
    const tokenBucket = TokenBucket.create({ 'requestsPerSecond': 1, 'burstSize': 1 });
    const adapter = new ResilienceTestAdapter(
      () => Promise.resolve(RESPONSE),
      { 'circuitBreaker': circuitBreaker, 'tokenBucket': tokenBucket },
    );

    await assert.rejects(adapter.chat(request()), (err: unknown) => {
      assert.equal((err as Error).name, 'CircuitBreakerOpenError');
      return true;
    });
    assert.equal(adapter.callCount, 0);
    assert.equal(tokenBucket.available, 1, 'token bucket must be untouched when the circuit rejects first');
  });
});

void describe('outer RetryPolicy wrapping adapter.chat(): abortOn CircuitBreakerOpenError/TokenBucketExhaustedError', () => {
  void it('without abortOn, a naive outer RetryPolicy keeps hammering an open circuit', async () => {
    const circuitBreaker = CircuitBreaker.create({ 'failureThreshold': 1, 'resetTimeoutMs': 60_000 });
    circuitBreaker.forceOpen();
    const adapter = new ResilienceTestAdapter(
      () => Promise.resolve(RESPONSE),
      { 'circuitBreaker': circuitBreaker },
    );
    const outer = RetryPolicy.from({ 'maxAttempts': 3, 'baseDelay': 0, 'jitterFactor': 0 });

    let attempts = 0;
    await assert.rejects(
      outer.run(() => {
        attempts++;
        return adapter.chat(request());
      }),
      (err: unknown) => {
        assert.equal((err as Error).name, 'CircuitBreakerOpenError');
        return true;
      },
    );
    // No abortOn configured: the outer policy naively retried the open-circuit
    // rejection up to maxAttempts, hammering the circuit each time.
    assert.equal(attempts, 3);
    assert.equal(adapter.callCount, 0, 'the circuit rejects before performChat ever runs');
  });

  void it('abortOn: [CircuitBreakerOpenError] stops the outer RetryPolicy after one attempt', async () => {
    const circuitBreaker = CircuitBreaker.create({ 'failureThreshold': 1, 'resetTimeoutMs': 60_000 });
    circuitBreaker.forceOpen();
    const adapter = new ResilienceTestAdapter(
      () => Promise.resolve(RESPONSE),
      { 'circuitBreaker': circuitBreaker },
    );
    const outer = RetryPolicy.from({
      'maxAttempts': 3,
      'baseDelay': 0,
      'jitterFactor': 0,
      'abortOn': [CircuitBreakerOpenError],
    });

    let attempts = 0;
    await assert.rejects(
      outer.run(() => {
        attempts++;
        return adapter.chat(request());
      }),
      (err: unknown) => {
        assert.equal((err as Error).name, 'CircuitBreakerOpenError');
        return true;
      },
    );
    assert.equal(attempts, 1, 'abortOn stops the outer policy on the first CircuitBreakerOpenError');
  });

  void it('abortOn: [TokenBucketExhaustedError] stops the outer RetryPolicy after one attempt', async () => {
    const tokenBucket = TokenBucket.create({ 'requestsPerSecond': 1, 'burstSize': 1 });
    tokenBucket.consume();
    const adapter = new ResilienceTestAdapter(
      () => Promise.resolve(RESPONSE),
      { 'tokenBucket': tokenBucket },
    );
    const outer = RetryPolicy.from({
      'maxAttempts': 3,
      'baseDelay': 0,
      'jitterFactor': 0,
      'abortOn': [TokenBucketExhaustedError],
    });

    let attempts = 0;
    await assert.rejects(
      outer.run(() => {
        attempts++;
        return adapter.chat(request());
      }),
      (err: unknown) => {
        assert.equal((err as Error).name, 'TokenBucketExhaustedError');
        return true;
      },
    );
    assert.equal(attempts, 1, 'abortOn stops the outer policy on the first TokenBucketExhaustedError');
  });
});
