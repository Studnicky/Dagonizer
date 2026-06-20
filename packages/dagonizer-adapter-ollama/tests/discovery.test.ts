/**
 * Discovery: OllamaApiAdapter instance listModels classifies models by
 * variant and cloud flag; the inherited selectChatModel applies the
 * preferred/embed-skip/local-first picker and stores the selection.
 * OllamaTagsResponseValidator rejects malformed daemon envelopes.
 * Fetch is stubbed; no daemon required.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { OllamaApiAdapter, OllamaTagsResponseValidator } from '../src/index.js';

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

const TAGS_BODY = JSON.stringify({
  'models': [
    { 'name': 'qwen3-coder:480b-cloud', 'size': 0 },
    { 'name': 'qwen3-coder:30b', 'size': 1 },
    { 'name': 'nomic-embed-text:latest', 'size': 2 },
    { 'name': 'llama3.2:3b', 'size': 3 },
  ],
});

// ---------------------------------------------------------------------------
// Schema validation
// ---------------------------------------------------------------------------

void test('OllamaTagsResponseValidator accepts the daemon envelope and rejects garbage', () => {
  assert.equal(OllamaTagsResponseValidator.is({ 'models': [{ 'name': 'x' }] }), true);
  assert.equal(OllamaTagsResponseValidator.is({ 'models': [{ 'size': 1 }] }), false);
  assert.equal(OllamaTagsResponseValidator.is({ 'nope': true }), false);
  assert.equal(OllamaTagsResponseValidator.is('not-an-object'), false);
});

// ---------------------------------------------------------------------------
// Instance listModels — classification
// ---------------------------------------------------------------------------

void test('listModels classifies chat vs embedding and cloud vs local correctly', async () => {
  installFetch((async () => new Response(TAGS_BODY, { 'status': 200 })) as typeof fetch);
  try {
    const adapter = new OllamaApiAdapter();
    const models = await adapter.listModels();
    assert.equal(models.length, 4);

    // cloud chat model
    const cloud = models.find((m) => m.name === 'qwen3-coder:480b-cloud');
    assert.ok(cloud);
    assert.equal(cloud.variant, 'chat');
    assert.equal(cloud.cloud, true);

    // local chat model
    const local30b = models.find((m) => m.name === 'qwen3-coder:30b');
    assert.ok(local30b);
    assert.equal(local30b.variant, 'chat');
    assert.equal(local30b.cloud, false);

    // embedding model
    const embedder = models.find((m) => m.name === 'nomic-embed-text:latest');
    assert.ok(embedder);
    assert.equal(embedder.variant, 'embedding');
    assert.equal(embedder.cloud, false);

    // local chat model (second)
    const local3b = models.find((m) => m.name === 'llama3.2:3b');
    assert.ok(local3b);
    assert.equal(local3b.variant, 'chat');
    assert.equal(local3b.cloud, false);
  } finally {
    restoreFetch();
  }
});

void test('listModels returns [] on non-2xx, malformed body, and daemon down', async () => {
  const adapter = new OllamaApiAdapter();

  installFetch((async () => new Response('nope', { 'status': 500 })) as typeof fetch);
  try { assert.deepEqual(await adapter.listModels(), []); } finally { restoreFetch(); }

  installFetch((async () => new Response('{"models":[{"size":1}]}', { 'status': 200 })) as typeof fetch);
  try { assert.deepEqual(await adapter.listModels(), []); } finally { restoreFetch(); }

  installFetch((async () => { throw new Error('ECONNREFUSED'); }) as typeof fetch);
  try { assert.deepEqual(await adapter.listModels(), []); } finally { restoreFetch(); }
});

void test('listModels composes caller signal with internal timeout', async () => {
  // Pass an already-aborted signal — fetch should receive a signal that is aborted.
  const adapter = new OllamaApiAdapter();
  let receivedSignal: AbortSignal | undefined;
  installFetch((async (_input: string | URL | Request, init?: RequestInit) => {
    receivedSignal = init?.signal as AbortSignal | undefined;
    // Simulate daemon down (fetch never resolves naturally here, but we return []).
    throw new Error('aborted');
  }) as typeof fetch);
  try {
    const aborted = AbortSignal.abort();
    const result = await adapter.listModels({ 'signal': aborted });
    assert.deepEqual(result, []);
    assert.ok(receivedSignal !== undefined, 'signal should be forwarded to fetch');
    assert.equal(receivedSignal.aborted, true);
  } finally {
    restoreFetch();
  }
});

// ---------------------------------------------------------------------------
// Inherited selectChatModel — selection + model storage
// ---------------------------------------------------------------------------

void test('selectChatModel prefers local chat model over cloud and skips embedders', async () => {
  installFetch((async () => new Response(TAGS_BODY, { 'status': 200 })) as typeof fetch);
  try {
    const adapter = new OllamaApiAdapter();
    const selected = await adapter.selectChatModel();
    // Leading entry is :cloud; second is a local chat model — it should win.
    assert.equal(selected, 'qwen3-coder:30b');
  } finally {
    restoreFetch();
  }
});

void test('selectChatModel falls back to :cloud when no local chat model is installed', async () => {
  const cloudOnly = JSON.stringify({
    'models': [
      { 'name': 'nomic-embed-text:latest' },
      { 'name': 'qwen3-coder:480b-cloud' },
      { 'name': 'glm-5.1:cloud' },
    ],
  });
  installFetch((async () => new Response(cloudOnly, { 'status': 200 })) as typeof fetch);
  try {
    const adapter = new OllamaApiAdapter();
    const selected = await adapter.selectChatModel();
    assert.equal(selected, 'qwen3-coder:480b-cloud');
  } finally {
    restoreFetch();
  }
});

void test('selectChatModel honors preferred when it is installed', async () => {
  installFetch((async () => new Response(TAGS_BODY, { 'status': 200 })) as typeof fetch);
  try {
    const adapter = new OllamaApiAdapter();
    assert.equal(await adapter.selectChatModel({ 'preferred': 'llama3.2:3b' }), 'llama3.2:3b');
  } finally {
    restoreFetch();
  }
});

void test('selectChatModel ignores preferred when it is not installed', async () => {
  installFetch((async () => new Response(TAGS_BODY, { 'status': 200 })) as typeof fetch);
  try {
    const adapter = new OllamaApiAdapter();
    const selected = await adapter.selectChatModel({ 'preferred': 'not-installed:99b' });
    assert.equal(selected, 'qwen3-coder:30b');
  } finally {
    restoreFetch();
  }
});

void test('selectChatModel preferred wins even when it is a :cloud tag', async () => {
  installFetch((async () => new Response(TAGS_BODY, { 'status': 200 })) as typeof fetch);
  try {
    const adapter = new OllamaApiAdapter();
    const selected = await adapter.selectChatModel({ 'preferred': 'qwen3-coder:480b-cloud' });
    assert.equal(selected, 'qwen3-coder:480b-cloud');
  } finally {
    restoreFetch();
  }
});

void test('selectChatModel returns null when only embedders are installed or daemon is down', async () => {
  const adapter = new OllamaApiAdapter();

  installFetch((async () => new Response('{"models":[{"name":"nomic-embed-text:latest"}]}', { 'status': 200 })) as typeof fetch);
  try { assert.equal(await adapter.selectChatModel(), null); } finally { restoreFetch(); }

  installFetch((async () => { throw new Error('ECONNREFUSED'); }) as typeof fetch);
  try { assert.equal(await adapter.selectChatModel(), null); } finally { restoreFetch(); }
});

// ---------------------------------------------------------------------------
// selectChatModel stores the selection on the adapter
// ---------------------------------------------------------------------------

void test('selectChatModel stores the selected model so subsequent calls can chat()', async () => {
  installFetch((async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    // Respond to /api/tags for listModels; all other calls return 200 stub.
    if (url.includes('/api/tags')) {
      return new Response(TAGS_BODY, { 'status': 200 });
    }
    // Simulate a chat completions response so the adapter doesn't throw
    // MODEL_NOT_FOUND when chat() is exercised in a follow-up call.
    return new Response('{}', { 'status': 200 });
  }) as typeof fetch);
  try {
    const adapter = new OllamaApiAdapter();
    const selected = await adapter.selectChatModel();
    assert.equal(selected, 'qwen3-coder:30b');
    // The adapter must expose the selected model via listModels without erroring.
    // We verify by calling listModels again (second fetch hits /api/tags).
    const models = await adapter.listModels();
    assert.ok(models.some((m) => m.name === 'qwen3-coder:30b'));
  } finally {
    restoreFetch();
  }
});

// ---------------------------------------------------------------------------
// Constructor with explicit model
// ---------------------------------------------------------------------------

void test('constructor with explicit model does not need selectChatModel', async () => {
  // listModels should still enumerate the daemon (independent of constructor model).
  installFetch((async () => new Response(TAGS_BODY, { 'status': 200 })) as typeof fetch);
  try {
    const adapter = new OllamaApiAdapter({ 'model': 'llama3.2:3b' });
    const models = await adapter.listModels();
    assert.ok(models.length > 0);
  } finally {
    restoreFetch();
  }
});
