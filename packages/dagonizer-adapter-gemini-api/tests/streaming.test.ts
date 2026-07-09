import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import type { ChatStreamChunkType, StreamSinkInterface } from '@studnicky/dagonizer/adapter';
import { ChatRequest, LlmError } from '@studnicky/dagonizer/adapter';

import { GeminiApiAdapter } from '../src/index.js';

// ---------------------------------------------------------------------------
// Helpers shared by the chatStream wire-shape tests
// ---------------------------------------------------------------------------

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

class FetchStub {
  private constructor() {}

  static install(impl: (input: string | URL | Request, init?: RequestInit) => Promise<Response>): () => void {
    const original: typeof fetch | undefined = globalThis.fetch;
    Object.assign(globalThis, { 'fetch': impl });
    return () => {
      Object.assign(globalThis, { 'fetch': original });
    };
  }
}

// Gemini's `streamGenerateContent?alt=sse` frames carry no `event:` line and
// no `[DONE]` sentinel — each `data:` frame is a full (partial)
// `generateContent` response body.
const SSE_BODY = [
  'data: {"candidates":[{"content":{"parts":[{"text":"Hel"}]}}]}\n\n',
  'data: {"candidates":[{"content":{"parts":[{"text":"lo"}]}}]}\n\n',
  'data: {"candidates":[{"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":5,"candidatesTokenCount":2}}\n\n',
].join('');

// ---------------------------------------------------------------------------
// chatStream — true streaming, text turn
// ---------------------------------------------------------------------------

void test('chatStream pushes deltas in order and returns the concatenated text, finishReason, and usage', async () => {
  let capturedUrl: string | undefined;
  const restore = FetchStub.install((input) => {
    capturedUrl = String(input);
    return Promise.resolve(new Response(ByteStream.of([SSE_BODY]), {
      'status': 200,
      'headers': { 'content-type': 'text/event-stream' },
    }));
  });
  try {
    const adapter = new GeminiApiAdapter('key', { 'model': 'gemini-2.0-flash', 'maxAttempts': 1 });
    const sink = new CollectingSink();
    const request = ChatRequest.create({ 'messages': [{ 'role': 'user', 'content': 'Hi.' }] });

    const response = await adapter.chatStream(request, sink);

    assert.deepEqual(sink.deltas, ['Hel', 'lo']);
    assert.equal(response.message.variant, 'text');
    assert.equal(response.message.variant === 'text' ? response.message.content : '', 'Hello');
    assert.equal(response.finishReason, 'stop');
    assert.deepEqual(response.usage, { 'promptTokens': 5, 'completionTokens': 2 });

    assert.ok(capturedUrl !== undefined);
    assert.ok(capturedUrl.includes(':streamGenerateContent'), 'must hit the streamGenerateContent endpoint');
    assert.ok(capturedUrl.includes('alt=sse'), 'must request alt=sse');
  } finally {
    restore();
  }
});

void test('chatStream maps a MAX_TOKENS finishReason through to the returned response', async () => {
  const lengthSse = [
    'data: {"candidates":[{"content":{"parts":[{"text":"cut"}]},"finishReason":"MAX_TOKENS"}]}\n\n',
  ].join('');
  const restore = FetchStub.install(() =>
    Promise.resolve(new Response(ByteStream.of([lengthSse]), {
      'status': 200,
      'headers': { 'content-type': 'text/event-stream' },
    })),
  );
  try {
    const adapter = new GeminiApiAdapter('key', { 'model': 'gemini-2.0-flash', 'maxAttempts': 1 });
    const sink = new CollectingSink();
    const request = ChatRequest.create({ 'messages': [{ 'role': 'user', 'content': 'Hi.' }] });

    const response = await adapter.chatStream(request, sink);

    assert.equal(response.finishReason, 'length');
    assert.deepEqual(sink.deltas, ['cut']);
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// chatStream — tool turn uses the buffered default
// ---------------------------------------------------------------------------

void test('chatStream uses generateContent (buffered) when the request carries tools', async () => {
  let capturedUrl: string | undefined;
  const restore = FetchStub.install((input) => {
    capturedUrl = String(input);
    return Promise.resolve(new Response(JSON.stringify({
      'candidates': [{ 'content': { 'parts': [{ 'text': 'tool-turn ok' }] }, 'finishReason': 'STOP' }],
    }), { 'status': 200 }));
  });
  try {
    const adapter = new GeminiApiAdapter('key', { 'model': 'gemini-2.0-flash', 'maxAttempts': 1 });
    const sink = new CollectingSink();
    const request = ChatRequest.create({
      'messages': [{ 'role': 'user', 'content': 'Call a tool.' }],
      'tools': [{
        'name': 'foo',
        'description': 'A tool.',
        'inputSchema': { 'type': 'object' },
        'outputSchema': { 'type': 'object' },
        'strict': false,
      }],
    });

    const response = await adapter.chatStream(request, sink);

    assert.ok(capturedUrl !== undefined);
    assert.ok(capturedUrl.includes(':generateContent'), 'must hit the buffered generateContent endpoint');
    assert.ok(!capturedUrl.includes('streamGenerateContent'), 'must not hit the streaming endpoint');
    assert.equal(sink.deltas.length, 1, 'buffered default pushes exactly one chunk');
    assert.equal(sink.deltas[0], 'tool-turn ok');
    assert.equal(response.finishReason, 'stop');
  } finally {
    restore();
  }
});

void test('chatStream rejects with a NETWORK LlmError when the streamed response has no body', async () => {
  const restore = FetchStub.install(() =>
    Promise.resolve(new Response(null, { 'status': 200 })),
  );
  try {
    const adapter = new GeminiApiAdapter('key', { 'model': 'gemini-2.0-flash', 'maxAttempts': 1 });
    const sink = new CollectingSink();
    const request = ChatRequest.create({ 'messages': [{ 'role': 'user', 'content': 'Hi.' }] });

    await assert.rejects(() => adapter.chatStream(request, sink));
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// chatStream — mid-stream error frame
// ---------------------------------------------------------------------------

void test('chatStream rejects with a classified LlmError when a mid-stream frame carries a top-level error', async () => {
  const errorSse = 'data: {"error":{"code":429,"message":"quota exceeded","status":"RESOURCE_EXHAUSTED"}}\n\n';
  const restore = FetchStub.install(() =>
    Promise.resolve(new Response(ByteStream.of([errorSse]), {
      'status': 200,
      'headers': { 'content-type': 'text/event-stream' },
    })),
  );
  try {
    const adapter = new GeminiApiAdapter('key', { 'model': 'gemini-2.0-flash', 'maxAttempts': 1 });
    const sink = new CollectingSink();
    const request = ChatRequest.create({ 'messages': [{ 'role': 'user', 'content': 'Hi.' }] });

    await assert.rejects(
      () => adapter.chatStream(request, sink),
      (err: unknown) => {
        assert.ok(err instanceof LlmError, 'must reject with an LlmError');
        assert.equal(err.classification.reason, 'QUOTA_EXHAUSTED');
        return true;
      },
    );
    assert.deepEqual(sink.deltas, [], 'no chunk is pushed for an error-only frame');
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// chatStream — mid-stream read failure
// ---------------------------------------------------------------------------

void test('chatStream wraps a mid-stream reader failure in a classified LlmError instead of a raw DOMException', async () => {
  const restore = FetchStub.install(() => {
    const stream = new ReadableStream<Uint8Array>({
      start(streamController): void {
        streamController.enqueue(new TextEncoder().encode('data: {"candidates":[{"content":{"parts":[{"text":"Hel"}]}}]}\n\n'));
      },
      pull(streamController): void {
        // Second read: the connection drops mid-drain — simulates an
        // unclassified DOMException surfacing from the underlying reader,
        // independent of `request.signal` ever being aborted.
        streamController.error(new DOMException('network connection lost', 'NetworkError'));
      },
    });
    return Promise.resolve(new Response(stream, {
      'status': 200,
      'headers': { 'content-type': 'text/event-stream' },
    }));
  });
  try {
    const adapter = new GeminiApiAdapter('key', { 'model': 'gemini-2.0-flash', 'maxAttempts': 1 });
    const sink = new CollectingSink();
    const request = ChatRequest.create({ 'messages': [{ 'role': 'user', 'content': 'Hi.' }] });

    await assert.rejects(
      () => adapter.chatStream(request, sink),
      (err: unknown) => {
        assert.ok(err instanceof LlmError, 'must reject with an LlmError, not a raw DOMException');
        assert.equal(err.classification.reason, 'NETWORK');
        return true;
      },
    );
  } finally {
    restore();
  }
});
