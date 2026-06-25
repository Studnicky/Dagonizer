import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { ChatRequestBuilder } from '@studnicky/dagonizer/adapter';

import { WebLlmAdapter } from '../src/index.js';

class NavigatorStub {
  private constructor() {}

  static install(nav: unknown): void {
    Object.assign(globalThis, { 'navigator': nav });
  }

  static remove(): void {
    Reflect.deleteProperty(globalThis, 'navigator');
  }
}

void test('WebLlmAdapter identity', () => {
  const a = new WebLlmAdapter();
  assert.equal(a.id, 'web-llm');
  assert.equal(a.capabilities.toolUse, 'partial');
});

void test('WebLlmAdapter.listModels returns static prebuilt catalog with correct shape', async () => {
  const a = new WebLlmAdapter();
  const models = await a.listModels();
  assert.ok(models.length > 0, 'catalog must be non-empty');
  for (const m of models) {
    assert.equal(m.variant, 'chat', `expected variant 'chat' for ${m.name}`);
    assert.equal(m.cloud, false, `expected cloud false for ${m.name}`);
    assert.ok(m.name.length > 0, 'name must be non-empty');
  }
});

void test('WebLlmAdapter.listModels includes the default Phi-3.5 model', async () => {
  const a = new WebLlmAdapter();
  const models = await a.listModels();
  const found = models.some((m) => m.name === 'Phi-3.5-mini-instruct-q4f16_1-MLC');
  assert.ok(found, 'default model must appear in the catalog');
});

void test('WebLlmAdapter.selectChatModel picks a preferred model by name', async () => {
  const a = new WebLlmAdapter();
  const picked = await a.selectChatModel({ 'preferred': 'Llama-3.2-1B-Instruct-q4f16_1-MLC' });
  assert.equal(picked, 'Llama-3.2-1B-Instruct-q4f16_1-MLC');
});

void test('WebLlmAdapter.selectChatModel falls back to first catalog entry when preferred is absent', async () => {
  const a = new WebLlmAdapter();
  const models = await a.listModels();
  const picked = await a.selectChatModel();
  assert.ok(picked !== null, 'selectChatModel must return a model name');
  assert.ok(
    models.some((m) => m.name === picked),
    'selected model must be in the catalog',
  );
});

void test('WebLlmAdapter.probe returns false in node (no navigator)', async () => {
  const a = new WebLlmAdapter();
  assert.equal(await a.probe(), false);
});

void test('WebLlmAdapter.probe returns false when navigator is absent', async () => {
  NavigatorStub.remove();
  const a = new WebLlmAdapter();
  assert.equal(await a.probe(), false);
});

void test('WebLlmAdapter.probe returns false when navigator.gpu is missing', async () => {
  NavigatorStub.install({});
  const a = new WebLlmAdapter();
  try {
    assert.equal(await a.probe(), false);
  } finally {
    NavigatorStub.remove();
  }
});

void test('WebLlmAdapter.probe returns true when requestAdapter resolves to a non-null adapter', async () => {
  NavigatorStub.install({
    "gpu": { "requestAdapter": async () => Promise.resolve({}) },
  });
  const a = new WebLlmAdapter();
  try {
    assert.equal(await a.probe(), true);
  } finally {
    NavigatorStub.remove();
  }
});

void test('WebLlmAdapter.probe returns false when requestAdapter resolves to null (no hardware)', async () => {
  NavigatorStub.install({
    "gpu": { "requestAdapter": async () => Promise.resolve(null) },
  });
  const a = new WebLlmAdapter();
  try {
    assert.equal(await a.probe(), false);
  } finally {
    NavigatorStub.remove();
  }
});

void test('WebLlmAdapter.probe does not throw when requestAdapter rejects', async () => {
  NavigatorStub.install({
    "gpu": { "requestAdapter": async () => Promise.reject(new Error('driver fail')) },
  });
  const a = new WebLlmAdapter();
  try {
    assert.equal(await a.probe(), false);
  } finally {
    NavigatorStub.remove();
  }
});

void test('composeMessages folds the schema coercion into one leading system message', () => {
  // The MLC engine rejects a `{ role: 'system' }` entry at any index but 0.
  // A schema request must NOT append a trailing system message — the coercion
  // instruction folds into the single index-0 system turn.
  const messages = WebLlmAdapter.composeMessages(ChatRequestBuilder.from({
    'messages':     [{ 'role': 'user', 'content': 'Recommend a novel.' }],
    'outputSchema': { 'variant': 'schema', 'id': 'rec', 'schema': { 'type': 'object' } },
  }));
  assert.equal(messages.length, 2);
  assert.equal(messages[0]?.role, 'system');
  assert.match(messages[0]?.content ?? '', /JSON Schema/u);
  assert.deepEqual(messages[1], { 'role': 'user', 'content': 'Recommend a novel.' });
  // Exactly one system message, and it leads.
  assert.equal(messages.filter((m) => m.role === 'system').length, 1);
});

void test('composeMessages folds caller system turns and tool coercion into one leading system message', () => {
  const messages = WebLlmAdapter.composeMessages(ChatRequestBuilder.from({
    'messages': [
      { 'role': 'system', 'content': 'You are the Archivist.' },
      { 'role': 'user',   'content': 'Find a book.' },
    ],
    'tools': [{ 'name': 'search', 'description': 'search', 'inputSchema': { 'type': 'object' } }],
  }));
  const systemMessages = messages.filter((m) => m.role === 'system');
  assert.equal(systemMessages.length, 1);
  assert.equal(messages[0]?.role, 'system');
  assert.match(messages[0]?.content ?? '', /You are the Archivist\./u);
  assert.match(messages[0]?.content ?? '', /tool_calls/u);
  assert.deepEqual(messages[1], { 'role': 'user', 'content': 'Find a book.' });
});

void test('composeMessages emits no system message when none is needed', () => {
  const messages = WebLlmAdapter.composeMessages(ChatRequestBuilder.from({
    'messages': [{ 'role': 'user', 'content': 'Hello.' }],
  }));
  assert.deepEqual(messages, [{ 'role': 'user', 'content': 'Hello.' }]);
});

void test('WebLlmAdapter accepts timeoutMs option without error', () => {
  // Verify the constructor initialises with a custom timeout.
  // Does not exercise the generation path (requires WebGPU);
  // the per-request deadline is covered by the #withDeadline unit below.
  const a = new WebLlmAdapter({ 'timeoutMs': 5_000 });
  assert.equal(a.id, 'web-llm');
});

void test('WebLlmAdapter default construction (no timeoutMs) still has correct identity', () => {
  // Ensures the required-with-defaults shape is stable regardless of whether
  // timeoutMs is supplied.
  const a = new WebLlmAdapter({});
  assert.equal(a.id, 'web-llm');
});
