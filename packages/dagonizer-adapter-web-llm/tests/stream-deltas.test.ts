/**
 * Tests for `WebLlmAdapter.performChatStream` real per-token delta
 * streaming, and for `performChat` staying unchanged after the shared
 * `#openStream` setup extraction.
 *
 * Uses the same "class extension is the only extension mechanism" pattern
 * as `identity.test.ts` and `response-format.test.ts`: override `loadEngine()`
 * to inject a stub engine, and go through the public `chatStream`/`chat`
 * entry points on `BaseAdapter` (never call the protected `performChat*`
 * methods directly).
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import type { StreamSinkInterface } from '@studnicky/dagonizer';
import { ChatRequestBuilder, ZERO_TOKEN_USAGE } from '@studnicky/dagonizer/adapter';
import type { ChatStreamChunkType } from '@studnicky/dagonizer/adapter';

import { WebLlmAdapter } from '../src/index.js';
import type { WebLlmEngineType, WebLlmStreamChunkType, WebLlmStreamingParamsType } from '../src/index.js';

/**
 * Engine stub that yields the three delta chunks `'He'`, `'llo'`, `' world'`
 * followed by a final usage-carrying chunk with an empty delta — mirroring
 * the shape WebLLM emits when the request carries
 * `stream_options: { include_usage: true }`.
 */
class DeltaStub {
  readonly 'interruptGenerate': () => void;
  readonly 'chat': WebLlmEngineType['chat'];
  readonly createCalls: WebLlmStreamingParamsType[] = [];

  constructor() {
    const stub = this;

    async function* streamGen(): AsyncGenerator<WebLlmStreamChunkType> {
      yield { 'choices': [{ 'delta': { 'content': 'He' } }] };
      yield { 'choices': [{ 'delta': { 'content': 'llo' } }] };
      yield { 'choices': [{ 'delta': { 'content': ' world' } }] };
      yield {
        'choices': [{ 'delta': {} }],
        'usage':   { 'prompt_tokens': 5, 'completion_tokens': 3 },
      };
    }

    this['interruptGenerate'] = (): void => {};

    this['chat'] = {
      'completions': {
        'create': (params: WebLlmStreamingParamsType): Promise<AsyncIterable<WebLlmStreamChunkType>> => {
          stub.createCalls.push(params);
          return Promise.resolve(streamGen());
        },
      },
    };
  }
}

/**
 * `WebLlmAdapter` subclass that injects a stub engine — the "class extension
 * is the only extension mechanism" pattern.
 */
class DeltaTestAdapter extends WebLlmAdapter {
  readonly #stub: WebLlmEngineType;

  constructor(stub: WebLlmEngineType) {
    super({ 'timeoutMs': 5_000 });
    this.#stub = stub;
  }

  protected override loadEngine(): Promise<WebLlmEngineType> {
    return Promise.resolve(this.#stub);
  }
}

/**
 * Test double for `StreamSinkInterface<ChatStreamChunkType>` that records
 * every pushed chunk in arrival order. No callback passed to the adapter —
 * the adapter calls `.push()` on this object directly.
 */
class RecordingSink implements StreamSinkInterface<ChatStreamChunkType> {
  readonly pushed: ChatStreamChunkType[] = [];

  push(chunk: ChatStreamChunkType): Promise<void> {
    this.pushed.push(chunk);
    return Promise.resolve();
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

void test('performChatStream: pushes ordered per-token deltas without coalescing', async () => {
  const stub = new DeltaStub();
  const adapter = new DeltaTestAdapter(stub);
  const sink = new RecordingSink();

  const response = await adapter.chatStream(
    ChatRequestBuilder.from({ 'messages': [{ 'role': 'user', 'content': 'Say hello.' }] }),
    sink,
  );

  assert.equal(sink.pushed.length, 3, 'exactly three deltas must be pushed (no coalescing)');
  assert.equal(sink.pushed[0]?.delta, 'He');
  assert.equal(sink.pushed[1]?.delta, 'llo');
  assert.equal(sink.pushed[2]?.delta, ' world');

  assert.equal(response.message.variant, 'text', 'response variant must be text');
  assert.equal(response.message.content, 'Hello world', 'accumulated deltas must equal Hello world');
});

void test('performChatStream: captures usage from the final chunk', async () => {
  const stub = new DeltaStub();
  const adapter = new DeltaTestAdapter(stub);
  const sink = new RecordingSink();

  const response = await adapter.chatStream(
    ChatRequestBuilder.from({ 'messages': [{ 'role': 'user', 'content': 'Say hello.' }] }),
    sink,
  );

  assert.deepEqual(response.usage, { 'promptTokens': 5, 'completionTokens': 3 });
});

void test('performChat (buffered) remains unchanged after the #openStream extraction', async () => {
  const stub = new DeltaStub();
  const adapter = new DeltaTestAdapter(stub);

  const response = await adapter.chat(
    ChatRequestBuilder.from({ 'messages': [{ 'role': 'user', 'content': 'Say hello.' }] }),
  );

  assert.equal(response.message.variant, 'text', 'response variant must be text');
  assert.equal(response.message.content, 'Hello world', 'accumulated text must equal Hello world');
  assert.deepEqual(response.usage, ZERO_TOKEN_USAGE, 'buffered path must still hardcode ZERO_TOKEN_USAGE');
});
