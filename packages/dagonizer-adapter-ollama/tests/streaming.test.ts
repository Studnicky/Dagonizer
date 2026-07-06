/**
 * Streaming path coverage for OllamaApiAdapter:
 *   1. chatStream() drains an OpenAI-compatible SSE body, pushing deltas to
 *      the sink in order and assembling the full response.
 *   2. A 404 from the streaming endpoint gets the same Ollama-specific
 *      "ollama pull <model>" translation as the buffered path.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { ChatRequest, LlmError } from '@studnicky/dagonizer/adapter';
import type { ChatStreamChunkType } from '@studnicky/dagonizer/adapter';
import type { StreamSinkInterface } from '@studnicky/dagonizer/contracts';

import { OllamaApiAdapter } from '../src/index.js';

class FetchStub {
  private constructor() {}

  private static readonly original: typeof fetch | undefined = globalThis.fetch;

  static install(impl: (input: string | URL | Request, init?: RequestInit) => Promise<Response>): void {
    Object.assign(globalThis, { 'fetch': impl });
  }

  static restore(): void {
    Object.assign(globalThis, { 'fetch': FetchStub.original });
  }
}

class CollectingSink implements StreamSinkInterface<ChatStreamChunkType> {
  readonly items: ChatStreamChunkType[] = [];

  async push(item: ChatStreamChunkType): Promise<void> {
    this.items.push(item);
    return Promise.resolve();
  }
}

const SSE_BODY = [
  `data: ${JSON.stringify({ 'choices': [{ 'delta': { 'content': 'Hel' }, 'finish_reason': null }] })}`,
  '',
  `data: ${JSON.stringify({ 'choices': [{ 'delta': { 'content': 'lo, ' }, 'finish_reason': null }] })}`,
  '',
  `data: ${JSON.stringify({ 'choices': [{ 'delta': { 'content': 'world!' }, 'finish_reason': 'stop' }] })}`,
  '',
  `data: ${JSON.stringify({ 'choices': [], 'usage': { 'prompt_tokens': 3, 'completion_tokens': 5 } })}`,
  '',
  'data: [DONE]',
  '',
  '',
].join('\n');

void test('OllamaApiAdapter.chatStream drains SSE deltas in order and assembles the full response', async () => {
  FetchStub.install(async (_input: string | URL | Request, init?: RequestInit) => {
    assert.equal(init?.method, 'POST');
    const body = JSON.parse(typeof init?.body === 'string' ? init.body : '') as Record<string, unknown>;
    assert.equal(body['stream'], true);
    return new Response(SSE_BODY, { 'status': 200 });
  });
  const adapter = new OllamaApiAdapter({ 'model': 'llama3:latest' });
  const request = ChatRequest.create({
    'messages': [{ 'role': 'user', 'content': 'hello' }],
  });
  const sink = new CollectingSink();
  try {
    const response = await adapter.chatStream(request, sink);
    assert.deepEqual(sink.items.map((item) => item.delta), ['Hel', 'lo, ', 'world!']);
    assert.equal(response.message.variant === 'tools' ? '' : response.message.content, 'Hello, world!');
    assert.equal(response.finishReason, 'stop');
    assert.equal(response.usage.promptTokens, 3);
    assert.equal(response.usage.completionTokens, 5);
  } finally {
    FetchStub.restore();
  }
});

void test('OllamaApiAdapter.chatStream translates a 404 into the friendly "ollama pull" hint', async () => {
  FetchStub.install(async () => new Response(
    JSON.stringify({ 'error': { 'message': "model 'llama3:latest' not found" } }),
    { 'status': 404 },
  ));
  const adapter = new OllamaApiAdapter({ 'model': 'llama3:latest' });
  const request = ChatRequest.create({
    'messages': [{ 'role': 'user', 'content': 'hello' }],
  });
  const sink = new CollectingSink();
  try {
    let caught: unknown;
    try {
      await adapter.chatStream(request, sink);
    } catch (err) {
      caught = err;
    }
    assert.ok(caught instanceof LlmError, 'chatStream() should reject with an LlmError on 404');
    assert.equal((caught as LlmError).classification.reason, 'MODEL_NOT_FOUND');
    assert.ok(
      (caught as LlmError).message.includes('ollama pull'),
      `message should carry the ollama pull hint, got: ${(caught as LlmError).message}`,
    );
    assert.equal(sink.items.length, 0, 'no deltas should have been pushed before the 404 surfaced');
  } finally {
    FetchStub.restore();
  }
});

const MODEL_NOT_FOUND_MESSAGE_FIXTURES: ReadonlyArray<{ readonly label: string; readonly rawMessage: string }> = [
  { 'label': 'JSON-escaped double quotes', 'rawMessage': 'model "llama2" not found, try pulling it first' },
  { 'label': 'plain single quotes', 'rawMessage': "model 'llama2' not found" },
  { 'label': 'no quotes', 'rawMessage': 'model llama2 not found' },
];

for (const fixture of MODEL_NOT_FOUND_MESSAGE_FIXTURES) {
  void test(
    `OllamaApiAdapter.chatStream extracts the model name from a 404 body with ${fixture.label}`,
    async () => {
      FetchStub.install(async () => new Response(
        JSON.stringify({ 'error': { 'message': fixture.rawMessage } }),
        { 'status': 404 },
      ));
      const adapter = new OllamaApiAdapter({ 'model': 'llama3:latest' });
      const request = ChatRequest.create({
        'messages': [{ 'role': 'user', 'content': 'hello' }],
      });
      const sink = new CollectingSink();
      try {
        let caught: unknown;
        try {
          await adapter.chatStream(request, sink);
        } catch (err) {
          caught = err;
        }
        assert.ok(caught instanceof LlmError, 'chatStream() should reject with an LlmError on 404');
        assert.equal((caught as LlmError).classification.reason, 'MODEL_NOT_FOUND');
        assert.ok(
          (caught as LlmError).message.includes('ollama pull llama2'),
          `message should name the extracted model, got: ${(caught as LlmError).message}`,
        );
      } finally {
        FetchStub.restore();
      }
    },
  );
}
