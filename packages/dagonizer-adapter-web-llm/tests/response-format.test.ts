/**
 * Tests for `WebLlmAdapter.performChat` response_format construction.
 *
 * Verifies that the adapter passes `response_format.schema` natively to
 * `engine.chat.completions.create` so `GrammarCompiler.CompileJSONSchema`
 * receives a valid JSON string instead of `undefined`.
 *
 * Uses the same "class extension is the only extension mechanism" pattern
 * as `identity.test.ts`: override `loadEngine()` to inject a stub engine.
 * No `as` casts anywhere — `Reflect.get` is used to read the `schema` field
 * from the response_format object without widening the declared type of the
 * engine stub's `params` parameter.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { ChatRequest } from '@studnicky/dagonizer/adapter';

import { WebLlmAdapter } from '../src/index.js';
import type { WebLlmEngineType, WebLlmStreamingParamsType } from '../src/index.js';

/**
 * A single recorded call to `chat.completions.create`. The `responseFormat`
 * field is captured as `unknown` so the test can inspect the runtime `schema`
 * field that the adapter sets but `WebLlmStreamingParamsType` does not declare.
 * `Reflect.get` is used at the assertion site — no `as` casts.
 */
type ResponseFormatCallType = {
  readonly responseFormat: unknown;
};

/**
 * Engine stub that captures the `response_format` argument from each
 * `chat.completions.create` call. The streaming body yields the supplied
 * chunks so the adapter can complete normally.
 */
class ResponseFormatCaptureStub {
  readonly 'interruptGenerate': () => void;
  readonly 'chat': WebLlmEngineType['chat'];
  readonly calls: ResponseFormatCallType[] = [];

  constructor(chunks: ReadonlyArray<string> = ['{}']) {
    const stub = this;

    async function* streamGen(): AsyncGenerator<{ 'choices': Array<{ 'delta': { 'content': string } }> }> {
      for (const chunk of chunks) {
        yield { 'choices': [{ 'delta': { 'content': chunk } }] };
      }
    }

    this['interruptGenerate'] = (): void => {};

    this['chat'] = {
      'completions': {
        'create': (params: WebLlmStreamingParamsType): Promise<AsyncIterable<{ 'choices': ReadonlyArray<{ 'delta': { 'content'?: string } }> }>> => {
          // Capture response_format as unknown so the test can probe the
          // runtime `schema` field via Reflect.get without an `as` cast.
          stub.calls.push({ 'responseFormat': params['response_format'] });
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
class ResponseFormatTestAdapter extends WebLlmAdapter {
  readonly #stub: WebLlmEngineType;

  constructor(stub: WebLlmEngineType) {
    super({ 'timeoutMs': 5_000 });
    this.#stub = stub;
  }

  protected override loadEngine(): Promise<WebLlmEngineType> {
    return Promise.resolve(this.#stub);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract `response_format.schema` from a captured call record without
 * any `as` cast. Returns `undefined` if the field is absent or the
 * response_format is not an object.
 */
function capturedSchema(record: ResponseFormatCallType): unknown {
  const rf = record.responseFormat;
  if (typeof rf !== 'object' || rf === null) return undefined;
  return Reflect.get(rf, 'schema');
}

/**
 * Extract `response_format.type` from a captured call record.
 */
function capturedType(record: ResponseFormatCallType): unknown {
  const rf = record.responseFormat;
  if (typeof rf !== 'object' || rf === null) return undefined;
  return Reflect.get(rf, 'type');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

void test('response_format: outputSchema variant=schema sends json_object with schema string', async () => {
  const theSchema = { 'type': 'object', 'properties': { 'title': { 'type': 'string' } } };
  const stub = new ResponseFormatCaptureStub([JSON.stringify({ 'title': 'Dune' })]);
  const adapter = new ResponseFormatTestAdapter(stub);

  await adapter.chat(ChatRequest.create({
    'messages':     [{ 'role': 'user', 'content': 'Recommend a novel.' }],
    'outputSchema': { 'variant': 'schema', 'id': 'rec', 'schema': theSchema },
  }));

  assert.equal(stub.calls.length, 1, 'create must be called exactly once');
  const record = stub.calls[0];
  assert.ok(record !== undefined, 'call record must exist');

  assert.equal(capturedType(record), 'json_object', 'type must be json_object for schema mode');

  const schema = capturedSchema(record);
  assert.ok(typeof schema === 'string', 'schema must be a JSON string');
  assert.deepEqual(
    JSON.parse(schema),
    theSchema,
    'schema must equal JSON.stringify(outputSchema.schema)',
  );
});

void test('response_format: tools sends json_object with tool-plan schema string', async () => {
  const stub = new ResponseFormatCaptureStub([JSON.stringify({ 'tool_calls': [{ 'name': 'search', 'arguments': { 'q': 'books' } }] })]);
  const adapter = new ResponseFormatTestAdapter(stub);

  await adapter.chat(ChatRequest.create({
    'messages': [{ 'role': 'user', 'content': 'Find a book.' }],
    'tools': [
      {
        'name':        'search',
        'description': 'search for items',
        'inputSchema': { 'type': 'object', 'properties': { 'q': { 'type': 'string' } } },
      },
    ],
  }));

  assert.equal(stub.calls.length, 1, 'create must be called exactly once');
  const record = stub.calls[0];
  assert.ok(record !== undefined, 'call record must exist');

  assert.equal(capturedType(record), 'json_object', 'type must be json_object for tool calls');

  const schema = capturedSchema(record);
  assert.ok(typeof schema === 'string', 'schema must be a JSON string');

  const parsed: unknown = JSON.parse(schema);
  assert.ok(typeof parsed === 'object' && parsed !== null, 'parsed schema must be an object');

  // The schema must constrain tool_calls[].name to the tool-name enum.
  const props = Reflect.get(parsed, 'properties');
  assert.ok(typeof props === 'object' && props !== null, 'schema must have properties');

  const toolCallsProp = Reflect.get(props, 'tool_calls');
  assert.ok(typeof toolCallsProp === 'object' && toolCallsProp !== null, 'schema must have tool_calls property');

  const itemsDef = Reflect.get(toolCallsProp, 'items');
  assert.ok(typeof itemsDef === 'object' && itemsDef !== null, 'tool_calls must have items');

  // Single-tool path: items is the variant directly (no anyOf wrapping).
  const itemProps = Reflect.get(itemsDef, 'properties');
  assert.ok(typeof itemProps === 'object' && itemProps !== null, 'items must have properties');

  const nameProp = Reflect.get(itemProps, 'name');
  assert.ok(typeof nameProp === 'object' && nameProp !== null, 'items.properties must have name');
  assert.equal(Reflect.get(nameProp, 'const'), 'search', 'name const must equal the tool name');
});

void test('response_format: plain text (no tools, no schema) sends type=text with no schema field', async () => {
  const stub = new ResponseFormatCaptureStub(['Hello!']);
  const adapter = new ResponseFormatTestAdapter(stub);

  await adapter.chat(ChatRequest.create({
    'messages': [{ 'role': 'user', 'content': 'Hi.' }],
  }));

  assert.equal(stub.calls.length, 1, 'create must be called exactly once');
  const record = stub.calls[0];
  assert.ok(record !== undefined, 'call record must exist');

  assert.equal(capturedType(record), 'text', 'type must be text for plain text mode');

  const schema = capturedSchema(record);
  assert.equal(schema, undefined, 'schema must be absent for plain text requests');
});
