/**
 * Smoke: OllamaApiAdapter exposes the expected id, display name, and capability shape.
 * No network calls; instantiation only.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { OllamaApiAdapter } from '../src/index.js';

void test('OllamaApiAdapter identity + capabilities', () => {
  const adapter = new OllamaApiAdapter();

  assert.equal(adapter.id, 'ollama');
  assert.ok(adapter.displayName.toLowerCase().includes('ollama'));
  assert.equal(adapter.capabilities.toolUse, 'partial');
  assert.equal(adapter.capabilities.structuredOutput, true);
  assert.equal(adapter.capabilities.jsonMode, true);
});

void test('OllamaApiAdapter accepts model + baseUrl overrides without throwing', () => {
  const adapter = new OllamaApiAdapter({
    "model": 'mistral:latest',
    "baseUrl": 'http://10.0.0.5:11434'
  });

  assert.equal(adapter.id, 'ollama');
});

void test('OllamaApiAdapter accepts custom apiKey for proxied deployments', () => {
  const adapter = new OllamaApiAdapter({ "apiKey": 'gateway-token-123' });

  assert.equal(adapter.id, 'ollama');
});

interface MutableGlobal {
  fetch?: unknown;
}

const originalFetch = (globalThis as MutableGlobal).fetch;

function installFetch(impl: typeof fetch): void {
  (globalThis as MutableGlobal).fetch = impl;
}

function restoreFetch(): void {
  (globalThis as MutableGlobal).fetch = originalFetch;
}

void test('OllamaApiAdapter.probe returns true when /api/tags answers 200', async () => {
  installFetch((async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    assert.ok(url.endsWith('/api/tags'));
    return new Response('{"models":[]}', { "status": 200 });
  }) as typeof fetch);
  const adapter = new OllamaApiAdapter({ "baseUrl": 'http://127.0.0.1:11434' });
  try {
    assert.equal(await adapter.probe(), true);
  } finally {
    restoreFetch();
  }
});

void test('OllamaApiAdapter.probe returns false when /api/tags answers non-2xx', async () => {
  installFetch((async () => new Response('nope', { "status": 500 })) as typeof fetch);
  const adapter = new OllamaApiAdapter();
  try {
    assert.equal(await adapter.probe(), false);
  } finally {
    restoreFetch();
  }
});

void test('OllamaApiAdapter.probe returns false when fetch rejects (daemon down)', async () => {
  installFetch((async () => { throw new Error('ECONNREFUSED'); }) as typeof fetch);
  const adapter = new OllamaApiAdapter();
  try {
    assert.equal(await adapter.probe(), false);
  } finally {
    restoreFetch();
  }
});

void test('OllamaApiAdapter.probe returns false on abort/timeout without throwing', async () => {
  installFetch(((_input: string | URL | Request, init?: { signal?: AbortSignal }) => {
    return new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (signal !== undefined) {
        signal.addEventListener('abort', () => { reject(new Error('aborted')); });
      }
    });
  }) as typeof fetch);
  const adapter = new OllamaApiAdapter();
  try {
    assert.equal(await adapter.probe(), false);
  } finally {
    restoreFetch();
  }
});

void test('OllamaApiAdapter.probe hits the configured baseUrl, not the default', async () => {
  let seen = '';
  installFetch((async (input: string | URL | Request) => {
    seen = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    return new Response('{}', { "status": 200 });
  }) as typeof fetch);
  const adapter = new OllamaApiAdapter({ "baseUrl": 'http://10.0.0.5:11434' });
  try {
    await adapter.probe();
    assert.equal(seen, 'http://10.0.0.5:11434/api/tags');
  } finally {
    restoreFetch();
  }
});
