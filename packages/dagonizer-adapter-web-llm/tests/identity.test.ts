import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { WebLlmAdapter } from '../src/index.js';

interface MutableGlobal {
  navigator?: unknown;
}

function installNavigator(nav: unknown): void {
  (globalThis as MutableGlobal).navigator = nav;
}

function removeNavigator(): void {
  delete (globalThis as MutableGlobal).navigator;
}

void test('WebLlmAdapter identity', () => {
  const a = new WebLlmAdapter();
  assert.equal(a.id, 'web-llm');
  assert.equal(a.capabilities.toolUse, 'partial');
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
