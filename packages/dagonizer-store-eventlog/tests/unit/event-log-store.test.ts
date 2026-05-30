import { test, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { tmpdir } from 'node:os';
import { mkdtemp, unlink } from 'node:fs/promises';
import { join } from 'node:path';

import { StoreError } from '@noocodex/dagonizer/store';

import { EventLogStore } from '../../src/index.js';

// ── 1. In-memory: basic get / set / has / delete ──────────────────────────────

void test('in-memory: get returns undefined for absent key', async () => {
  const store = new EventLogStore();
  assert.equal(await store.get<string>('missing'), undefined);
});

void test('in-memory: set + get round-trip', async () => {
  const store = new EventLogStore();
  await store.set<string>('name', 'dagonizer');
  assert.equal(await store.get<string>('name'), 'dagonizer');
});

void test('in-memory: has returns true after set', async () => {
  const store = new EventLogStore();
  await store.set<number>('count', 42);
  assert.equal(await store.has('count'), true);
});

void test('in-memory: has returns false for absent key', async () => {
  const store = new EventLogStore();
  assert.equal(await store.has('ghost'), false);
});

void test('in-memory: delete returns true for existing key', async () => {
  const store = new EventLogStore();
  await store.set<string>('key', 'value');
  const result = await store.delete('key');
  assert.equal(result, true);
});

void test('in-memory: delete returns false for absent key', async () => {
  const store = new EventLogStore();
  const result = await store.delete('absent');
  assert.equal(result, false);
});

void test('in-memory: overwriting a key appends a new set entry', async () => {
  const store = new EventLogStore();
  await store.set<number>('n', 1);
  await store.set<number>('n', 2);
  assert.equal(await store.get<number>('n'), 2);
  assert.equal(store.log().length, 2);
});

// ── 2. update() atomic in-memory ─────────────────────────────────────────────

void test('update: applies fn to undefined for absent key', async () => {
  const store = new EventLogStore();
  const result = await store.update<number>('counter', (c) => (c ?? 0) + 1);
  assert.equal(result, 1);
  assert.equal(await store.get<number>('counter'), 1);
});

void test('update: applies fn to existing value', async () => {
  const store = new EventLogStore();
  await store.set<number>('counter', 10);
  const result = await store.update<number>('counter', (c) => (c ?? 0) + 5);
  assert.equal(result, 15);
  assert.equal(await store.get<number>('counter'), 15);
});

void test('update: concurrent Promise.all produces no lost writes (JS single-thread)', async () => {
  const store = new EventLogStore();
  await store.set<number>('x', 0);

  // Fire 10 concurrent increments. Because update() does no await before
  // reading #latest(), each invocation reads the prior committed value.
  // JS single-threaded semantics guarantee these interleave at microtask
  // boundaries only after each append resolves.
  const increments = Array.from({ length: 10 }, () =>
    store.update<number>('x', (v) => (v ?? 0) + 1),
  );
  await Promise.all(increments);

  // Each update reads and commits sequentially under JS's event loop.
  assert.equal(await store.get<number>('x'), 10);
});

// ── 3. snapshot() returns compacted view ─────────────────────────────────────

void test('snapshot: compacted entries reflect latest value per key', async () => {
  const store = new EventLogStore();
  await store.set<string>('a', 'first');
  await store.set<string>('a', 'second');
  await store.set<string>('b', 'only');

  const snap = await store.snapshot();
  assert.equal(snap.type, 'event-log-store');
  assert.equal(snap.version, 1);

  const map = new Map(snap.entries.map(({ key, value }) => [key, value]));
  assert.equal(map.get('a'), 'second');
  assert.equal(map.get('b'), 'only');
  assert.equal(snap.entries.length, 2);
});

void test('snapshot: deleted keys are absent from entries', async () => {
  const store = new EventLogStore();
  await store.set<string>('keep', 'yes');
  await store.set<string>('drop', 'bye');
  await store.delete('drop');

  const snap = await store.snapshot();
  const keys = snap.entries.map(({ key }) => key);
  assert.ok(keys.includes('keep'));
  assert.ok(!keys.includes('drop'));
});

// ── 4. restore() reseeds the log ─────────────────────────────────────────────

void test('restore: reseeds log and get returns restored values', async () => {
  const store = new EventLogStore();
  const snap = await store.snapshot();

  // Seed a separate store and snapshot it.
  const source = new EventLogStore();
  await source.set<number>('x', 99);
  await source.set<string>('label', 'restored');
  const sourceSnap = await source.snapshot();

  await store.restore(sourceSnap);
  assert.equal(await store.get<number>('x'), 99);
  assert.equal(await store.get<string>('label'), 'restored');

  // Log has exactly the same count as entries (one set per entry).
  assert.equal(store.log().length, sourceSnap.entries.length);

  void snap; // suppress unused var
});

void test('restore: clears prior log entries', async () => {
  const store = new EventLogStore();
  await store.set<string>('old', 'value');
  assert.equal(store.log().length, 1);

  const empty = new EventLogStore();
  const emptySnap = await empty.snapshot();
  await store.restore(emptySnap);

  assert.equal(store.log().length, 0);
  assert.equal(await store.get<string>('old'), undefined);
});

// ── 5. Tombstone semantics ────────────────────────────────────────────────────

void test('tombstone: delete then get returns undefined', async () => {
  const store = new EventLogStore();
  await store.set<string>('k', 'v');
  await store.delete('k');
  assert.equal(await store.get<string>('k'), undefined);
});

void test('tombstone: delete then has returns false', async () => {
  const store = new EventLogStore();
  await store.set<boolean>('flag', true);
  await store.delete('flag');
  assert.equal(await store.has('flag'), false);
});

void test('tombstone: set after delete brings key back', async () => {
  const store = new EventLogStore();
  await store.set<string>('k', 'alive');
  await store.delete('k');
  await store.set<string>('k', 'reborn');
  assert.equal(await store.get<string>('k'), 'reborn');
  assert.equal(await store.has('k'), true);
});

// ── 6. File-backed persistence ────────────────────────────────────────────────

void test('connect: double-connect is a no-op — no duplicate entries', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dagonizer-eventlog-'));
  const filePath = join(dir, 'double-connect.log');

  const store = new EventLogStore({ filePath, 'syncOnAppend': false });
  await store.connect();
  await store.set<string>('key', 'value');
  // A second connect must be a no-op: no new handle, no replay.
  await store.connect();
  // Log still has exactly one entry — the single set above.
  assert.equal(store.log().length, 1);
  assert.equal(await store.get<string>('key'), 'value');
  await store.disconnect();

  await unlink(filePath);
});

void test('file-backed: persists and replays entries across instances', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dagonizer-eventlog-'));
  const filePath = join(dir, 'store.log');

  // Write phase.
  const writer = new EventLogStore({ filePath, 'syncOnAppend': false });
  await writer.connect();
  await writer.set<string>('hello', 'world');
  await writer.set<number>('n', 7);
  await writer.disconnect();

  // Read phase — new instance, same file.
  const reader = new EventLogStore({ filePath });
  await reader.connect();
  assert.equal(await reader.get<string>('hello'), 'world');
  assert.equal(await reader.get<number>('n'), 7);
  await reader.disconnect();

  await unlink(filePath);
});

void test('file-backed: replays tombstones correctly', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dagonizer-eventlog-'));
  const filePath = join(dir, 'store-tombstone.log');

  const writer = new EventLogStore({ filePath, 'syncOnAppend': false });
  await writer.connect();
  await writer.set<string>('a', 'present');
  await writer.set<string>('b', 'deleted');
  await writer.delete('b');
  await writer.disconnect();

  const reader = new EventLogStore({ filePath });
  await reader.connect();
  assert.equal(await reader.get<string>('a'), 'present');
  assert.equal(await reader.get<string>('b'), undefined);
  assert.equal(await reader.has('b'), false);
  await reader.disconnect();

  await unlink(filePath);
});

// ── 7. restore() with wrong type/version throws StoreError ───────────────────

void test('restore: wrong type throws StoreError INCOMPATIBLE_SNAPSHOT', async () => {
  const store = new EventLogStore();
  await assert.rejects(
    () => store.restore({ 'version': 1, 'type': 'wrong-type', 'entries': [] }),
    (err: unknown) => {
      assert.ok(err instanceof StoreError);
      const storeErr = err as StoreError;
      assert.equal(storeErr.classification.reason, 'INCOMPATIBLE_SNAPSHOT');
      return true;
    },
  );
});

void test('restore: wrong version throws StoreError INCOMPATIBLE_SNAPSHOT', async () => {
  const store = new EventLogStore();
  await assert.rejects(
    () => store.restore({ 'version': 99, 'type': 'event-log-store', 'entries': [] }),
    (err: unknown) => {
      assert.ok(err instanceof StoreError);
      const storeErr = err as StoreError;
      assert.equal(storeErr.classification.reason, 'INCOMPATIBLE_SNAPSHOT');
      return true;
    },
  );
});

// ── 8. log() returns full event log including tombstones ──────────────────────

void test('log: includes both set and delete events', async () => {
  const store = new EventLogStore();
  await store.set<string>('x', 'a');
  await store.set<string>('x', 'b');
  await store.delete('x');

  const log = store.log();
  assert.equal(log.length, 3);
  assert.equal(log[0]?.kind, 'set');
  assert.equal(log[1]?.kind, 'set');
  assert.equal(log[2]?.kind, 'delete');
});

void test('log: returns the live internal log — reference identity is stable', async () => {
  const store = new EventLogStore();
  await store.set<string>('k', 'v');

  // log() returns the same underlying array reference on every call.
  const log1 = store.log();
  const log2 = store.log();
  assert.strictEqual(log1, log2);

  // The type is readonly: TypeScript prevents mutation at the call site.
  // Length matches the number of appended events.
  assert.equal(log1.length, 1);
  assert.equal(log1[0]?.kind, 'set');
});

void test('log: update() appends a set entry', async () => {
  const store = new EventLogStore();
  await store.update<number>('n', () => 42);
  const log = store.log();
  assert.equal(log.length, 1);
  assert.equal(log[0]?.kind, 'set');
});

// ── 9. Namespace isolation ────────────────────────────────────────────────────

void test('namespace: qualifies keys transparently', async () => {
  const store = new EventLogStore({ 'namespace': 'ns' });
  await store.set<string>('key', 'value');
  // Unqualified get goes through the same qualifier.
  assert.equal(await store.get<string>('key'), 'value');
  // Internal log stores the qualified key.
  const entry = store.log()[0];
  assert.ok(entry !== undefined && entry.key === 'ns:key');
});

after(() => {
  // No persistent cleanup needed — file tests clean up inline.
});
