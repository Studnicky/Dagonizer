import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { GeminiNanoAdapter, detectGeminiNano } from '../src/index.js';

interface MutableGlobal {
  LanguageModel?: unknown;
}

function installLanguageModel(stub: unknown): void {
  (globalThis as MutableGlobal).LanguageModel = stub;
}

function removeLanguageModel(): void {
  delete (globalThis as MutableGlobal).LanguageModel;
}

void test('GeminiNanoAdapter identity', () => {
  const a = new GeminiNanoAdapter();
  assert.equal(a.id, 'gemini-nano');
  assert.equal(a.capabilities.toolUse, 'none');
});

void test('detectGeminiNano returns unavailable in node', async () => {
  const status = await detectGeminiNano();
  assert.equal(status, 'unavailable');
});

void test('GeminiNanoAdapter.probe returns false when window.LanguageModel is absent', async () => {
  removeLanguageModel();
  const a = new GeminiNanoAdapter();
  assert.equal(await a.probe(), false);
});

void test('GeminiNanoAdapter.probe returns true when availability() reports "available"', async () => {
  installLanguageModel({
    availability: async () => Promise.resolve('available'),
    create: async () => Promise.resolve({ prompt: async () => Promise.resolve(''), destroy: () => {} }),
  });
  const a = new GeminiNanoAdapter();
  try {
    assert.equal(await a.probe(), true);
  } finally {
    removeLanguageModel();
  }
});

void test('GeminiNanoAdapter.probe returns false when availability() reports "downloadable"', async () => {
  installLanguageModel({
    availability: async () => Promise.resolve('downloadable'),
    create: async () => Promise.resolve({ prompt: async () => Promise.resolve(''), destroy: () => {} }),
  });
  const a = new GeminiNanoAdapter();
  try {
    assert.equal(await a.probe(), false);
  } finally {
    removeLanguageModel();
  }
});

void test('GeminiNanoAdapter.probe does not throw when availability() rejects', async () => {
  installLanguageModel({
    availability: async () => Promise.reject(new Error('boom')),
    create: async () => Promise.resolve({ prompt: async () => Promise.resolve(''), destroy: () => {} }),
  });
  const a = new GeminiNanoAdapter();
  try {
    assert.equal(await a.probe(), false);
  } finally {
    removeLanguageModel();
  }
});
