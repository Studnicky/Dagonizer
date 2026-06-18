import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { StoreError } from '@studnicky/dagonizer/store';

import { SqliteStore } from '../../src/SqliteStore.js';

// All tests use ':memory:' so no filesystem I/O occurs.

void describe('SqliteStore: basic operations', () => {
  void it('get/set/has/delete round-trip', async () => {
    const store = new SqliteStore(':memory:');

    await store.set<string>('greeting', 'hello');
    assert.equal(await store.get<string>('greeting'), 'hello');
    assert.equal(await store.has('greeting'), true);
    assert.equal(await store.has('missing'), false);

    const deleted = await store.delete('greeting');
    assert.equal(deleted, true);
    assert.equal(await store.has('greeting'), false);
    assert.equal(await store.get<string>('greeting'), null);

    await store.disconnect();
  });

  void it('delete returns false for a key that does not exist', async () => {
    const store = new SqliteStore(':memory:');
    const result = await store.delete('ghost');
    assert.equal(result, false);
    await store.disconnect();
  });
});

void describe('SqliteStore: update atomicity', () => {
  void it('update(key, fn) returns the new value; get() reads the same', async () => {
    const store = new SqliteStore(':memory:');
    const result = await store.update<number>('counter', (n) => (n ?? 0) + 1);
    assert.equal(result, 1);
    assert.equal(await store.get<number>('counter'), 1);
    await store.disconnect();
  });

  void it('concurrent updates produce no lost writes via BEGIN IMMEDIATE', async () => {
    const store = new SqliteStore(':memory:');

    // Two simultaneous updates. SQLite serializes via BEGIN IMMEDIATE;
    // the second will block until the first transaction commits, so the
    // final value must be 2 (no lost update).
    await Promise.all([
      store.update<number>('k', (n) => (n ?? 0) + 1),
      store.update<number>('k', (n) => (n ?? 0) + 1),
    ]);
    assert.equal(await store.get<number>('k'), 2);
    await store.disconnect();
  });
});

void describe('SqliteStore: snapshot', () => {
  void it('snapshot() returns typed envelope with type and version', async () => {
    const store = new SqliteStore(':memory:');
    await store.set<number>('a', 1);
    await store.set<string>('b', 'two');

    const snap = await store.snapshot();
    assert.equal(snap.type, 'sqlite-store');
    assert.equal(snap.version, 1);

    // Snapshot entries are ORDER BY key; a before b
    assert.equal(snap.entries.length, 2);
    assert.deepEqual(snap.entries[0], { 'key': 'a', 'value': 1 });
    assert.deepEqual(snap.entries[1], { 'key': 'b', 'value': 'two' });

    await store.disconnect();
  });

  void it('restore() repopulates a fresh SqliteStore from a captured snapshot', async () => {
    const source = new SqliteStore(':memory:');
    await source.set<number>('x', 42);
    await source.set('y', [1, 2, 3]);
    const snap = await source.snapshot();
    await source.disconnect();

    const target = new SqliteStore(':memory:');
    await target.restore(snap);
    assert.equal(await target.get<number>('x'), 42);
    assert.deepEqual(await target.get('y'), [1, 2, 3]);
    await target.disconnect();
  });

  void it('restore() with wrong type throws StoreError INCOMPATIBLE_SNAPSHOT', async () => {
    const store = new SqliteStore(':memory:');
    const badSnap = { 'version': 1, 'type': 'not-sqlite-store', 'entries': [] };

    await assert.rejects(
      () => store.restore(badSnap),
      (err: unknown) => {
        assert.ok(err instanceof StoreError);
        assert.equal(err.classification.reason, 'INCOMPATIBLE_SNAPSHOT');
        if (err.classification.reason === 'INCOMPATIBLE_SNAPSHOT') {
          assert.equal(err.classification.actualType, 'not-sqlite-store');
        }
        return true;
      },
    );
    await store.disconnect();
  });

  void it('restore() with wrong version throws StoreError INCOMPATIBLE_SNAPSHOT', async () => {
    const store = new SqliteStore(':memory:');
    const badSnap = { 'version': 99, 'type': 'sqlite-store', 'entries': [] };

    await assert.rejects(
      () => store.restore(badSnap),
      (err: unknown) => {
        assert.ok(err instanceof StoreError);
        assert.equal(err.classification.reason, 'INCOMPATIBLE_SNAPSHOT');
        if (err.classification.reason === 'INCOMPATIBLE_SNAPSHOT') {
          assert.equal(err.classification.actualVersion, 99);
        }
        return true;
      },
    );
    await store.disconnect();
  });
});

void describe('SqliteStore: namespace', () => {
  void it('namespace option prefixes keys visible in snapshot', async () => {
    const store = new SqliteStore(':memory:', { 'namespace': 'foo' });
    await store.set<string>('key', 'value');

    // Snapshot entries carry the qualified key (with namespace prefix)
    const snap = await store.snapshot();
    assert.equal(snap.entries.length, 1);
    assert.equal(snap.entries[0]?.key, 'foo:key');

    // Public get uses the same prefix; reads the same entry back
    assert.equal(await store.get<string>('key'), 'value');
    await store.disconnect();
  });
});

void describe('SqliteStore: disconnect', () => {
  void it('disconnect() closes the connection; subsequent ops throw', async () => {
    const store = new SqliteStore(':memory:');
    await store.set<string>('before', 'close');
    await store.disconnect();

    // After close, any SQLite operation should throw
    await assert.rejects(
      () => store.get<string>('before'),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        return true;
      },
    );
  });
});

void describe('SqliteStore: custom tableName', () => {
  void it('custom tableName works as backing table', async () => {
    const store = new SqliteStore(':memory:', { 'namespace': '', 'tableName': 'app_kv' });

    await store.set<number>('count', 7);
    assert.equal(await store.get<number>('count'), 7);

    const snap = await store.snapshot();
    assert.equal(snap.type, 'sqlite-store');
    assert.equal(snap.entries.length, 1);
    assert.deepEqual(snap.entries[0], { 'key': 'count', 'value': 7 });

    await store.disconnect();
  });
});
