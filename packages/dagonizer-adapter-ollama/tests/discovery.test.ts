/**
 * Discovery: OllamaApiAdapter.listModels validates the /api/tags wire shape
 * through the framework's shared Ajv, and firstChatModel applies the
 * preferred/embed-skip/first-installed picker. Fetch is stubbed; no daemon.
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

void test('OllamaTagsResponseValidator accepts the daemon envelope and rejects garbage', () => {
  assert.equal(OllamaTagsResponseValidator.is({ 'models': [{ 'name': 'x' }] }), true);
  assert.equal(OllamaTagsResponseValidator.is({ 'models': [{ 'size': 1 }] }), false);
  assert.equal(OllamaTagsResponseValidator.is({ 'nope': true }), false);
  assert.equal(OllamaTagsResponseValidator.is('not-an-object'), false);
});

void test('listModels returns the daemon model names in order', async () => {
  installFetch((async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    assert.ok(url.endsWith('/api/tags'));
    return new Response(TAGS_BODY, { 'status': 200 });
  }) as typeof fetch);
  try {
    const models = await OllamaApiAdapter.listModels();
    assert.deepEqual(models, [
      'qwen3-coder:480b-cloud',
      'qwen3-coder:30b',
      'nomic-embed-text:latest',
      'llama3.2:3b',
    ]);
  } finally {
    restoreFetch();
  }
});

void test('listModels returns [] on non-2xx, malformed body, and daemon down', async () => {
  installFetch((async () => new Response('nope', { 'status': 500 })) as typeof fetch);
  try { assert.deepEqual(await OllamaApiAdapter.listModels(), []); } finally { restoreFetch(); }

  installFetch((async () => new Response('{"models":[{"size":1}]}', { 'status': 200 })) as typeof fetch);
  try { assert.deepEqual(await OllamaApiAdapter.listModels(), []); } finally { restoreFetch(); }

  installFetch((async () => { throw new Error('ECONNREFUSED'); }) as typeof fetch);
  try { assert.deepEqual(await OllamaApiAdapter.listModels(), []); } finally { restoreFetch(); }
});

void test('firstChatModel skips embedders and :cloud, returning the first fully-local chat model', async () => {
  installFetch((async () => new Response(TAGS_BODY, { 'status': 200 })) as typeof fetch);
  try {
    // Leading entry is :cloud, second is an embedder-free local chat model.
    assert.equal(await OllamaApiAdapter.firstChatModel(), 'qwen3-coder:30b');
  } finally {
    restoreFetch();
  }
});

void test('firstChatModel falls back to a :cloud chat model only when no local chat model is installed', async () => {
  const cloudOnly = JSON.stringify({
    'models': [
      { 'name': 'nomic-embed-text:latest' },
      { 'name': 'qwen3-coder:480b-cloud' },
      { 'name': 'glm-5.1:cloud' },
    ],
  });
  installFetch((async () => new Response(cloudOnly, { 'status': 200 })) as typeof fetch);
  try {
    assert.equal(await OllamaApiAdapter.firstChatModel(), 'qwen3-coder:480b-cloud');
  } finally {
    restoreFetch();
  }
});

void test('firstChatModel preferred wins even when it is a :cloud tag', async () => {
  installFetch((async () => new Response(TAGS_BODY, { 'status': 200 })) as typeof fetch);
  try {
    assert.equal(
      await OllamaApiAdapter.firstChatModel('http://127.0.0.1:11434', { 'preferred': 'qwen3-coder:480b-cloud' }),
      'qwen3-coder:480b-cloud',
    );
  } finally {
    restoreFetch();
  }
});

void test('firstChatModel honors preferred when installed, ignores it when absent', async () => {
  installFetch((async () => new Response(TAGS_BODY, { 'status': 200 })) as typeof fetch);
  try {
    assert.equal(
      await OllamaApiAdapter.firstChatModel('http://127.0.0.1:11434', { 'preferred': 'llama3.2:3b' }),
      'llama3.2:3b',
    );
    assert.equal(
      await OllamaApiAdapter.firstChatModel('http://127.0.0.1:11434', { 'preferred': 'not-installed:99b' }),
      'qwen3-coder:30b',
    );
  } finally {
    restoreFetch();
  }
});

void test('firstChatModel returns null when only embedders are installed or daemon is down', async () => {
  installFetch((async () => new Response('{"models":[{"name":"nomic-embed-text:latest"}]}', { 'status': 200 })) as typeof fetch);
  try { assert.equal(await OllamaApiAdapter.firstChatModel(), null); } finally { restoreFetch(); }

  installFetch((async () => { throw new Error('ECONNREFUSED'); }) as typeof fetch);
  try { assert.equal(await OllamaApiAdapter.firstChatModel(), null); } finally { restoreFetch(); }
});
