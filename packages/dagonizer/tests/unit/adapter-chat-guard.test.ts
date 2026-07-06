/**
 * Tests for the BaseAdapter shared abort+timeout guard (`withDeadline`, used
 * by both `chat()`'s `#guardChat` and `chatStream()`).
 *
 * Verifies:
 *  1. A `performChat` that never settles always rejects within the configured
 *     `timeoutMs` ceiling as an `LlmError` with `reason: 'TIMEOUT'`.
 *  2. An external abort signal propagates promptly even when `performChat`
 *     never settles and the internal timeout is far in the future.
 *  3. Normal completion passes the resolved value through unchanged and does
 *     NOT invoke `onCancelRequested`.
 *  4. `chatStream()` is bounded by the same deadline: a `performChatStream`
 *     override that never settles rejects within `timeoutMs` as a
 *     TIMEOUT-classified `LlmError`.
 *  5. `pushChunk` (used by the default `performChatStream`) is best-effort: a
 *     sink whose `push()` always rejects does not fail `chatStream()` — the
 *     assembled response still resolves.
 *
 * All tests are hang-proof: the call-under-test races against a short sentinel
 * that fails the test if the guard fails to reject.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  BaseAdapter,
  ChatRequest,
  ChatResponseMessage,
  LlmError,
  ZERO_TOKEN_USAGE,
} from '../../src/adapter/index.js';
import type {
  AdapterCapabilitiesType,
  ChatRequestType,
  ChatResponseType,
} from '../../src/adapter/index.js';
import type { StreamSinkInterface } from '../../src/contracts/StreamSinkInterface.js';
import type { ChatStreamChunkType } from '../../src/entities/adapter/ChatStreamChunk.js';

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

/**
 * Adapter with a configurable `performChatStream` override, used to prove
 * `chatStream()` shares `withDeadline` with `chat()`.
 */
class StreamGuardTestAdapter extends BaseAdapter {
  readonly #performChatStreamImpl: (
    request: ChatRequestType,
    sink: StreamSinkInterface<ChatStreamChunkType>,
  ) => Promise<ChatResponseType>;

  constructor(
    performChatStreamImpl: (
      request: ChatRequestType,
      sink: StreamSinkInterface<ChatStreamChunkType>,
    ) => Promise<ChatResponseType>,
    options: { readonly timeoutMs?: number; readonly maxAttempts?: number } = {},
  ) {
    super('stream-guard-test', 'Stream Guard Test Adapter', CAPS, options);
    this.#performChatStreamImpl = performChatStreamImpl;
  }

  protected performChat(): Promise<ChatResponseType> {
    throw new Error('not used by these tests');
  }

  protected override performChatStream(
    request: ChatRequestType,
    sink: StreamSinkInterface<ChatStreamChunkType>,
  ): Promise<ChatResponseType> {
    return this.#performChatStreamImpl(request, sink);
  }
}

/** A `StreamSinkInterface` whose `push()` always rejects. */
class RejectingSink implements StreamSinkInterface<ChatStreamChunkType> {
  pushCount = 0;

  push(): Promise<void> {
    this.pushCount++;
    return Promise.reject(new Error('sink is dead'));
  }
}

/** Builds a hang-proof ceiling that rejects after `ms` ms, failing the test on timeout. */
class TestCeiling {
  static of(ms: number, label: string): Promise<never> {
    return new Promise((_, reject) => setTimeout(() => { reject(new Error(label)); }, ms));
  }
}

void describe('BaseAdapter chat guard (abort+timeout race)', () => {
  void it('rejects with LlmError TIMEOUT when performChat never settles', async () => {
    const neverSettles = (): Promise<ChatResponseType> => new Promise(() => { /* intentional hang */ });
    const adapter = new GuardTestAdapter(neverSettles, { 'timeoutMs': 50, 'maxAttempts': 1 });

    const chatCall = adapter.chat(
      ChatRequest.create({ 'messages': [{ 'role': 'user', 'content': 'hello' }] }),
    );

    await assert.rejects(
      Promise.race([chatCall, TestCeiling.of(1000, 'TEST TIMED OUT — guard did not reject within 1000ms')]),
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
      ChatRequest.create({
        'messages': [{ 'role': 'user', 'content': 'hello' }],
        'signal': controller.signal,
      }),
    );

    await assert.rejects(
      Promise.race([chatCall, TestCeiling.of(1000, 'TEST TIMED OUT — external abort did not propagate within 1000ms')]),
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
      'message':      ChatResponseMessage.create('world', []),
      'finishReason': 'stop',
      'usage':        ZERO_TOKEN_USAGE,
    };
    const adapter = new GuardTestAdapter(
      () => Promise.resolve(expected),
      { 'timeoutMs': 5_000, 'maxAttempts': 1 },
    );

    const result = await adapter.chat(
      ChatRequest.create({ 'messages': [{ 'role': 'user', 'content': 'hello' }] }),
    );

    assert.equal(result.finishReason, 'stop');
    assert.deepEqual(result.message, expected.message);
    assert.equal(adapter.cancelCount, 0);
  });

  void it('chatStream rejects with a TIMEOUT LlmError when performChatStream never settles', async () => {
    const neverSettles = (): Promise<ChatResponseType> => new Promise(() => { /* intentional hang */ });
    const adapter = new StreamGuardTestAdapter(neverSettles, { 'timeoutMs': 50, 'maxAttempts': 1 });
    const sink = new RejectingSink();

    const streamCall = adapter.chatStream(
      ChatRequest.create({ 'messages': [{ 'role': 'user', 'content': 'hello' }] }),
      sink,
    );

    await assert.rejects(
      Promise.race([streamCall, TestCeiling.of(1000, 'TEST TIMED OUT — chatStream did not reject within 1000ms')]),
      (err: unknown) => {
        assert.ok(err instanceof LlmError, `expected LlmError, got ${String(err)}`);
        assert.equal(err.classification.reason, 'TIMEOUT');
        return true;
      },
    );
  });

  void it('chatStream resolves with the full response when the sink rejects every push (best-effort)', async () => {
    const expected: ChatResponseType = {
      'message':      ChatResponseMessage.create('world', []),
      'finishReason': 'stop',
      'usage':        ZERO_TOKEN_USAGE,
    };
    // No performChatStream override supplied: exercises the default buffered
    // implementation, which routes its single `sink.push` through `pushChunk`.
    const adapter = new GuardTestAdapter(
      () => Promise.resolve(expected),
      { 'timeoutMs': 5_000, 'maxAttempts': 1 },
    );
    const sink = new RejectingSink();

    const result = await adapter.chatStream(
      ChatRequest.create({ 'messages': [{ 'role': 'user', 'content': 'hello' }] }),
      sink,
    );

    assert.equal(result.finishReason, 'stop');
    assert.deepEqual(result.message, expected.message);
    assert.equal(sink.pushCount, 1, 'the rejecting sink was still called exactly once');
  });
});
