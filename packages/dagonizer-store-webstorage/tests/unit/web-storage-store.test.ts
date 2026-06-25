/**
 * Tests for WebStorageStore and WebStorageCheckpointStore.
 *
 * All tests run under node:test. A minimal in-memory Storage double
 * (`FakeStorage`) is injected — no DOM, no browser globals.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { StoreError } from '@studnicky/dagonizer/store';

import { WebStorageCheckpointStore } from '../../src/WebStorageCheckpointStore.js';
import { WebStorageStore } from '../../src/WebStorageStore.js';
import type { StorageLikeInterface } from '../../src/WebStorageStore.js';

// ---------------------------------------------------------------------------
// FakeStorage: in-memory StorageLikeInterface double
// ---------------------------------------------------------------------------

/**
 * In-memory `StorageLikeInterface` backed by a `Map`.
 *
 * `quotaLimit` (optional): when the stored byte count would exceed this value
 * the next `setItem` call throws an error named `'QuotaExceededError'`.
 */
class FakeStorage implements StorageLikeInterface {
  readonly #data: Map<string, string>;
  readonly #quotaLimit: number;

  constructor(quotaLimit: number = Infinity) {
    this.#data       = new Map();
    this.#quotaLimit = quotaLimit;
  }

  get length(): number {
    return this.#data.size;
  }

  getItem(key: string): string | null {
    return this.#data.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    const existing     = this.#data.get(key)?.length ?? 0;
    const totalBytes   = this.#totalBytes() - existing + value.length;
    if (totalBytes > this.#quotaLimit) {
      const err  = new Error('QuotaExceededError');
      err.name   = 'QuotaExceededError';
      throw err;
    }
    this.#data.set(key, value);
  }

  removeItem(key: string): void {
    this.#data.delete(key);
  }

  key(index: number): string | null {
    const keys = [...this.#data.keys()];
    return keys[index] ?? null;
  }

  #totalBytes(): number {
    let total = 0;
    for (const v of this.#data.values()) {
      total += v.length;
    }
    return total;
  }
}

// ---------------------------------------------------------------------------
// Basic get / set / has / delete
// ---------------------------------------------------------------------------

void describe('WebStorageStore: get/set/has/delete', () => {
  void it('round-trip string, number, object values', async () => {
    const store = new WebStorageStore(new FakeStorage());

    await store.set('str',  'hello');
    await store.set('num',  42);
    await store.set('obj',  { 'a': 1, 'b': [true, null] });

    assert.equal(await store.get('str'), 'hello');
    assert.equal(await store.get('num'), 42);
    assert.deepEqual(await store.get('obj'), { 'a': 1, 'b': [true, null] });
  });

  void it('has() returns true for existing key, false for missing', async () => {
    const store = new WebStorageStore(new FakeStorage());
    await store.set('x', 1);
    assert.equal(await store.has('x'),       true);
    assert.equal(await store.has('missing'), false);
  });

  void it('delete() returns true for existing key, false for missing', async () => {
    const store = new WebStorageStore(new FakeStorage());
    await store.set('k', 'v');
    assert.equal(await store.delete('k'),     true);
    assert.equal(await store.has('k'),        false);
    assert.equal(await store.get('k'),        null);
    assert.equal(await store.delete('ghost'), false);
  });
});

// ---------------------------------------------------------------------------
// update (synchronous read-modify-write)
// ---------------------------------------------------------------------------

void describe('WebStorageStore: update', () => {
  void it('update(key, fn) returns next value and persists it', async () => {
    const store  = new WebStorageStore(new FakeStorage());
    const result = await store.update('counter', (n) => (typeof n === 'number' ? n : 0) + 1);
    assert.equal(result,                    1);
    assert.equal(await store.get('counter'), 1);
  });

  void it('sequential updates accumulate correctly', async () => {
    const store = new WebStorageStore(new FakeStorage());
    await store.update('n', (n) => (typeof n === 'number' ? n : 0) + 10);
    await store.update('n', (n) => (typeof n === 'number' ? n : 0) + 5);
    assert.equal(await store.get('n'), 15);
  });
});

// ---------------------------------------------------------------------------
// Prefix isolation
// ---------------------------------------------------------------------------

void describe('WebStorageStore: prefix isolation', () => {
  void it('two stores with different keyPrefix over the same backing do not see each other', async () => {
    const backing = new FakeStorage();
    const storeA  = new WebStorageStore(backing, { 'keyPrefix': 'ns-a:' });
    const storeB  = new WebStorageStore(backing, { 'keyPrefix': 'ns-b:' });

    await storeA.set('x', 'from-a');
    await storeB.set('x', 'from-b');

    assert.equal(await storeA.get('x'), 'from-a');
    assert.equal(await storeB.get('x'), 'from-b');

    // snapshotStream for A must not include B's key (and vice versa)
    const aEntries: string[] = [];
    for await (const e of storeA.snapshotStream()) { aEntries.push(e.key); }

    const bEntries: string[] = [];
    for await (const e of storeB.snapshotStream()) { bEntries.push(e.key); }

    assert.ok(!aEntries.some((k) => k.startsWith('ns-b:')));
    assert.ok(!bEntries.some((k) => k.startsWith('ns-a:')));
  });
});

// ---------------------------------------------------------------------------
// Snapshot and restore
// ---------------------------------------------------------------------------

void describe('WebStorageStore: snapshot / restore (array form)', () => {
  void it('snapshot() returns typed envelope and restore() repopulates a fresh store', async () => {
    const source = new WebStorageStore(new FakeStorage());
    await source.set('a', 1);
    await source.set('b', 'two');
    await source.set('c', [1, 2, 3]);

    const snap = await source.snapshot();
    assert.equal(snap.type,    'web-storage-store');
    assert.equal(snap.version, 1);
    assert.equal(snap.entries.length, 3);

    const target = new WebStorageStore(new FakeStorage());
    await target.restore(snap);
    assert.equal(await target.get('a'), 1);
    assert.equal(await target.get('b'), 'two');
    assert.deepEqual(await target.get('c'), [1, 2, 3]);
  });

  void it('restore() rejects incompatible snapshot type with INCOMPATIBLE_SNAPSHOT', async () => {
    const store   = new WebStorageStore(new FakeStorage());
    const badSnap = { 'version': 1, 'type': 'not-web-storage-store', 'entries': [] };

    await assert.rejects(
      () => store.restore(badSnap),
      (err: unknown) => {
        assert.ok(err instanceof StoreError);
        assert.equal(err.classification.reason, 'INCOMPATIBLE_SNAPSHOT');
        if (err.classification.reason === 'INCOMPATIBLE_SNAPSHOT') {
          assert.equal(err.classification.actualType, 'not-web-storage-store');
        }
        return true;
      },
    );
  });

  void it('restore() rejects incompatible snapshot version with INCOMPATIBLE_SNAPSHOT', async () => {
    const store   = new WebStorageStore(new FakeStorage());
    const badSnap = { 'version': 99, 'type': 'web-storage-store', 'entries': [] };

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
  });
});

// ---------------------------------------------------------------------------
// snapshotStream: streaming seam
// ---------------------------------------------------------------------------

void describe('WebStorageStore: snapshotStream', () => {
  void it('yields only keys under the store keyPrefix, with prefix stripped', async () => {
    const backing = new FakeStorage();
    const store   = new WebStorageStore(backing, { 'keyPrefix': 'pfx:' });

    await store.set('alpha', 'a');
    await store.set('beta',  'b');

    // Manually write a key under a different prefix — snapshotStream must skip it.
    backing.setItem('other:gamma', '"c"');

    const entries: Array<{ key: string; value: unknown }> = [];
    for await (const e of store.snapshotStream()) {
      entries.push(e);
    }

    const keys = entries.map((e) => e.key);
    assert.ok(keys.includes('alpha'));
    assert.ok(keys.includes('beta'));
    // The 'other:' prefixed key must not appear.
    assert.ok(!keys.some((k) => k.includes('gamma')));
    // Keys in the stream must NOT still carry the 'pfx:' prefix.
    assert.ok(!keys.some((k) => k.startsWith('pfx:')));
  });

  void it('snapshot()/restore() round-trip via the streaming seam matches array form', async () => {
    const source = new WebStorageStore(new FakeStorage());
    await source.set('x', 10);
    await source.set('y', 20);

    // Drain the stream manually to match what snapshot() does internally.
    const streamEntries: Array<{ key: string; value: unknown }> = [];
    for await (const e of source.snapshotStream()) {
      streamEntries.push(e);
    }

    const snap = await source.snapshot();

    // Stream entries must match the snapshot array entries (same keys + values).
    assert.equal(streamEntries.length, snap.entries.length);
    for (const se of streamEntries) {
      const ae = snap.entries.find((e) => e.key === se.key);
      assert.ok(ae !== undefined);
      assert.deepEqual(se.value, ae.value);
    }
  });
});

// ---------------------------------------------------------------------------
// Quota error routing
// ---------------------------------------------------------------------------

void describe('WebStorageStore: quota error routing', () => {
  void it('set() throws StoreError(BACKING_ERROR) when quota is exceeded', async () => {
    // Limit is 10 bytes — "hello world" is 11 bytes.
    const store = new WebStorageStore(new FakeStorage(10));

    await assert.rejects(
      () => store.set('k', 'hello world'),
      (err: unknown) => {
        assert.ok(err instanceof StoreError);
        assert.equal(err.classification.reason, 'BACKING_ERROR');
        return true;
      },
    );
  });

  void it('update() throws StoreError(BACKING_ERROR) when quota is exceeded during write', async () => {
    const store = new WebStorageStore(new FakeStorage(5));

    await assert.rejects(
      () => store.update('k', () => 'toolong'),
      (err: unknown) => {
        assert.ok(err instanceof StoreError);
        assert.equal(err.classification.reason, 'BACKING_ERROR');
        return true;
      },
    );
  });
});

// ---------------------------------------------------------------------------
// Parameterization: same class works for localStorage-style and
// sessionStorage-style doubles (injection-equivalent)
// ---------------------------------------------------------------------------

void describe('WebStorageStore: injection parameterization', () => {
  void it('localStorage-style double behaves identically to sessionStorage-style double', async () => {
    // Both are just FakeStorage with different lifetimes in a real browser;
    // under DI they are structurally equivalent. Test that both doubles work
    // with the same operations.
    const localBacking   = new FakeStorage();
    const sessionBacking = new FakeStorage();

    const localStore   = new WebStorageStore(localBacking,   { 'keyPrefix': 'local:' });
    const sessionStore = new WebStorageStore(sessionBacking, { 'keyPrefix': 'session:' });

    await localStore.set('greet',   'from-local');
    await sessionStore.set('greet', 'from-session');

    assert.equal(await localStore.get('greet'),   'from-local');
    assert.equal(await sessionStore.get('greet'), 'from-session');

    const localSnap   = await localStore.snapshot();
    const sessionSnap = await sessionStore.snapshot();

    assert.equal(localSnap.type,   'web-storage-store');
    assert.equal(sessionSnap.type, 'web-storage-store');

    assert.equal(localSnap.entries.length,   1);
    assert.equal(sessionSnap.entries.length, 1);
  });
});

// ---------------------------------------------------------------------------
// WebStorageCheckpointStore
// ---------------------------------------------------------------------------

void describe('WebStorageCheckpointStore: save / load / delete', () => {
  void it('save/load/delete round-trip', async () => {
    const store = new WebStorageCheckpointStore(new FakeStorage());

    await store.save('ckpt-1', '{"foo":"bar"}');
    assert.equal(await store.load('ckpt-1'), '{"foo":"bar"}');

    await store.delete('ckpt-1');
    assert.equal(await store.load('ckpt-1'), null);
  });

  void it('load returns null for a key that was never saved', async () => {
    const store = new WebStorageCheckpointStore(new FakeStorage());
    assert.equal(await store.load('nonexistent'), null);
  });

  void it('delete is a no-op for a missing key', async () => {
    const store = new WebStorageCheckpointStore(new FakeStorage());
    // Must not throw
    await store.delete('ghost');
  });

  void it('save throws StoreError(BACKING_ERROR) on quota exceeded', async () => {
    const store = new WebStorageCheckpointStore(new FakeStorage(5));

    await assert.rejects(
      () => store.save('k', '{"data":"toolong"}'),
      (err: unknown) => {
        assert.ok(err instanceof StoreError);
        assert.equal(err.classification.reason, 'BACKING_ERROR');
        return true;
      },
    );
  });

  void it('injection parameterization: localStorage-style and sessionStorage-style doubles', async () => {
    const localBacking   = new FakeStorage();
    const sessionBacking = new FakeStorage();

    const localStore   = new WebStorageCheckpointStore(localBacking,   { 'keyPrefix': 'l:' });
    const sessionStore = new WebStorageCheckpointStore(sessionBacking, { 'keyPrefix': 's:' });

    await localStore.save('run',   '{"mode":"local"}');
    await sessionStore.save('run', '{"mode":"session"}');

    assert.equal(await localStore.load('run'),   '{"mode":"local"}');
    assert.equal(await sessionStore.load('run'), '{"mode":"session"}');
  });
});

// ---------------------------------------------------------------------------
// Static factories fail gracefully when the global is absent
// ---------------------------------------------------------------------------

void describe('WebStorageStore.local / .session: missing global', () => {
  void it('local() throws StoreError when localStorage is absent from globalThis', () => {
    // In Node.js there is no localStorage; the factory must throw StoreError.
    assert.throws(
      () => WebStorageStore.local(),
      (err: unknown) => {
        assert.ok(err instanceof StoreError);
        assert.equal(err.classification.reason, 'BACKING_ERROR');
        return true;
      },
    );
  });

  void it('session() throws StoreError when sessionStorage is absent from globalThis', () => {
    assert.throws(
      () => WebStorageStore.session(),
      (err: unknown) => {
        assert.ok(err instanceof StoreError);
        assert.equal(err.classification.reason, 'BACKING_ERROR');
        return true;
      },
    );
  });

  void it('WebStorageCheckpointStore.local() throws StoreError in Node.js', () => {
    assert.throws(
      () => WebStorageCheckpointStore.local(),
      (err: unknown) => {
        assert.ok(err instanceof StoreError);
        assert.equal(err.classification.reason, 'BACKING_ERROR');
        return true;
      },
    );
  });
});
