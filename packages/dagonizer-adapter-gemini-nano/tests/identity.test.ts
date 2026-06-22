import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { GeminiNanoAdapter } from '../src/index.js';

class LanguageModelStub {
  private constructor() {}

  static install(stub: unknown): void {
    Object.assign(globalThis, { 'LanguageModel': stub });
  }

  static remove(): void {
    Reflect.deleteProperty(globalThis, 'LanguageModel');
  }
}

void test('GeminiNanoAdapter identity', () => {
  const a = new GeminiNanoAdapter();
  assert.equal(a.id, 'gemini-nano');
  assert.equal(a.capabilities.toolUse, 'partial');
});

void test('GeminiNanoAdapter.detect returns unavailable in node', async () => {
  const status = await GeminiNanoAdapter.detect();
  assert.equal(status, 'unavailable');
});

void test('GeminiNanoAdapter.probe returns false when window.LanguageModel is absent', async () => {
  LanguageModelStub.remove();
  const a = new GeminiNanoAdapter();
  assert.equal(await a.probe(), false);
});

void test('GeminiNanoAdapter.probe returns true when availability() reports "available"', async () => {
  LanguageModelStub.install({
    "availability": async () => Promise.resolve('available'),
    "create": async () => Promise.resolve({ "prompt": async () => Promise.resolve(''), "destroy": () => {} }),
  });
  const a = new GeminiNanoAdapter();
  try {
    assert.equal(await a.probe(), true);
  } finally {
    LanguageModelStub.remove();
  }
});

void test('GeminiNanoAdapter.probe returns false when availability() reports "downloadable"', async () => {
  LanguageModelStub.install({
    "availability": async () => Promise.resolve('downloadable'),
    "create": async () => Promise.resolve({ "prompt": async () => Promise.resolve(''), "destroy": () => {} }),
  });
  const a = new GeminiNanoAdapter();
  try {
    assert.equal(await a.probe(), false);
  } finally {
    LanguageModelStub.remove();
  }
});

void test('GeminiNanoAdapter.probe does not throw when availability() rejects', async () => {
  LanguageModelStub.install({
    "availability": async () => Promise.reject(new Error('boom')),
    "create": async () => Promise.resolve({ "prompt": async () => Promise.resolve(''), "destroy": () => {} }),
  });
  const a = new GeminiNanoAdapter();
  try {
    assert.equal(await a.probe(), false);
  } finally {
    LanguageModelStub.remove();
  }
});

void test('GeminiNanoAdapter.listModels returns single gemini-nano descriptor', async () => {
  const a = new GeminiNanoAdapter();
  const models = await a.listModels();
  assert.equal(models.length, 1);
  const [m] = models;
  assert.ok(m !== undefined);
  assert.equal(m.name, 'gemini-nano');
  assert.equal(m.variant, 'chat');
  assert.equal(m.cloud, false);
});

void test('GeminiNanoAdapter.listModels requires no window.LanguageModel', async () => {
  LanguageModelStub.remove();
  const a = new GeminiNanoAdapter();
  const models = await a.listModels();
  assert.equal(models.length, 1);
  assert.equal(models[0]?.name, 'gemini-nano');
});

void test('GeminiNanoAdapter.selectChatModel picks gemini-nano', async () => {
  const a = new GeminiNanoAdapter();
  const picked = await a.selectChatModel({ 'preferred': 'gemini-nano' });
  assert.equal(picked, 'gemini-nano');
});

void test('GeminiNanoAdapter.selectChatModel with no preferred picks the single model', async () => {
  const a = new GeminiNanoAdapter();
  const picked = await a.selectChatModel();
  assert.equal(picked, 'gemini-nano');
});
