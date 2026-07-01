/**
 * Tests for the BaseAdapter shared abort+timeout guard (`#guardChat`).
 *
 * Verifies three invariants:
 *  1. A `performChat` that never settles always rejects within the configured
 *     `timeoutMs` ceiling as an `LlmError` with `reason: 'TIMEOUT'`.
 *  2. An external abort signal propagates promptly even when `performChat`
 *     never settles and the internal timeout is far in the future.
 *  3. Normal completion passes the resolved value through unchanged and does
 *     NOT invoke `onCancelRequested`.
 *
 * All tests are hang-proof: the call-under-test races against a short sentinel
 * that fails the test if the guard fails to reject.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  BaseAdapter,
  ChatRequestBuilder,
  ChatResponseMessageBuilder,
  LlmError,
  ZERO_TOKEN_USAGE,
} from '../../src/adapter/index.js';
import type {
  AdapterCapabilitiesType,
  ChatRequestType,
  ChatResponseType,
} from '../../src/adapter/index.js';

const CAPS: AdapterCapabilitiesType = { 'toolUse': 'none', 'structuredOutput': false, 'jsonMode': false };

/** Concrete adapter with configurable `performChat` and cancel-count tracking. */
class GuardTestAdapter extends BaseAdapter {
  cancelCount: number;
  readonly #performChatImpl: (request: ChatRequestType) => Promise<ChatResponseType>;

  constructor(
    performChatImpl: (request: ChatRequestType) => Promise<ChatResponseType>,
    options: { readonly timeoutMs?: number; readonly maxAttempts?: number } = {},
  ) {
    super('guard-test', 'Guard Test Adapter', CAPS, options);
    this.cancelCount = 0;
    this.#performChatImpl = performChatImpl;
  }

  protected override onCancelRequested(): void {
    this.cancelCount++;
  }

  protected performChat(request: ChatRequestType): Promise<ChatResponseType> {
    return this.#performChatImpl(request);
  }
}

/** Rejects after `ms` ms — hang-proof ceiling that fails the test on timeout. */
function testCeiling(ms: number, label: string): Promise<never> {
  return new Promise((_, reject) => setTimeout(() => { reject(new Error(label)); }, ms));
}

void describe('BaseAdapter chat guard (abort+timeout race)', () => {
  void it('rejects with LlmError TIMEOUT when performChat never settles', async () => {
    const neverSettles = (): Promise<ChatResponseType> => new Promise(() => { /* intentional hang */ });
    const adapter = new GuardTestAdapter(neverSettles, { 'timeoutMs': 50, 'maxAttempts': 1 });

    const chatCall = adapter.chat(
      ChatRequestBuilder.from({ 'messages': [{ 'role': 'user', 'content': 'hello' }] }),
    );

    await assert.rejects(
      Promise.race([chatCall, testCeiling(1000, 'TEST TIMED OUT — guard did not reject within 1000ms')]),
      (err: unknown) => {
        assert.ok(err instanceof LlmError, `expected LlmError, got ${String(err)}`);
        assert.equal(err.classification.reason, 'TIMEOUT');
        return true;
      },
    );
  });

  void it('rejects promptly on external abort signal when performChat never settles', async () => {
    const neverSettles = (): Promise<ChatResponseType> => new Promise(() => { /* intentional hang */ });
    const adapter = new GuardTestAdapter(neverSettles, { 'timeoutMs': 10_000, 'maxAttempts': 1 });

    const controller = new AbortController();
    setTimeout(() => { controller.abort(); }, 10);

    const chatCall = adapter.chat(
      ChatRequestBuilder.from({
        'messages': [{ 'role': 'user', 'content': 'hello' }],
        'signal': controller.signal,
      }),
    );

    await assert.rejects(
      Promise.race([chatCall, testCeiling(1000, 'TEST TIMED OUT — external abort did not propagate within 1000ms')]),
      (err: unknown) => {
        assert.ok(err instanceof Error, `expected Error, got ${String(err)}`);
        assert.ok(
          !(err instanceof Error && err.message.startsWith('TEST TIMED OUT')),
          `guard hung — sentinel fired: ${err instanceof Error ? err.message : String(err)}`,
        );
        return true;
      },
    );
  });

  void it('resolves with performChat result on normal completion and does not invoke onCancelRequested', async () => {
    const expected: ChatResponseType = {
      'message':      ChatResponseMessageBuilder.from('world', []),
      'finishReason': 'stop',
      'usage':        ZERO_TOKEN_USAGE,
    };
    const adapter = new GuardTestAdapter(
      () => Promise.resolve(expected),
      { 'timeoutMs': 5_000, 'maxAttempts': 1 },
    );

    const result = await adapter.chat(
      ChatRequestBuilder.from({ 'messages': [{ 'role': 'user', 'content': 'hello' }] }),
    );

    assert.equal(result.finishReason, 'stop');
    assert.deepEqual(result.message, expected.message);
    assert.equal(adapter.cancelCount, 0);
  });
});
