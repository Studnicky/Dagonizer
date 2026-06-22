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

void test('OllamaApiAdapter.probe returns true when /api/tags answers 200', async () => {
  FetchStub.install(async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    assert.ok(url.endsWith('/api/tags'));
    return new Response('{"models":[]}', { "status": 200 });
  });
  const adapter = new OllamaApiAdapter({ "baseUrl": 'http://127.0.0.1:11434' });
  try {
    assert.equal(await adapter.probe(), true);
  } finally {
    FetchStub.restore();
  }
});

void test('OllamaApiAdapter.probe returns false when /api/tags answers non-2xx', async () => {
  FetchStub.install(async () => new Response('nope', { "status": 500 }));
  const adapter = new OllamaApiAdapter();
  try {
    assert.equal(await adapter.probe(), false);
  } finally {
    FetchStub.restore();
  }
});

void test('OllamaApiAdapter.probe returns false when fetch rejects (daemon down)', async () => {
  FetchStub.install(async () => { throw new Error('ECONNREFUSED'); });
  const adapter = new OllamaApiAdapter();
  try {
    assert.equal(await adapter.probe(), false);
  } finally {
    FetchStub.restore();
  }
});

void test('OllamaApiAdapter.probe returns false on abort/timeout without throwing', async () => {
  FetchStub.install((_input: string | URL | Request, init?: RequestInit) => {
    return new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal ?? undefined;
      if (signal !== undefined) {
        signal.addEventListener('abort', () => { reject(new Error('aborted')); });
      }
    });
  });
  const adapter = new OllamaApiAdapter();
  try {
    assert.equal(await adapter.probe(), false);
  } finally {
    FetchStub.restore();
  }
});

void test('OllamaApiAdapter.probe hits the configured baseUrl, not the default', async () => {
  let seen = '';
  FetchStub.install(async (input: string | URL | Request) => {
    seen = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    return new Response('{}', { "status": 200 });
  });
  const adapter = new OllamaApiAdapter({ "baseUrl": 'http://10.0.0.5:11434' });
  try {
    await adapter.probe();
    assert.equal(seen, 'http://10.0.0.5:11434/api/tags');
  } finally {
    FetchStub.restore();
  }
});
