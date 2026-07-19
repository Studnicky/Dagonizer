import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  clearRunnableExampleContext,
  indexedDbNamesForExample,
  standaloneRunnerPropsForExample,
  storageKeysForExample,
} from '../src/components/islands/runnableExampleContext';

class FakeStorage {
  readonly #entries = new Map<string, string>();

  constructor(entries: Readonly<Record<string, string>>) {
    for (const [key, value] of Object.entries(entries)) {
      this.#entries.set(key, value);
    }
  }

  getItem(key: string): string | null {
    return this.#entries.get(key) ?? null;
  }

  removeItem(key: string): void {
    this.#entries.delete(key);
  }
}

class FakeIndexedDb {
  readonly deleted: string[] = [];

  deleteDatabase(name: string): {
    error?: unknown;
    onblocked: (() => void) | null;
    onerror: (() => void) | null;
    onsuccess: (() => void) | null;
  } {
    this.deleted.push(name);
    const request = {
      'onblocked': null,
      'onerror': null,
      'onsuccess': null,
    };
    queueMicrotask(() => {
      request.onsuccess?.();
    });
    return request;
  }
}

test('clearRunnableExampleContext removes shared provider keys and example-specific checkpoint state', async () => {
  const localStorage = new FakeStorage({
    'dagonizer-active-backend': 'gemini-api',
    'dagonizer-api-keys': '{"gemini-api":"secret"}',
    'dagonizer-archivist-checkpoint': '{"cursor":"stale"}',
    'dagonizer-device-override': 'desktop',
    'dagonizer-preferred-models': '{"gemini-api":"gemini-2.5-pro"}',
    'unrelated-key': 'preserve-me',
  });
  const sessionStorage = new FakeStorage({
    'dagonizer-active-backend': 'web-llm',
    'dagonizer-archivist-checkpoint': '{"cursor":"session-copy"}',
    'unrelated-session-key': 'preserve-me',
  });
  const indexedDB = new FakeIndexedDb();

  await clearRunnableExampleContext('archivist', { indexedDB, localStorage, sessionStorage });

  for (const key of storageKeysForExample('archivist')) {
    assert.equal(localStorage.getItem(key), null, `${key} must be cleared from localStorage`);
    assert.equal(sessionStorage.getItem(key), null, `${key} must be cleared from sessionStorage`);
  }

  assert.equal(localStorage.getItem('unrelated-key'), 'preserve-me');
  assert.equal(sessionStorage.getItem('unrelated-session-key'), 'preserve-me');
  assert.deepEqual(indexedDB.deleted, [...indexedDbNamesForExample('archivist')]);
});

test('cartographer shares the mount recovery surface but does not clear archivist-only checkpoint keys', () => {
  assert.ok(storageKeysForExample('cartographer').includes('dagonizer-api-keys'));
  assert.ok(storageKeysForExample('cartographer').includes('dagonizer-preferred-models'));
  assert.ok(!storageKeysForExample('cartographer').includes('dagonizer-archivist-checkpoint'));
});

test('archivist standalone runner props are derived from URL search params through the shared mount context', () => {
  const props = standaloneRunnerPropsForExample(
    'archivist',
    new URLSearchParams('apiKey=secret&lang=fr&park&webLlmModel=Qwen3-0.6B-q4f16_1-MLC'),
  );

  assert.deepEqual(props, {
    'apiKey': 'secret',
    'lang': 'fr',
    'park': true,
    'webLlmModel': 'Qwen3-0.6B-q4f16_1-MLC',
  });
});

test('cartographer and dispatcher standalone runner props stay empty on the shared mount path', () => {
  assert.deepEqual(standaloneRunnerPropsForExample('cartographer', new URLSearchParams('ignored=1')), {});
  assert.deepEqual(standaloneRunnerPropsForExample('dispatcher', new URLSearchParams('ignored=1')), {});
});
