import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { WebLlmAdapter } from '../src/index.js';

function installNavigator(nav: unknown): void {
  Object.assign(globalThis, { 'navigator': nav });
}

function removeNavigator(): void {
  Reflect.deleteProperty(globalThis, 'navigator');
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
  removeNavigator();
  const a = new WebLlmAdapter();
  assert.equal(await a.probe(), false);
});

void test('WebLlmAdapter.probe returns false when navigator.gpu is missing', async () => {
  installNavigator({});
  const a = new WebLlmAdapter();
  try {
    assert.equal(await a.probe(), false);
  } finally {
    removeNavigator();
  }
});

void test('WebLlmAdapter.probe returns true when requestAdapter resolves to a non-null adapter', async () => {
  installNavigator({
    "gpu": { "requestAdapter": async () => Promise.resolve({}) },
  });
  const a = new WebLlmAdapter();
  try {
    assert.equal(await a.probe(), true);
  } finally {
    removeNavigator();
  }
});

void test('WebLlmAdapter.probe returns false when requestAdapter resolves to null (no hardware)', async () => {
  installNavigator({
    "gpu": { "requestAdapter": async () => Promise.resolve(null) },
  });
  const a = new WebLlmAdapter();
  try {
    assert.equal(await a.probe(), false);
  } finally {
    removeNavigator();
  }
});

void test('WebLlmAdapter.probe does not throw when requestAdapter rejects', async () => {
  installNavigator({
    "gpu": { "requestAdapter": async () => Promise.reject(new Error('driver fail')) },
  });
  const a = new WebLlmAdapter();
  try {
    assert.equal(await a.probe(), false);
  } finally {
    removeNavigator();
  }
});
