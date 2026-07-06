/**
 * Tests for `WebLlmAdapter.performChatStream` abort handling and tool-turn
 * buffering.
 *
 * Uses the same "class extension is the only extension mechanism" pattern
 * as `stream-deltas.test.ts`: override `loadEngine()` to inject a stub
 * engine, and go through the public `chatStream` entry point on
 * `BaseAdapter` (never call the protected `performChatStream` directly).
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import type { StreamSinkInterface } from '@studnicky/dagonizer';
import { ChatRequest } from '@studnicky/dagonizer/adapter';
import type { ChatStreamChunkType } from '@studnicky/dagonizer/adapter';

import { WebLlmAdapter } from '../src/index.js';
import type { WebLlmEngineType, WebLlmStreamChunkType, WebLlmStreamingParamsType } from '../src/index.js';

/**
 * Engine stub whose generator yields deltas on a macrotask boundary between
 * each chunk (via `setTimeout`), leaving a window for a test to abort the
 * request's signal mid-stream. Records every `interruptGenerate()` call and
 * every chunk actually yielded so the test can assert generation stopped
 * promptly instead of draining to completion.
 */
class AbortableStub {
  readonly 'interruptGenerate': () => void;
  readonly 'chat': WebLlmEngineType['chat'];
  readonly interruptCalls: number[] = [];
  readonly yielded: string[] = [];

  constructor() {
    const stub = this;
    let interruptCount = 0;

    async function* streamGen(): AsyncGenerator<WebLlmStreamChunkType> {
      for (let i = 0; i < 5; i++) {
        await new Promise<void>((resolve) => { setTimeout(resolve, 5); });
        const content = `chunk${String(i)}`;
        stub.yielded.push(content);
        yield { 'choices': [{ 'delta': { 'content': content } }] };
      }
    }

    this['interruptGenerate'] = (): void => {
      interruptCount += 1;
      stub.interruptCalls.push(interruptCount);
    };

    this['chat'] = {
      'completions': {
        'create': (_params: WebLlmStreamingParamsType): Promise<AsyncIterable<WebLlmStreamChunkType>> =>
          Promise.resolve(streamGen()),
      },
    };
  }
}

/**
 * Engine stub for the tool-turn test: the underlying transport still yields
 * per-token deltas (both `performChat` and `performChatStream` open the same
 * stream via `#openStream`), but a tool-bearing request must route through
 * `super.performChatStream` — which drains the stream through the buffered
 * `chat()`/`performChat` path and pushes exactly ONE assembled chunk to
 * `sink`, never the raw per-token deltas.
 */
class ToolTurnStub {
  readonly 'interruptGenerate': () => void;
  readonly 'chat': WebLlmEngineType['chat'];

  constructor() {
    async function* streamGen(): AsyncGenerator<WebLlmStreamChunkType> {
      yield { 'choices': [{ 'delta': { 'content': '{"tool_calls":' } }] };
      yield { 'choices': [{ 'delta': { 'content': '[]}' } }] };
    }

    this['interruptGenerate'] = (): void => {};
    this['chat'] = {
      'completions': {
        'create': (_params: WebLlmStreamingParamsType): Promise<AsyncIterable<WebLlmStreamChunkType>> =>
          Promise.resolve(streamGen()),
      },
    };
  }
}

class AbortTestAdapter extends WebLlmAdapter {
  readonly #stub: WebLlmEngineType;

  constructor(stub: WebLlmEngineType) {
    super({ 'timeoutMs': 5_000 });
    this.#stub = stub;
  }

  protected override loadEngine(): Promise<WebLlmEngineType> {
    return Promise.resolve(this.#stub);
  }
}

/** Test double for `StreamSinkInterface<ChatStreamChunkType>` that records every pushed chunk in arrival order. */
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

void test('performChatStream: aborting mid-stream rejects and stops generation', async () => {
  const stub = new AbortableStub();
  const adapter = new AbortTestAdapter(stub);
  const sink = new RecordingSink();
  const controller = new AbortController();

  const request = ChatRequest.create({
    'messages': [{ 'role': 'user', 'content': 'Say hello.' }],
    'signal':   controller.signal,
  });

  const pending = adapter.chatStream(request, sink);

  // Abort after the first chunk has had time to yield, but before the
  // generator completes — the loop-level `request.signal.aborted` check must
  // catch the next iteration and stop before all 5 chunks are drained.
  setTimeout(() => { controller.abort(new Error('user cancelled')); }, 8);

  await assert.rejects(pending);

  // The stub's generator awaits a macrotask between yields; give any
  // still-running background iteration a chance to misbehave before
  // asserting nothing further was pushed or yielded.
  await new Promise((resolve) => { setTimeout(resolve, 40); });

  assert.ok(stub.yielded.length < 5, 'generation must not have drained to completion after abort');
  const pushedAtAbort = sink.pushed.length;
  await new Promise((resolve) => { setTimeout(resolve, 40); });
  assert.equal(sink.pushed.length, pushedAtAbort, 'no further deltas must be pushed after abort settles the call');
});

void test('performChatStream: a tool-bearing request routes to buffered default, not token streaming', async () => {
  const stub = new ToolTurnStub();
  const adapter = new AbortTestAdapter(stub);
  const sink = new RecordingSink();

  const request = ChatRequest.create({
    'messages': [{ 'role': 'user', 'content': 'Use a tool.' }],
    'tools':    [{ 'name': 'noop', 'description': 'does nothing', 'inputSchema': { 'type': 'object' } }],
  });

  // `performChat` on the buffered fallback path ultimately calls
  // `#openStream` too (shared setup), but only once, non-streamed: assert
  // the sink receives exactly one buffered chunk rather than several
  // token-sized deltas, which is what would happen if `create` were invoked
  // directly by `performChatStream`.
  await assert.doesNotReject(adapter.chatStream(request, sink));
  assert.equal(sink.pushed.length, 1, 'a tool-bearing request must buffer into exactly one pushed chunk');
});
