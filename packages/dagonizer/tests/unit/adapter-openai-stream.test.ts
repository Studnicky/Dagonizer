/**
 * Tests for the core SSE streaming seam:
 *
 *  1. `SseLineParser` framing — multi-line `data:`, partial lines split
 *     across chunk boundaries, comment lines ignored, `[DONE]` surfaced as
 *     an ordinary frame (the adapter decides when to stop).
 *  2. `OpenAiCompatibleAdapter.chatStream` against a fake fetch returning an
 *     SSE `ReadableStream` — deltas reach the sink in order, and the
 *     returned `ChatResponseType` carries the concatenated text, mapped
 *     `finishReason`, and the usage from the final `include_usage` chunk.
 *  3. Tool-turn fallback: a request carrying `tools` never sets
 *     `stream: true`; it routes to the buffered default (one chunk).
 *
 * Every test stubs `globalThis.fetch`; the original is restored in a
 * `finally` block regardless of outcome.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ChatRequestBuilder, OpenAiCompatibleAdapter } from '../../src/adapter/index.js';
import { SseLineParser } from '../../src/adapter/SseLineParser.js';
import type { StreamSinkInterface } from '../../src/contracts/StreamSinkInterface.js';
import type { ChatStreamChunkType } from '../../src/entities/adapter/ChatStreamChunk.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Builds a `ReadableStream<Uint8Array>` that yields one UTF-8-encoded chunk per string, in order. */
class ByteStream {
  private constructor() { /* static */ }

  static of(chunks: readonly string[]): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder();
    let index = 0;
    return new ReadableStream<Uint8Array>({
      pull(controller): void {
        if (index >= chunks.length) {
          controller.close();
          return;
        }
        controller.enqueue(encoder.encode(chunks[index]));
        index += 1;
      },
    });
  }
}

/** A `StreamSinkInterface` that records every pushed chunk's `delta` in order. */
class CollectingSink implements StreamSinkInterface<ChatStreamChunkType> {
  readonly deltas: string[] = [];

  async push(item: ChatStreamChunkType): Promise<void> {
    this.deltas.push(item.delta);
    return Promise.resolve();
  }
}

/** Runs `fn` with the global fetch replaced by `stub`, for the duration of one call. */
class FetchHarness {
  static async with<T>(stub: typeof globalThis.fetch, fn: () => Promise<T>): Promise<T> {
    const saved = globalThis.fetch;
    globalThis.fetch = stub;
    try {
      return await fn();
    } finally {
      globalThis.fetch = saved;
    }
  }
}

/** Drains every item an `AsyncIterable<T>` yields into an array. */
class AsyncIterableCollector {
  static async of<T>(iterable: AsyncIterable<T>): Promise<T[]> {
    const out: T[] = [];
    for await (const item of iterable) out.push(item);
    return out;
  }
}

/** A non-null, non-array object — narrows a parsed JSON body without a cast. */
class JsonRecord {
  static is(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}

// ── 1. SseLineParser framing ──────────────────────────────────────────────────

void describe('SseLineParser.linesOf', () => {
  void it('joins multiple data: lines with \\n, captures event:, and ignores comment lines', async () => {
    const stream = ByteStream.of([
      'event: message\ndata: line1\ndata: line2\n\n: this is a comment\ndata: after\n\n',
    ]);

    const frames = await AsyncIterableCollector.of(SseLineParser.linesOf(stream));

    assert.deepEqual(frames, [
      { 'event': 'message', 'data': 'line1\nline2' },
      { 'event': null, 'data': 'after' },
    ]);
  });

  void it('reassembles a data: line split across chunk boundaries', async () => {
    const stream = ByteStream.of(['data: he', 'llo world\n\n']);

    const frames = await AsyncIterableCollector.of(SseLineParser.linesOf(stream));

    assert.deepEqual(frames, [{ 'event': null, 'data': 'hello world' }]);
  });

  void it('surfaces a [DONE] sentinel as an ordinary frame', async () => {
    const stream = ByteStream.of(['data: [DONE]\n\n']);

    const frames = await AsyncIterableCollector.of(SseLineParser.linesOf(stream));

    assert.deepEqual(frames, [{ 'event': null, 'data': '[DONE]' }]);
  });

  void it('flushes a trailing frame with no closing blank line', async () => {
    const stream = ByteStream.of(['data: no-trailing-newline']);

    const frames = await AsyncIterableCollector.of(SseLineParser.linesOf(stream));

    assert.deepEqual(frames, [{ 'event': null, 'data': 'no-trailing-newline' }]);
  });

  void it('flushes frames under CRLF line endings (blank separator is "\\r")', async () => {
    const stream = ByteStream.of(['data: a\r\n\r\ndata: b\r\n\r\n']);

    const frames = await AsyncIterableCollector.of(SseLineParser.linesOf(stream));

    assert.deepEqual(frames, [
      { 'event': null, 'data': 'a' },
      { 'event': null, 'data': 'b' },
    ]);
  });

  void it('strips only one leading space after "data:", preserving inner and trailing whitespace', async () => {
    // Per the SSE spec, exactly one leading space after the colon is stripped;
    // any further leading spaces, inner spaces, and trailing spaces survive.
    const stream = ByteStream.of(['data:  two leading, inner  and trailing   \n\n']);

    const frames = await AsyncIterableCollector.of(SseLineParser.linesOf(stream));

    assert.deepEqual(frames, [{ 'event': null, 'data': ' two leading, inner  and trailing   ' }]);
  });

  void it('strips no character when "data:" has no leading space', async () => {
    const stream = ByteStream.of(['data:noSpace\n\n']);

    const frames = await AsyncIterableCollector.of(SseLineParser.linesOf(stream));

    assert.deepEqual(frames, [{ 'event': null, 'data': 'noSpace' }]);
  });
});

// ── 2. OpenAiCompatibleAdapter.chatStream ──────────────────────────────────────

/** Builds an SSE stub fetch that returns `sseText` as the response body and records every fetch init. */
class StreamFetchStub {
  static of(sseText: string): { readonly calls: RequestInit[]; readonly fetch: typeof globalThis.fetch } {
    const calls: RequestInit[] = [];
    const fetchImpl: typeof globalThis.fetch = (_input, init) => {
      if (init !== undefined) calls.push(init);
      return Promise.resolve(new Response(ByteStream.of([sseText]), {
        'status': 200,
        'headers': { 'content-type': 'text/event-stream' },
      }));
    };
    return { calls, 'fetch': fetchImpl };
  }
}

const SSE_BODY = [
  'data: {"choices":[{"delta":{"content":"Hel"},"finish_reason":null}]}\n\n',
  'data: {"choices":[{"delta":{"content":"lo"},"finish_reason":null}]}\n\n',
  'data: {"choices":[],"usage":{"prompt_tokens":5,"completion_tokens":2}}\n\n',
  'data: [DONE]\n\n',
].join('');

void describe('OpenAiCompatibleAdapter.chatStream — text turn', () => {
  void it('pushes deltas in order and returns the concatenated text, finishReason, and usage', async () => {
    const adapter = OpenAiCompatibleAdapter.groq('test-key');
    const sink = new CollectingSink();
    const stubbed = StreamFetchStub.of(SSE_BODY);
    const calls = stubbed.calls;

    const response = await FetchHarness.with(stubbed.fetch, () => adapter.chatStream(
      ChatRequestBuilder.from({ 'messages': [{ 'role': 'user', 'content': 'Hi.' }], 'maxTokens': 64 }),
      sink,
    ));

    assert.deepEqual(sink.deltas, ['Hel', 'lo']);
    assert.equal(response.message.variant, 'text');
    assert.equal(response.message.variant === 'text' ? response.message.content : '', 'Hello');
    assert.equal(response.finishReason, 'stop');
    assert.deepEqual(response.usage, { 'promptTokens': 5, 'completionTokens': 2 });

    assert.equal(calls.length, 1, 'exactly one fetch call');
    const body: unknown = JSON.parse(typeof calls[0]?.body === 'string' ? calls[0].body : '{}');
    assert.ok(JsonRecord.is(body));
    assert.equal(body['stream'], true, 'must request stream: true');
    assert.deepEqual(body['stream_options'], { 'include_usage': true });
  });

  void it('maps a length finish_reason through to the returned response', async () => {
    const lengthSse = [
      'data: {"choices":[{"delta":{"content":"cut"},"finish_reason":"length"}]}\n\n',
      'data: [DONE]\n\n',
    ].join('');
    const adapter = OpenAiCompatibleAdapter.groq('test-key');
    const sink = new CollectingSink();
    const stubbed = StreamFetchStub.of(lengthSse);

    const response = await FetchHarness.with(stubbed.fetch, () => adapter.chatStream(
      ChatRequestBuilder.from({ 'messages': [{ 'role': 'user', 'content': 'Hi.' }] }),
      sink,
    ));

    assert.equal(response.finishReason, 'length');
    assert.deepEqual(sink.deltas, ['cut']);
  });
});

// ── 3. Tool-turn fallback to the buffered default ─────────────────────────────

void describe('OpenAiCompatibleAdapter.chatStream — tool turn falls back to buffered', () => {
  void it('never sends stream: true and pushes exactly one chunk carrying the full text', async () => {
    const adapter = OpenAiCompatibleAdapter.groq('test-key');
    const sink = new CollectingSink();
    const calls: RequestInit[] = [];
    const bufferedFetch: typeof globalThis.fetch = (_input, init) => {
      if (init !== undefined) calls.push(init);
      return Promise.resolve(new Response(JSON.stringify({
        'choices': [{ 'message': { 'content': 'tool-turn ok' }, 'finish_reason': 'stop' }],
        'usage': { 'prompt_tokens': 1, 'completion_tokens': 1 },
      }), { 'status': 200, 'headers': { 'content-type': 'application/json' } }));
    };

    const request = ChatRequestBuilder.from({
      'messages': [{ 'role': 'user', 'content': 'Call a tool.' }],
      'tools': [{
        'name': 'foo',
        'description': 'A tool.',
        'inputSchema': { 'type': 'object' },
        'outputSchema': { 'type': 'object' },
        'strict': false,
      }],
    });

    const response = await FetchHarness.with(bufferedFetch, () => adapter.chatStream(request, sink));

    assert.equal(calls.length, 1, 'exactly one fetch call (buffered, not streamed)');
    const body: unknown = JSON.parse(typeof calls[0]?.body === 'string' ? calls[0].body : '{}');
    assert.ok(JsonRecord.is(body));
    assert.ok(!('stream' in body), 'buffered fallback must not set stream: true');

    assert.equal(sink.deltas.length, 1, 'buffered default pushes exactly one chunk');
    assert.equal(sink.deltas[0], 'tool-turn ok');
    assert.equal(response.message.variant, 'text');
    assert.equal(response.finishReason, 'stop');
  });
});
