/**
 * AppendLogStore: browser-safe in-memory core tests.
 *
 * These tests import only from the in-memory core (AppendLogStore) and
 * must exercise the browser path: no file config, no node:fs.
 * They also cover the events() streaming accessor.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { AppendLogStore } from '../../src/index.js';

// ── 1. Browser path: in-memory only, no file config ──────────────────────────

void test('AppendLogStore: in-memory get returns null for absent key', async () => {
  const store = new AppendLogStore();
  assert.equal(await store.get('missing'), null);
});

void test('AppendLogStore: in-memory set + get round-trip', async () => {
  const store = new AppendLogStore();
  await store.set('browser', 'safe');
  assert.equal(await store.get('browser'), 'safe');
});

void test('AppendLogStore: has returns true after set', async () => {
  const store = new AppendLogStore();
  await store.set('flag', true);
  assert.equal(await store.has('flag'), true);
});

void test('AppendLogStore: delete returns true for existing key', async () => {
  const store = new AppendLogStore();
  await store.set('key', 'val');
  assert.equal(await store.delete('key'), true);
  assert.equal(await store.has('key'), false);
});

void test('AppendLogStore: update() applies fn to absent key', async () => {
  const store = new AppendLogStore();
  const result = await store.update('n', (v) => (typeof v === 'number' ? v : 0) + 1);
  assert.equal(result, 1);
  assert.equal(await store.get('n'), 1);
});

void test('AppendLogStore: snapshot() compacts to latest-wins', async () => {
  const store = new AppendLogStore();
  await store.set('a', 'first');
  await store.set('a', 'second');
  await store.set('b', 'only');

  const snap = await store.snapshot();
  assert.equal(snap.type, 'event-log-store');
  assert.equal(snap.version, 1);
  const map = new Map(snap.entries.map(({ key, value }) => [key, value]));
  assert.equal(map.get('a'), 'second');
  assert.equal(map.get('b'), 'only');
  assert.equal(snap.entries.length, 2);
});

void test('AppendLogStore: deleted keys absent from snapshot', async () => {
  const store = new AppendLogStore();
  await store.set('keep', 'yes');
  await store.set('drop', 'bye');
  await store.delete('drop');

  const snap = await store.snapshot();
  const keys = snap.entries.map(({ key }) => key);
  assert.ok(keys.includes('keep'));
  assert.ok(!keys.includes('drop'));
});

void test('AppendLogStore: connect() and disconnect() are no-ops (no filePath)', async () => {
  const store = new AppendLogStore();
  // These must complete without error and without touching node:fs.
  await store.connect();
  await store.set('x', 1);
  await store.disconnect();
  assert.equal(await store.get('x'), 1);
});

// ── 2. events() streaming accessor ───────────────────────────────────────────

void test('events(): yields all entries in append order', async () => {
  const store = new AppendLogStore();
  await store.set('a', 1);
  await store.set('b', 2);
  await store.delete('a');

  const collected: Array<{ variant: string; key: string }> = [];
  for await (const entry of store.events()) {
    collected.push({ 'variant': entry.variant, 'key': entry.key });
  }

  assert.equal(collected.length, 3);
  assert.equal(collected[0]?.variant, 'set');
  assert.equal(collected[0]?.key, 'a');
  assert.equal(collected[1]?.variant, 'set');
  assert.equal(collected[1]?.key, 'b');
  assert.equal(collected[2]?.variant, 'delete');
  assert.equal(collected[2]?.key, 'a');
});

void test('events(): includes tombstones (not just set entries)', async () => {
  const store = new AppendLogStore();
  await store.set('x', 'alive');
  await store.delete('x');

  const entries = [];
  for await (const entry of store.events()) {
    entries.push(entry.variant);
  }

  assert.deepEqual(entries, ['set', 'delete']);
});

void test('events(): empty store yields nothing', async () => {
  const store = new AppendLogStore();
  const entries = [];
  for await (const entry of store.events()) {
    entries.push(entry);
  }
  assert.equal(entries.length, 0);
});

void test('events(): reflects all writes including update()', async () => {
  const store = new AppendLogStore();
  await store.update('counter', () => 1);
  await store.update('counter', (v) => (typeof v === 'number' ? v : 0) + 1);

  const entries = [];
  for await (const entry of store.events()) {
    entries.push(entry);
  }
  assert.equal(entries.length, 2);
  assert.equal(entries[0]?.variant, 'set');
  assert.equal(entries[1]?.variant, 'set');
});

void test('events(): count matches log() length', async () => {
  const store = new AppendLogStore();
  await store.set('p', 1);
  await store.set('q', 2);
  await store.set('p', 3);
  await store.delete('q');

  let count = 0;
  for await (const _entry of store.events()) {
    count += 1;
  }
  assert.equal(count, store.log().length);
  assert.equal(count, 4);
});

void test('events(): log() and events() reference consistent data', async () => {
  const store = new AppendLogStore();
  await store.set('key', 'value');

  const logSnapshot = [...store.log()];
  const eventsSnapshot: Array<{ variant: string; key: string }> = [];
  for await (const entry of store.events()) {
    eventsSnapshot.push({ 'variant': entry.variant, 'key': entry.key });
  }

  assert.equal(logSnapshot.length, eventsSnapshot.length);
  assert.equal(logSnapshot[0]?.variant, eventsSnapshot[0]?.variant);
  assert.equal(logSnapshot[0]?.key, eventsSnapshot[0]?.key);
});
