import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { StoreError } from '@studnicky/dagonizer/store';
import { IDBFactory } from 'fake-indexeddb';

import type { IdbFactoryLikeInterface } from '../../src/IdbTypes.js';
import { IndexedDbCheckpointStore } from '../../src/IndexedDbCheckpointStore.js';
import { IndexedDbStore } from '../../src/IndexedDbStore.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Fresh isolated store per test: new IDBFactory + connect. */
class Fixture {
  static async store(options: { namespace?: string; storeName?: string } = {}): Promise<IndexedDbStore> {
    const store = new IndexedDbStore(new IDBFactory(), options);
    await store.connect();
    return store;
  }

  /**
   * Pair of stores sharing the SAME IDBFactory instance and same databaseName.
   * Used for durability-across-reopen tests.
   */
  static sharedFactory(): IdbFactoryLikeInterface {
    return new IDBFactory();
  }

  static async storeOnFactory(factory: IdbFactoryLikeInterface, options: { storeName?: string } = {}): Promise<IndexedDbStore> {
    const store = new IndexedDbStore(factory, options);
    await store.connect();
    return store;
  }

  static async checkpointStore(options: { storeName?: string } = {}): Promise<IndexedDbCheckpointStore> {
    const ckpt = new IndexedDbCheckpointStore(new IDBFactory(), options);
    await ckpt.connect();
    return ckpt;
  }

  static async checkpointStoreOnFactory(
    factory: IdbFactoryLikeInterface,
    options: { storeName?: string } = {},
  ): Promise<IndexedDbCheckpointStore> {
    const ckpt = new IndexedDbCheckpointStore(factory, options);
    await ckpt.connect();
    return ckpt;
  }
}

// ---------------------------------------------------------------------------
// Basic KV operations
// ---------------------------------------------------------------------------

void describe('IndexedDbStore: get/set/has/delete round-trip', () => {
  void it('set then get returns the stored value', async () => {
    const store = await Fixture.store();
    await store.set('greeting', 'hello');
    assert.equal(await store.get('greeting'), 'hello');
    await store.disconnect();
  });

  void it('has returns true for an existing key', async () => {
    const store = await Fixture.store();
    await store.set('x', 42);
    assert.equal(await store.has('x'), true);
    await store.disconnect();
  });

  void it('has returns false for a missing key', async () => {
    const store = await Fixture.store();
    assert.equal(await store.has('ghost'), false);
    await store.disconnect();
  });

  void it('delete removes an existing key and returns true', async () => {
    const store = await Fixture.store();
    await store.set('to-delete', 'bye');
    const deleted = await store.delete('to-delete');
    assert.equal(deleted, true);
    assert.equal(await store.has('to-delete'), false);
    assert.equal(await store.get('to-delete'), null);
    await store.disconnect();
  });

  void it('delete returns false for a missing key', async () => {
    const store = await Fixture.store();
    const result = await store.delete('never-set');
    assert.equal(result, false);
    await store.disconnect();
  });

  void it('stores and retrieves various JSON value types', async () => {
    const store = await Fixture.store();
    await store.set('num',  3.14);
    await store.set('bool', true);
    await store.set('null', null);
    await store.set('arr',  [1, 'two', null]);
    await store.set('obj',  { 'a': 1, 'b': [2] });

    assert.equal(await store.get('num'),  3.14);
    assert.equal(await store.get('bool'), true);
    assert.equal(await store.get('null'), null);
    assert.deepEqual(await store.get('arr'), [1, 'two', null]);
    assert.deepEqual(await store.get('obj'), { 'a': 1, 'b': [2] });
    await store.disconnect();
  });
});

// ---------------------------------------------------------------------------
// Durability across simulated reopen
// ---------------------------------------------------------------------------

void describe('IndexedDbStore: durability across simulated reopen', () => {
  void it('values written then disconnected are readable by a new store on the same factory', async () => {
    const factory = Fixture.sharedFactory();

    // Write session
    const writer = await Fixture.storeOnFactory(factory);
    await writer.set('persist-a', 'one');
    await writer.set('persist-b', [1, 2, 3]);
    await writer.disconnect();

    // New store instance on the same factory (simulates tab reopen)
    const reader = await Fixture.storeOnFactory(factory);
    assert.equal(await reader.get('persist-a'), 'one');
    assert.deepEqual(await reader.get('persist-b'), [1, 2, 3]);
    await reader.disconnect();
  });
});

// ---------------------------------------------------------------------------
// Atomic update
// ---------------------------------------------------------------------------

void describe('IndexedDbStore: atomic update', () => {
  void it('update(key, fn) returns the new value; get reads it back', async () => {
    const store = await Fixture.store();
    const result = await store.update('counter', (n) => (typeof n === 'number' ? n : 0) + 1);
    assert.equal(result, 1);
    assert.equal(await store.get('counter'), 1);
    await store.disconnect();
  });

  void it('two concurrent updates produce final value 2 (no lost write)', async () => {
    const store = await Fixture.store();

    // IDB auto-commits each readwrite transaction after all its requests
    // complete. The two transactions are serialized by IDB, so neither loses
    // its write. Final value must be 2.
    await Promise.all([
      store.update('k', (n) => (typeof n === 'number' ? n : 0) + 1),
      store.update('k', (n) => (typeof n === 'number' ? n : 0) + 1),
    ]);
    assert.equal(await store.get('k'), 2);
    await store.disconnect();
  });
});

// ---------------------------------------------------------------------------
// Cursor-streamed snapshot and restore
// ---------------------------------------------------------------------------

void describe('IndexedDbStore: snapshot and restore', () => {
  void it('snapshotStream yields all written entries', async () => {
    const store = await Fixture.store();
    await store.set('a', 1);
    await store.set('b', 'two');
    await store.set('c', [3]);

    const collected: Array<{ key: string; value: unknown }> = [];
    for await (const entry of store.snapshotStream()) {
      collected.push(entry);
    }

    // All three keys appear (order is insertion order via fake-indexeddb)
    assert.equal(collected.length, 3);
    const keys = new Set(collected.map((e) => e.key));
    assert.ok(keys.has('a'));
    assert.ok(keys.has('b'));
    assert.ok(keys.has('c'));
    await store.disconnect();
  });

  void it('snapshot() returns typed envelope with all entries', async () => {
    const store = await Fixture.store();
    await store.set('p', 10);
    await store.set('q', 20);

    const snap = await store.snapshot();
    assert.equal(snap.type, 'indexed-db-store');
    assert.equal(snap.version, 1);
    assert.equal(snap.entries.length, 2);

    const byKey = Object.fromEntries(snap.entries.map((e) => [e.key, e.value]));
    assert.equal(byKey['p'], 10);
    assert.equal(byKey['q'], 20);
    await store.disconnect();
  });

  void it('restore() replaces all data with the snapshot contents', async () => {
    const source = await Fixture.store();
    await source.set('x', 42);
    await source.set('y', [1, 2, 3]);
    const snap = await source.snapshot();
    await source.disconnect();

    // Write a stale key to an independent target to verify replacement semantics
    const target = await Fixture.store();
    await target.set('stale', 'old');
    await target.restore(snap);

    assert.equal(await target.get('x'), 42);
    assert.deepEqual(await target.get('y'), [1, 2, 3]);
    assert.equal(await target.get('stale'), null);
    await target.disconnect();
  });

  void it('restore() throws StoreError INCOMPATIBLE_SNAPSHOT on wrong type', async () => {
    const store   = await Fixture.store();
    const badSnap = { 'version': 1, 'type': 'wrong-store', 'entries': [] };

    await assert.rejects(
      () => store.restore(badSnap),
      (err: unknown) => {
        assert.ok(err instanceof StoreError);
        assert.equal(err.classification.reason, 'INCOMPATIBLE_SNAPSHOT');
        return true;
      },
    );
    await store.disconnect();
  });
});

// ---------------------------------------------------------------------------
// Namespace
// ---------------------------------------------------------------------------

void describe('IndexedDbStore: namespace', () => {
  void it('namespace prefixes keys in the snapshot', async () => {
    const store = new IndexedDbStore(new IDBFactory(), { 'namespace': 'ns' });
    await store.connect();
    await store.set('key', 'value');

    const snap = await store.snapshot();
    assert.equal(snap.entries.length, 1);
    assert.equal(snap.entries[0]?.key, 'ns:key');
    assert.equal(await store.get('key'), 'value');
    await store.disconnect();
  });
});

// ---------------------------------------------------------------------------
// Disconnect
// ---------------------------------------------------------------------------

void describe('IndexedDbStore: disconnect', () => {
  void it('operations after disconnect throw StoreError BACKING_ERROR', async () => {
    const store = await Fixture.store();
    await store.disconnect();

    await assert.rejects(
      () => store.get('any'),
      (err: unknown) => {
        assert.ok(err instanceof StoreError);
        assert.equal(err.classification.reason, 'BACKING_ERROR');
        return true;
      },
    );
  });
});

// ---------------------------------------------------------------------------
// IndexedDbCheckpointStore
// ---------------------------------------------------------------------------

void describe('IndexedDbCheckpointStore: save/load/delete', () => {
  void it('save then load returns the stored JSON string', async () => {
    const ckpt = await Fixture.checkpointStore();
    await ckpt.save('run-1', '{"state":"ok"}');
    const loaded = await ckpt.load('run-1');
    assert.equal(loaded, '{"state":"ok"}');
    await ckpt.disconnect();
  });

  void it('load returns null for a missing key', async () => {
    const ckpt   = await Fixture.checkpointStore();
    const result = await ckpt.load('no-such-key');
    assert.equal(result, null);
    await ckpt.disconnect();
  });

  void it('delete removes an entry; load returns null afterwards', async () => {
    const ckpt = await Fixture.checkpointStore();
    await ckpt.save('to-del', '"data"');
    await ckpt.delete('to-del');
    assert.equal(await ckpt.load('to-del'), null);
    await ckpt.disconnect();
  });

  void it('delete on a missing key is a no-op (does not throw)', async () => {
    const ckpt = await Fixture.checkpointStore();
    await assert.doesNotReject(() => ckpt.delete('never-existed'));
    await ckpt.disconnect();
  });

  void it('overwrite: save to the same key replaces the value', async () => {
    const ckpt = await Fixture.checkpointStore();
    await ckpt.save('ck', '"v1"');
    await ckpt.save('ck', '"v2"');
    assert.equal(await ckpt.load('ck'), '"v2"');
    await ckpt.disconnect();
  });

  void it('checkpoint data is durable across a simulated reopen', async () => {
    const factory = new IDBFactory();

    const writer = await Fixture.checkpointStoreOnFactory(factory);
    await writer.save('resume-key', '{"step":3}');
    await writer.disconnect();

    const reader = await Fixture.checkpointStoreOnFactory(factory);
    assert.equal(await reader.load('resume-key'), '{"step":3}');
    await reader.disconnect();
  });
});
